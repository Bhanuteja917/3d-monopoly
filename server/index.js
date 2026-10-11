// Online play server: room codes, authoritative game state, disconnect bot and auction timers (§18).
import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { CONFIG, MODES } from '../shared/config.js';
import { createGame, act, actorsNow, botAction, timeoutAction, RuleError } from '../shared/engine.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const ROOM_IDLE_MS = 3 * 60 * 60 * 1000;
const BOT_DELAY_MS = Number(process.env.BOT_DELAY_MS ?? 900);

const app = express();
app.use(express.static(path.join(root, 'public')));
app.use('/shared', express.static(path.join(root, 'shared')));
app.use('/vendor/three', express.static(path.join(root, 'node_modules/three')));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });

/** @type {Map<string, any>} */
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => {
  let code;
  do code = Array.from({ length: 5 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
  while (rooms.has(code));
  return code;
};
const cleanName = (n) => String(n ?? '').replace(/\s+/g, ' ').trim().slice(0, 16) || 'Player';
const cleanId = (id) => String(id ?? '').slice(0, 64);

function cleanSettings(s = {}) {
  const playerCount = Math.min(CONFIG.maxPlayers, Math.max(CONFIG.minPlayers, Number(s.playerCount) || 4));
  const mode = MODES.includes(s.mode) ? s.mode : 'both';
  const targets = CONFIG.limits[playerCount].targets;
  const target = targets.includes(Number(s.target)) ? Number(s.target) : targets[1];
  return { playerCount, mode, target };
}

function publicRoom(room) {
  return {
    code: room.code,
    host: room.seats.findIndex((s) => s.clientId === room.hostClientId),
    settings: room.settings,
    started: !!room.state,
    deadline: room.deadline,
    seats: room.seats.map((s) => ({ name: s.name, connected: s.connected, bot: s.bot })),
  };
}

function broadcast(room, events = []) {
  room.lastActive = Date.now();
  for (const [i, seat] of room.seats.entries()) {
    if (!seat.socketId) continue;
    io.to(seat.socketId).emit('room', { ...publicRoom(room), you: i });
  }
  if (room.state) io.to(room.code).emit('game', { state: room.state, events });
}

function apply(room, action) {
  const events = act(room.state, action);
  afterChange(room);
  broadcast(room, events);
}

// Seconds on the clock for timed stages, and what restarts the clock: swap offers run one 90 s clock for
// everyone; bidding restarts its clock with every new bid.
function clockFor(st) {
  if (st.phase !== 'turn') return null;
  const t = st.turn;
  const base = `${st.turnNo}|${t.stage}`;
  if (t.stage === 'auctionRespond') return { key: `${base}|${t.auction.offered}`, secs: CONFIG.auctionResponseSeconds };
  if (t.stage === 'auctionConfirm') return { key: `${base}|${t.auction.offered}`, secs: CONFIG.auctionConfirmSeconds };
  if (t.stage === 'bid') return { key: `${base}|${t.bid.space}|${t.bid.round}`, secs: CONFIG.bidAuction.seconds };
  return null;
}

function afterChange(room) {
  clearTimeout(room.botTimer);
  const st = room.state;
  const clock = st && st.phase !== 'ended' ? clockFor(st) : null;
  if (!clock || clock.key !== room.clockKey) {
    clearTimeout(room.deadlineTimer);
    room.deadline = null;
    room.clockKey = clock?.key ?? null;
  }
  if (!st || st.phase === 'ended') return;
  // FR-004: control returns to a rejoined player at the start of their next turn.
  for (const [i, seat] of room.seats.entries()) {
    if (!seat.bot || !seat.connected) continue;
    const backAtTurnStart = st.phase === 'turn' && st.turn.active === i && st.turnNo > seat.rejoinedAtTurn;
    if (st.phase !== 'turn' || backAtTurnStart) seat.bot = false;
  }
  // Swap offers and bids are simultaneous, so any of several seats may be a bot that has to act.
  const botSeat = actorsNow(st).find((i) => room.seats[i].bot);
  if (botSeat != null) {
    room.botTimer = setTimeout(() => {
      try { apply(room, botAction(room.state, botSeat)); } catch (e) { console.error('bot error', e); }
    }, BOT_DELAY_MS);
  }
  // FR-115: timers online
  if (clock && !room.deadline) {
    room.deadline = Date.now() + clock.secs * 1000;
    room.deadlineTimer = setTimeout(() => {
      room.deadline = null;
      room.clockKey = null;
      const a = timeoutAction(room.state);
      if (a) try { apply(room, a); } catch (e) { console.error('timeout error', e); }
    }, clock.secs * 1000);
  }
}

io.on('connection', (socket) => {
  let room = null;
  // Seat index is looked up by socket id because lobby seats shift when someone leaves.
  const me = () => (room ? room.seats.findIndex((s) => s.socketId === socket.id) : -1);

  const attach = (r, i) => {
    room = r;
    const seat = r.seats[i];
    seat.socketId = socket.id;
    seat.connected = true;
    socket.join(r.code);
  };

  socket.on('room:create', (msg = {}, cb = () => {}) => {
    const code = newCode();
    const r = { code, hostClientId: cleanId(msg.clientId), settings: cleanSettings(msg), seats: [], state: null, lastActive: Date.now() };
    r.seats.push({ clientId: cleanId(msg.clientId), name: cleanName(msg.name), connected: true, bot: false, rejoinedAtTurn: 0 });
    rooms.set(code, r);
    attach(r, 0);
    cb({ ok: true, code });
    broadcast(r);
  });

  socket.on('room:join', (msg = {}, cb = () => {}) => {
    const r = rooms.get(String(msg.code ?? '').trim().toUpperCase());
    if (!r) return cb({ ok: false, error: 'Room not found' });
    const clientId = cleanId(msg.clientId);
    const existing = r.seats.findIndex((s) => s.clientId === clientId);
    if (existing >= 0) {
      // Rejoin (FR-004, NFR-004): bot keeps playing until this player's next turn starts.
      const seat = r.seats[existing];
      if (seat.socketId && seat.socketId !== socket.id) io.sockets.sockets.get(seat.socketId)?.disconnect(true);
      attach(r, existing);
      seat.rejoinedAtTurn = r.state?.turnNo ?? 0;
      afterChange(r);
      cb({ ok: true, code: r.code });
      return broadcast(r);
    }
    if (r.state) return cb({ ok: false, error: 'Game already started' });
    if (r.seats.length >= r.settings.playerCount) return cb({ ok: false, error: 'Room is full' });
    r.seats.push({ clientId, name: cleanName(msg.name), connected: true, bot: false, rejoinedAtTurn: 0 });
    attach(r, r.seats.length - 1);
    cb({ ok: true, code: r.code });
    broadcast(r);
  });

  socket.on('room:settings', (msg = {}) => {
    if (!room || room.state || room.seats[me()]?.clientId !== room.hostClientId) return;
    const s = cleanSettings(msg);
    if (s.playerCount < room.seats.length) s.playerCount = room.seats.length;
    room.settings = cleanSettings(s);
    broadcast(room);
  });

  socket.on('room:start', (_msg, cb = () => {}) => {
    if (!room || room.state) return cb({ ok: false, error: 'Cannot start' });
    if (room.seats[me()]?.clientId !== room.hostClientId) return cb({ ok: false, error: 'Only the host can start' });
    if (room.seats.length !== room.settings.playerCount) return cb({ ok: false, error: 'Room is not full yet' }); // FR-172
    room.state = createGame({
      players: room.seats.map((s) => ({ name: s.name })),
      mode: room.settings.mode,
      wealthTarget: room.settings.target,
    });
    afterChange(room);
    cb({ ok: true });
    broadcast(room);
  });

  socket.on('game:action', (action = {}, cb = () => {}) => {
    if (!room?.state) return cb({ ok: false, error: 'No game' });
    const seatIdx = me();
    if (seatIdx < 0) return cb({ ok: false, error: 'Not seated' });
    if (room.seats[seatIdx].bot) return cb({ ok: false, error: 'The bot is playing for you until your next turn' });
    try {
      apply(room, { ...action, system: false, player: seatIdx }); // FR-173: server validates every action; timers are server-only
      cb({ ok: true });
    } catch (e) {
      if (!(e instanceof RuleError)) console.error(e);
      cb({ ok: false, error: e.message });
    }
  });

  socket.on('room:leave', () => socket.disconnect(true));

  socket.on('disconnect', () => {
    if (!room) return;
    const seatIdx = me();
    if (seatIdx < 0) return;
    const seat = room.seats[seatIdx];
    seat.socketId = null;
    seat.connected = false;
    if (!room.state) {
      // Lobby: free the seat.
      room.seats.splice(seatIdx, 1);
      if (!room.seats.length) { rooms.delete(room.code); return; }
      if (seat.clientId === room.hostClientId) room.hostClientId = room.seats[0].clientId;
      for (const [i, s] of room.seats.entries()) if (s.socketId) io.sockets.sockets.get(s.socketId)?.emit('room', { ...publicRoom(room), you: i });
      return;
    }
    seat.bot = true; // FR-004
    afterChange(room);
    broadcast(room);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (now - r.lastActive > ROOM_IDLE_MS) { clearTimeout(r.botTimer); clearTimeout(r.deadlineTimer); rooms.delete(code); }
  }
}, 10 * 60 * 1000).unref();

server.listen(PORT, () => console.log(`Global Business on http://localhost:${PORT}`));
