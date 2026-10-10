// Plays many random games with bots against the rules engine and checks invariants.
import assert from 'node:assert/strict';
import { Game, GameError } from '../server/game.js';
import { OWNABLE, TILES, GROUPS } from '../shared/board.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const PHASES = new Set(['roll', 'buy', 'auction', 'debt', 'end', 'over']);

function botMove(g) {
  const cur = g.cur();
  const alive = g.active();
  const options = [];
  const me = pick(alive);
  if (g.phase === 'auction') {
    const b = pick(g.auction.bidders);
    options.push({ who: b, a: { type: 'bid', amount: g.auction.bid + pick([1, 10, 50]) } });
    options.push({ who: b, a: { type: 'pass' } });
  }
  if (g.phase === 'roll') {
    options.push({ who: cur.id, a: { type: 'roll' } }, { who: cur.id, a: { type: 'roll' } });
    if (cur.inJail) options.push({ who: cur.id, a: { type: 'payJail' } }, { who: cur.id, a: { type: 'jailCard' } });
  }
  if (g.phase === 'buy') options.push({ who: cur.id, a: { type: pick(['buy', 'buy', 'auction']) } });
  if (g.phase === 'end') options.push({ who: cur.id, a: { type: 'endTurn' } });
  if (g.phase === 'debt') {
    const d = pick(alive.filter((p) => p.money < 0));
    const mine = g.ownedBy(d.id);
    if (mine.length) {
      options.push({ who: d.id, a: { type: 'sell', prop: pick(mine) } });
      options.push({ who: d.id, a: { type: 'mortgage', prop: pick(mine) } });
    }
    options.push({ who: d.id, a: { type: 'bankrupt' } });
  }
  const mine = g.ownedBy(me.id);
  if (mine.length) {
    options.push({ who: me.id, a: { type: pick(['build', 'build', 'build', 'unmortgage', 'mortgage', 'sell']), prop: pick(mine) } });
  }
  const other = pick(alive.filter((p) => p !== me));
  if (other && Math.random() < 0.05) {
    options.push({
      who: me.id,
      a: { type: 'trade', offer: { to: other.id, giveProps: mine.slice(0, 1), getProps: g.ownedBy(other.id).slice(0, 1), giveMoney: 10 } },
    });
  }
  if (g.trades.length) {
    const tr = pick(g.trades);
    options.push({ who: tr.to, a: { type: 'tradeRespond', id: tr.id, accept: Math.random() < 0.7 } });
  }
  if (g.phase === 'auction' && Math.random() < 0.02) return { force: 'endAuction' };
  return pick(options);
}

function checkInvariants(g) {
  assert.ok(PHASES.has(g.phase), `bad phase ${g.phase}`);
  if (g.phase !== 'over') assert.ok(!g.cur().bankrupt, 'current player is bankrupt');
  for (const p of g.players) {
    assert.ok(p.pos >= 0 && p.pos < 40);
    if (p.bankrupt) assert.equal(g.ownedBy(p.id).length, 0, 'bankrupt player owns property');
  }
  if (g.phase !== 'debt' && g.phase !== 'over' && g.phase !== 'auction') {
    for (const p of g.active()) assert.ok(p.money >= 0, `${p.name} negative money outside debt phase (${g.phase})`);
  }
  for (const i of OWNABLE) {
    const pr = g.props[i];
    assert.ok(pr.houses >= 0 && pr.houses <= 5);
    if (pr.houses) {
      const t = TILES[i];
      assert.equal(t.type, 'property');
      assert.ok(g.ownsGroup(pr.owner, t.group), 'houses without monopoly');
      const hs = GROUPS[t.group].map((j) => g.props[j].houses);
      assert.ok(Math.max(...hs) - Math.min(...hs) <= 1, 'uneven building');
    }
    if (pr.mortgaged) assert.ok(!g.groupHasHouses(i), 'mortgaged with houses in set');
  }
  const chanceJail = g.players.reduce((n, p) => n + p.jailCards.filter((d) => d === 'chance').length, 0);
  assert.equal(g.decks.chance.length + chanceJail, 16, 'chance deck lost cards');
}

let finished = 0, steps = 0;
const GAMES = Number(process.argv[2]) || 300;
for (let n = 0; n < GAMES; n++) {
  const count = 2 + (n % 5);
  const g = new Game(Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `P${i}`, color: '#fff', token: 'car' })));
  for (let s = 0; s < 20000 && g.phase !== 'over'; s++) {
    const m = botMove(g);
    if (m?.force === 'endAuction') { g.endAuction(); checkInvariants(g); continue; }
    if (!m) continue;
    try {
      g.act(m.who, m.a);
    } catch (e) {
      if (!(e instanceof GameError)) { console.error('Crash on', m, 'phase', g.phase); throw e; }
    }
    checkInvariants(g);
    steps++;
  }
  if (g.phase === 'over') finished++;
  g.dispose();
}
console.log(`OK: ${GAMES} games, ${steps} actions, ${finished} played to a winner.`);
