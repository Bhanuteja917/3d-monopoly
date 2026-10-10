import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { Game, GameError } from './game.js';
import { MAX_PLAYERS, PLAYER_COLORS, TOKENS } from '../shared/board.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const ROOM_IDLE_MS = 2 * 60 * 60 * 1000; // drop rooms nobody has touched for 2 hours

const app = express();
app.use(express.static(path.join(root, 'public')));
app.use('/shared', express.static(path.join(root, 'shared')));
app.use('/vendor/three', express.static(path.join(root, 'node_modules/three')));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });

/** @type {Map<string, Room>} */
const rooms = new Map();
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const newCode = () => {
  let code;
  do {
    code = Array.from({ length: 4 }, () => ROOM_CHARS[crypto.randomInt(ROOM_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
};
const cleanName = (n) => String(n ?? '').replace(/\s+/g, ' ').trim().slice(0, 16) || 'Player';

class Room {
  constructor(code) {
    this.code = code;
    /** @type {Array<{id:string, token:string, name:string, color:string, piece:string, socketId:string|null}>} */
    this.members = [];
    this.hostId = null;
    this.game = null;
    this.touch();
  }

  touch() { this.lastActive = Date.now(); }

  addMember(name) {
    const usedColors = new Set(this.members.map((m) => m.color));
    const usedPieces = new Set(this.members.map((m) => m.piece));
    const m = {
      id: crypto.randomUUID().slice(0, 8),
      token: crypto.randomBytes(16).toString('hex'),
      name: cleanName(name),
      color: PLAYER_COLORS.find((c) => !usedColors.has(c)),
      piece: TOKENS.find((t) => !usedPieces.has(t)),
      socketId: null,
    };
    this.members.push(m);
    if (!this.hostId) this.hostId = m.id;
    return m;
  }

  removeMember(id) {
    this.members = this.members.filter((m) => m.id !== id);
    if (this.hostId === id) this.hostId = this.members[0]?.id ?? null;
  }

  serialize() {
    return {
      code: this.code,
      hostId: this.hostId,
      members: this.members.map(({ id, name, color, piece, socketId }) => ({
        id, name, color, piece, connected: !!socketId,
      })),
      game: this.game?.serialize() ?? null,
      now: Date.now(),
    };
  }

  broadcast() {
    this.touch();
    io.to(this.code).emit('state', this.serialize());
  }
}

io.on('connection', (socket) => {
  let room = null;
  let me = null;

  const attach = (r, m) => {
    if (m.socketId && m.socketId !== socket.id) io.sockets.sockets.get(m.socketId)?.disconnect(true);
    room = r; me = m;
    m.socketId = socket.id;
    socket.join(r.code);
  };
  const session = () => ({ ok: true, code: room.code, token: me.token, playerId: me.id });
  const reply = (cb, data) => typeof cb === 'function' && cb(data);

  socket.on('create', ({ name } = {}, cb) => {
    if (room) return reply(cb, { ok: false, error: 'Already in a room.' });
    const r = new Room(newCode());
    rooms.set(r.code, r);
    attach(r, r.addMember(name));
    reply(cb, session());
    r.broadcast();
  });

  socket.on('join', ({ code, name } = {}, cb) => {
    if (room) return reply(cb, { ok: false, error: 'Already in a room.' });
    const r = rooms.get(String(code ?? '').toUpperCase().trim());
    if (!r) return reply(cb, { ok: false, error: 'Room not found. Check the code.' });
    if (r.game) return reply(cb, { ok: false, error: 'That game has already started.' });
    if (r.members.length >= MAX_PLAYERS) return reply(cb, { ok: false, error: 'Room is full (6 players).' });
    attach(r, r.addMember(name));
    reply(cb, session());
    r.broadcast();
  });

  socket.on('resume', ({ code, token } = {}, cb) => {
    const r = rooms.get(String(code ?? '').toUpperCase());
    const m = r?.members.find((x) => x.token === token);
    if (!m) return reply(cb, { ok: false, error: 'Session expired.' });
    attach(r, m);
    reply(cb, session());
    r.broadcast();
  });

  socket.on('leave', (_ = {}, cb) => {
    if (!room) return reply(cb, { ok: true });
    const r = room;
    socket.leave(r.code);
    if (!r.game) {
      r.removeMember(me.id);
    } else {
      me.socketId = null;
      const p = r.game.player(me.id);
      if (p && !p.bankrupt && r.game.phase !== 'over') {
        try { r.game.bankrupt(me.id, 'left the game'); } catch { /* already out */ }
      }
    }
    room = null; me = null;
    reply(cb, { ok: true });
    if (!r.members.length) { r.game?.dispose(); rooms.delete(r.code); } else r.broadcast();
  });

  socket.on('kick', ({ playerId } = {}, cb) => {
    if (!room || room.hostId !== me.id) return reply(cb, { ok: false, error: 'Only the host can do that.' });
    if (playerId === me.id) return reply(cb, { ok: false, error: 'You cannot remove yourself.' });
    const target = room.members.find((m) => m.id === playerId);
    if (!target) return reply(cb, { ok: false, error: 'No such player.' });
    if (!room.game) {
      if (target.socketId) io.sockets.sockets.get(target.socketId)?.emit('kicked');
      room.removeMember(playerId);
    } else {
      try { room.game.bankrupt(playerId, 'was removed by the host'); } catch (e) {
        return reply(cb, { ok: false, error: e.message });
      }
    }
    reply(cb, { ok: true });
    room.broadcast();
  });

  socket.on('start', (_ = {}, cb) => {
    if (!room || room.hostId !== me.id) return reply(cb, { ok: false, error: 'Only the host can start.' });
    if (room.game) return reply(cb, { ok: false, error: 'Already started.' });
    if (room.members.length < 2) return reply(cb, { ok: false, error: 'Need at least 2 players.' });
    const r = room;
    r.game = new Game(r.members.map((m) => ({ id: m.id, name: m.name, color: m.color, token: m.piece })), () => r.broadcast());
    reply(cb, { ok: true });
    r.broadcast();
  });

  socket.on('action', (action, cb) => {
    if (!room?.game) return reply(cb, { ok: false, error: 'No game running.' });
    try {
      room.game.act(me.id, action);
      reply(cb, { ok: true });
      room.broadcast();
    } catch (e) {
      if (!(e instanceof GameError)) console.error(e);
      reply(cb, { ok: false, error: e instanceof GameError ? e.message : 'Server error.' });
    }
  });

  socket.on('chat', ({ text } = {}) => {
    if (!room || !me) return;
    const msg = String(text ?? '').trim().slice(0, 200);
    if (!msg) return;
    io.to(room.code).emit('chat', { from: me.id, name: me.name, color: me.color, text: msg, t: Date.now() });
  });

  socket.on('disconnect', () => {
    if (!room || !me || me.socketId !== socket.id) return;
    me.socketId = null;
    room.broadcast();
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    const anyoneHere = r.members.some((m) => m.socketId);
    if (!anyoneHere && now - r.lastActive > ROOM_IDLE_MS) {
      r.game?.dispose();
      rooms.delete(code);
    }
  }
}, 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`3D Monopoly running on http://localhost:${PORT}`);
});
