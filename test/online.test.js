// Online integration test: room codes, server-authoritative actions, disconnect bot and rejoin (§18, FR-003/004).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';
import { whoActs, botAction } from '../shared/engine.js';

const PORT = 3199;
const URL = `http://localhost:${PORT}`;

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), BOT_DELAY_MS: '5' }, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', (d) => { if (String(d).includes('Global Business on')) resolve(proc); });
    proc.stderr.on('data', (d) => process.stderr.write(d));
    proc.on('exit', (code) => reject(new Error(`server exited ${code}`)));
  });
}
const emit = (sock, ev, payload) => new Promise((r) => sock.emit(ev, payload, r));

const sockets = [];
function player(clientId, name) {
  const sock = io(URL, { transports: ['websocket'], forceNew: true });
  sockets.push(sock);
  const me = { sock, clientId, name, room: null, state: null, errors: [] };
  sock.on('room', (r) => { me.room = r; });
  sock.on('game', ({ state }) => {
    me.state = state;
    if (state.phase === 'ended' || !me.room || me.room.seats[me.room.you]?.bot) return;
    if (whoActs(state) !== me.room.you) return;
    const a = botAction(state, me.room.you);
    sock.emit('game:action', a, (res) => { if (!res.ok) me.errors.push(res.error); });
  });
  return me;
}
const until = async (fn, ms = 20000, what = '') => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what || fn}`);
    await new Promise((r) => setTimeout(r, 20));
  }
};

test('room code play with disconnect bot and rejoin', { timeout: 120000 }, async () => {
  const server = await startServer();
  try {
    const host = player('c0', 'Host');
    const created = await emit(host.sock, 'room:create', { name: 'Host', clientId: 'c0', playerCount: 4, mode: 'turns' });
    assert.equal(created.ok, true);
    assert.match(created.code, /^[A-Z2-9]{5}$/);
    const others = [1, 2, 3].map((i) => player(`c${i}`, `P${i}`));
    assert.equal((await emit(others[0].sock, 'room:join', { code: 'NOPE1', name: 'x', clientId: 'zz' })).ok, false);
    for (const p of others.slice(0, 2)) assert.equal((await emit(p.sock, 'room:join', { code: created.code, name: p.name, clientId: p.clientId })).ok, true);
    assert.equal((await emit(host.sock, 'room:start', {})).ok, false, 'cannot start before the room is full (FR-172)');
    assert.equal((await emit(others[2].sock, 'room:join', { code: created.code, name: 'P3', clientId: 'c3' })).ok, true);
    const extra = player('c9', 'Late');
    assert.equal((await emit(extra.sock, 'room:join', { code: created.code, name: 'Late', clientId: 'c9' })).error, 'Room is full');
    assert.equal((await emit(others[0].sock, 'room:start', {})).ok, false, 'only the host starts');
    assert.equal((await emit(host.sock, 'room:start', {})).ok, true);
    await until(() => host.state);

    // Server rejects actions from the wrong seat (FR-173)
    const notMine = [host, ...others].find((p) => p.room.you !== whoActs(host.state));
    const res = await emit(notMine.sock, 'game:action', { type: 'orderRoll' });
    assert.equal(res.ok, false);

    await until(() => host.state?.phase === 'turn' && host.state.turnNo >= 4);
    // Disconnect seat 2: bot takes over (FR-004)
    const leaver = others[1];
    const seat = leaver.room.you;
    leaver.sock.disconnect();
    await until(() => host.room.seats[seat].bot === true);
    const turnAtLeave = host.state.turnNo;
    await until(() => host.state.turnNo >= turnAtLeave + 6 || host.state.phase === 'ended');
    assert.notEqual(host.state.phase, 'ended', 'game should still be running to test rejoin');
    {
      // Rejoin with the same client id; control returns at the start of that player's next turn
      const back = player('c2', 'P2');
      const rj = await emit(back.sock, 'room:join', { code: created.code, name: 'P2', clientId: 'c2' });
      assert.equal(rj.ok, true);
      await until(() => back.state, 5000); // NFR-004: current state within 5 s
      await until(() => host.room.seats[seat].bot === false || host.state.phase === 'ended');
    }
    await until(() => host.state.phase === 'ended', 90000);
    assert.ok(host.state.winner != null);
  } finally {
    for (const sock of sockets) sock.disconnect();
    server.kill();
  }
});
