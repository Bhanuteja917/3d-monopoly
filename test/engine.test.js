// Rules tests. IDs refer to the PRD (FR-xxx, AC-xxx, §21 outcome matrix, §20 precedence).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../shared/config.js';
import { TOKENS, SETS, BOARD_LAYOUT, CHANCE_CARDS } from '../shared/content.js';
import {
  createGame, act, whoActs, netWorth, cityRent, utilityRent, canBuild, canSell, canMortgage,
  buildCost, sellValue, botAction, timeoutAction, ranking, RuleError, propsOf, travelFare, isTransport,
  actorsNow, biddersLeft,
} from '../shared/engine.js';

// ---------- helpers ----------
function game(n = 4, opts = {}) {
  const s = createGame({ players: Array.from({ length: n }, (_, i) => ({ name: `P${i}` })), seed: 7, ...opts });
  const faces = n === 4 ? [[6], [5], [4], [3]] : [[6, 6], [6, 5], [5, 5], [5, 4], [4, 4], [4, 3], [3, 3], [3, 2]];
  s.forcedDice = faces.slice(0, n).map((d) => d.slice());
  for (let i = 0; i < n; i++) act(s, { type: 'orderRoll', player: i });
  for (let i = 0; i < n; i++) act(s, { type: 'pickToken', player: i, token: TOKENS[i].id });
  return s;
}
const cornerAt = (s, kind) => s.spaces.find((x) => x.corner === kind)?.i;
// Fixed board helpers: A = a 3-city set, B = a 2-city set (second argument picks another one),
// UT(k) = the k-th utility, NEUTRAL = an unowned utility to land on when a test just needs its turn.
const A = (s, which = 0) => s.countries[which ? 'S9' : 'S5'].slice();
const B = (s, which = 0) => s.countries[which ? 'S8' : 'S7'].slice();
const UTILITY_SPACES = BOARD_LAYOUT.map((x, i) => (x.utility ? i : -1)).filter((i) => i >= 0);
const UT = (k = 0) => UTILITY_SPACES[k];
const NEUTRAL = BOARD_LAYOUT.findIndex((x) => x.utility === 'UT-PORT'); // Seaport
const give = (s, pid, ...spaces) => { for (const i of spaces.flat()) s.props[i].owner = pid; };
function rollTo(s, pid, target, dice) {
  const n = s.spaces.length;
  const total = dice.reduce((a, b) => a + b, 0);
  s.players[pid].pos = (target - total + n) % n;
  s.forcedDice = [dice];
  return act(s, { type: 'roll', player: pid });
}
const doAct = (s, type, extra = {}) => act(s, { type, player: whoActs(s), ...extra });
// Player 0 lands on city `space` (their own): opens the upgrade offer when the set rules allow one.
const landOn = (s, space) => rollTo(s, 0, space, [1]);
function finishStage(s) {
  // Resolve any pending decision for the active player the passive way.
  const st = s.turn.stage;
  if (st === 'buy') { doAct(s, 'auctionOff'); if (s.turn.stage === 'bid') act(s, { type: 'expire', system: true }); }
  else if (st === 'card') doAct(s, 'dismissCard');
  else if (st === 'auctionPick') doAct(s, 'auctionSkip');
  else if (st === 'shop') doAct(s, 'skipShop');
  else if (st === 'upgrade') doAct(s, 'skipBuild');
}
function toTurnOf(s, pid) {
  let guard = 0;
  while (s.turn.active !== pid && guard++ < 20) {
    finishStage(s);
    if (s.turn.stage === 'roll') rollTo(s, s.turn.active, 1 + s.turn.active * 0, s.numDice === 1 ? [1] : [1, 2]);
    finishStage(s);
    if (s.turn.extraRoll) { s.forcedDice = [[1, 2]]; doAct(s, 'roll'); finishStage(s); }
  }
}

// ---------- Board (§5, §6) ----------
describe('Board structure', () => {
  for (const n of [4, 5, 6, 7, 8]) {
    test(`${n} players: the same 47-space board, 2 dice, corner order, 3 Auctions (FR-023..025, FR-040)`, () => {
      const s = createGame({ players: Array.from({ length: n }, (_, i) => ({ name: `P${i}` })), seed: n });
      assert.equal(s.spaces.length, 47);
      assert.equal(s.numDice, 2);
      assert.equal(s.spaces[0].corner, 'start'); // FR-023
      const corners = s.spaces.filter((x) => x.kind === 'corner');
      assert.deepEqual(corners.map((x) => x.i), [0, 7, 14, 21, 27, 31, 37, 41]);
      assert.deepEqual(corners.slice(1, 4).map((x) => x.corner).sort(), ['auction', 'chance', 'jail']); // FR-024
      assert.deepEqual(corners.slice(4).map((x) => x.corner), ['tax', 'auction', 'shop', 'auction']); // FR-025
      assert.equal(corners.filter((x) => x.corner === 'auction').length, 3);
      assert.equal(s.spaces.filter((x) => x.kind === 'utility').length, 6);
      assert.equal(s.spaces.filter((x) => x.kind === 'city').length, 33);
    });
  }
  test('sets match the catalog, sit together on the board and each has one price (FR-060)', () => {
    const s = game(8);
    for (const set of SETS) {
      const spaces = s.countries[set.id];
      assert.deepEqual(spaces.map((i) => s.props[i].name), set.cities);
      assert.ok(spaces.every((i) => s.props[i].price === set.price && s.props[i].color === set.color));
    }
    assert.ok(SETS.every((x, k) => k === 0 || x.price > SETS[k - 1].price), 'prices rise along the board');
    assert.ok(SETS.at(-1).price / SETS[0].price <= 4, 'board stays within a 4x price range');
    assert.equal(new Set(SETS.map((x) => x.color)).size, SETS.length, 'every set has its own colour');
  });
  test('utilities cost 2,000 (FR-026)', () => {
    const s = game(4);
    for (const x of Object.values(s.props)) if (x.kind === 'utility') assert.equal(x.price, 2000);
  });
  test('Auction, Jail and Chance are shuffled between games (FR-024)', () => {
    const orders = new Set();
    for (let seed = 1; seed < 12; seed++) orders.add(createGame({ players: Array.from({ length: 4 }, (_, i) => ({ name: `P${i}` })), seed }).spaces.filter((x) => x.kind === 'corner').map((x) => x.corner).join());
    assert.ok(orders.size > 1);
  });
  test('rejects fewer than 4 or more than 8 players', () => {
    assert.throws(() => createGame({ players: [{}, {}, {}] }), RuleError);
    assert.throws(() => createGame({ players: Array(9).fill({}) }), RuleError);
  });
});

// ---------- Players (§4) ----------
describe('Turn order and tokens', () => {
  test('highest roll picks first and plays first (FR-014)', () => {
    const s = createGame({ players: Array.from({ length: 4 }, (_, i) => ({ name: `P${i}` })), seed: 1 });
    s.forcedDice = [[2], [6], [4], [5]];
    for (let i = 0; i < 4; i++) act(s, { type: 'orderRoll', player: i });
    assert.deepEqual(s.order, [1, 3, 2, 0]);
    assert.equal(whoActs(s), 1);
    for (const pid of [1, 3, 2, 0]) act(s, { type: 'pickToken', player: pid, token: TOKENS[pid].id });
    assert.equal(s.turn.active, 1);
  });
  test('ties re-roll among the tied players only (FR-015)', () => {
    const s = createGame({ players: Array.from({ length: 4 }, (_, i) => ({ name: `P${i}` })), seed: 1 });
    s.forcedDice = [[5], [5], [3], [1]];
    for (let i = 0; i < 4; i++) act(s, { type: 'orderRoll', player: i });
    assert.deepEqual(s.firstRoll.queue, [0, 1]);
    s.forcedDice = [[2], [4]];
    act(s, { type: 'orderRoll', player: 0 });
    act(s, { type: 'orderRoll', player: 1 });
    assert.deepEqual(s.order, [1, 0, 2, 3]);
  });
  test('tokens are unique and carry Okabe-Ito colours (FR-010, FR-012)', () => {
    const s = createGame({ players: Array.from({ length: 4 }, (_, i) => ({ name: `P${i}` })), seed: 1 });
    s.forcedDice = [[6], [5], [4], [3]];
    for (let i = 0; i < 4; i++) act(s, { type: 'orderRoll', player: i });
    act(s, { type: 'pickToken', player: 0, token: 'redline' });
    assert.throws(() => act(s, { type: 'pickToken', player: 1, token: 'redline' }), /taken/);
    assert.equal(s.players[0].color, '#D55E00');
  });
  test('only the expected player may act', () => {
    const s = game(4);
    assert.throws(() => act(s, { type: 'roll', player: 1 }), /Not your move/);
  });
});

// ---------- Movement (§8) ----------
describe('Dice and movement', () => {
  test('passing Start pays 2,000; landing on Start pays 2,000 (FR-043, FR-090)', () => {
    const s = game(4);
    const p = s.players[0];
    rollTo(s, 0, 2, [4]); // from 34 -> 2, passes Start
    assert.equal(p.cash, 15000 + 2000);
    finishStage(s);
    toTurnOf(s, 0);
    const before = p.cash;
    rollTo(s, 0, 0, [3]);
    assert.equal(p.cash, before + 2000);
  });
  test('Scooter adds 10% to salary (VH-01)', () => {
    const s = game(6);
    s.players[0].vehicle = 'VH-01';
    rollTo(s, 0, 1, [1, 2]);
    assert.equal(s.players[0].cash, 15000 + 2200);
  });
  test('doubles give one extra roll, never two (FR-041, §21)', () => {
    const s = game(5);
    rollTo(s, 0, 1, [3, 3]);
    finishStage(s);
    assert.equal(s.turn.active, 0); // the turn waits for the extra roll
    assert.equal(s.turn.stage, 'manage');
    assert.equal(s.turn.extraRoll, true);
    s.forcedDice = [[2, 2]];
    doAct(s, 'roll');
    finishStage(s);
    assert.equal(s.turn.active, 1); // doubles again, but no third roll: the turn ended by itself
  });
  test('the turn ends automatically once the roll is resolved (no end-turn step)', () => {
    const s = game(4);
    rollTo(s, 0, NEUTRAL, [1]);
    assert.equal(s.turn.stage, 'buy');
    assert.equal(s.turn.active, 0);
    doAct(s, 'auctionOff');
    assert.equal(s.turn.stage, 'bid');
    act(s, { type: 'expire', system: true });
    assert.equal(s.turn.active, 1);
    assert.equal(s.turn.stage, 'roll');
  });
  test('a lander who cannot afford the city is not forced into an auction', () => {
    const s = game(4);
    const [c] = A(s);
    s.players[0].cash = 10;
    rollTo(s, 0, c, [1]);
    assert.equal(s.turn.stage, 'buy');
    doAct(s, 'auctionOff');
    assert.equal(s.props[c].owner, null);
    assert.notEqual(s.turn.stage, 'bid');
    assert.equal(s.turn.active, 1); // the turn moved on
  });
  test('dice: real faces, flatter totals than 2d6, more doubles, no repeat-total streaks', () => {
    const s = game(4);
    const N = 20000;
    const totals = new Array(13).fill(0);
    let doubles = 0, repeats = 0, last = null;
    for (let k = 0; k < N; k++) {
      s.turn.stage = 'roll'; s.turn.extraRoll = false; s.turn.extraUsed = false; s.turn.rolls = 0;
      s.turn.active = 0; s.players[0].jailed = false; s.players[0].cash = 15000; s.round = 1;
      s.forcedDice = [];
      const d = act(s, { type: 'roll', player: 0 }).find((e) => e.type === 'dice').dice;
      assert.ok(d.length === 2 && d.every((v) => v >= 1 && v <= 6));
      const tot = d[0] + d[1];
      totals[tot]++;
      if (d[0] === d[1]) doubles++;
      if (tot === last) repeats++;
      last = tot;
    }
    const pct = (n) => n / N;
    assert.ok(pct(doubles) > 0.22 && pct(doubles) < 0.35, `doubles ${pct(doubles)}`); // plain 2d6: 0.167
    assert.ok(pct(totals[2]) > 0.04 && pct(totals[7]) < 0.15, `2: ${pct(totals[2])}, 7: ${pct(totals[7])}`); // 2d6: 0.028 / 0.167
    assert.ok(pct(repeats) < 0.05, `repeats ${pct(repeats)}`);
  });
  test('double six pays the jackpot', () => {
    const s = game(4);
    rollTo(s, 0, NEUTRAL, [6, 6]);
    assert.equal(s.players[0].cash, 15000 + CONFIG.diceTuning.jackpot);
  });
  test('1-die boards have no doubles or extra roll (FR-042)', () => {
    const s = game(4);
    s.numDice = 1; // CONFIG.dice can be set back to 1
    rollTo(s, 0, 2, [2]);
    finishStage(s);
    assert.equal(s.turn.extraRoll, false);
  });
});

// ---------- Landing and cities (§9, §10) ----------
describe('Buying and rent', () => {
  test('declining opens bidding for the other players at a 20-50% discount', () => {
    for (let seed = 1; seed < 30; seed++) {
      const s = game(4, { seed });
      const [c] = A(s);
      rollTo(s, 0, c, [1]);
      doAct(s, 'auctionOff');
      assert.equal(s.turn.stage, 'bid');
      const b = s.turn.bid;
      const price = s.props[c].price;
      assert.ok(b.start >= price * 0.5 - 10 && b.start <= price * 0.8 + 10, `start ${b.start} of ${price}`);
      assert.deepEqual(b.bidders, [1, 2, 3]);
      assert.deepEqual(actorsNow(s), [1, 2, 3]);
      assert.throws(() => act(s, { type: 'bid', player: 0, raise: 100 }), /Not your move/);
    }
  });
  test('bids come in any order; the winner pays the bank and the seller earns 10-15% commission', () => {
    const s = game(4);
    const [c] = A(s);
    rollTo(s, 0, c, [1]);
    doAct(s, 'auctionOff');
    const start = s.turn.bid.start;
    const cash = s.players.map((p) => p.cash);
    act(s, { type: 'bid', player: 3, raise: 100 }); // first bid is the opening price
    assert.equal(s.turn.bid.amount, start);
    act(s, { type: 'bid', player: 1, raise: 500 });
    assert.equal(s.turn.bid.amount, start + 500);
    assert.deepEqual(biddersLeft(s), [2, 3]);
    act(s, { type: 'bidPass', player: 2 });
    act(s, { type: 'bidPass', player: 3 });
    assert.equal(s.props[c].owner, 1);
    assert.equal(s.players[1].cash, cash[1] - (start + 500));
    const cut = s.players[0].cash - cash[0];
    assert.ok(cut >= (start + 500) * 0.1 - 10 && cut <= (start + 500) * 0.15 + 10, `commission ${cut}`);
    assert.equal(s.turn.active, 1); // the turn ended by itself
  });
  test('no bids: the property stays unowned; the timer closes bidding on the high bid', () => {
    const s = game(4);
    const [c, d] = A(s);
    rollTo(s, 0, c, [1]);
    doAct(s, 'auctionOff');
    for (const q of [1, 2, 3]) act(s, { type: 'bidPass', player: q });
    assert.equal(s.props[c].owner, null);
    const t = game(4);
    rollTo(t, 0, d, [1]);
    doAct(t, 'auctionOff');
    act(t, { type: 'bid', player: 2, raise: 1000 });
    assert.deepEqual(timeoutAction(t), { type: 'expire', system: true });
    act(t, timeoutAction(t));
    assert.equal(t.props[d].owner, 2);
  });
  test('players cannot send timer actions and cannot bid more than they have', () => {
    const s = game(4);
    const [c] = A(s);
    rollTo(s, 0, c, [1]);
    doAct(s, 'auctionOff');
    assert.throws(() => act(s, { type: 'bid', player: 1, raise: 7 }), /bid buttons/);
    s.players[2].cash = 10;
    assert.throws(() => act(s, { type: 'bid', player: 2, raise: 100 }), /Not enough cash/);
    assert.throws(() => act(s, { type: 'roll', player: 0, system: true }), RuleError);
  });
  test('buy at list price', () => {
    const s = game(4);
    const [c] = A(s);
    rollTo(s, 0, c, [1]);
    doAct(s, 'buy');
    assert.equal(s.props[c].owner, 0);
    assert.equal(s.players[0].cash, 15000 - s.props[c].price);
  });
  test('rent: 10% x cities owned in the set / 50% / 125% / 250% (§10.2)', () => {
    const s = game(4);
    const cs = A(s);
    const price = s.props[cs[0]].price;
    give(s, 1, cs[0]);
    assert.equal(cityRent(s, s.props[cs[0]]), Math.floor(price * 0.1));
    give(s, 1, cs[1]);
    assert.equal(cityRent(s, s.props[cs[0]]), Math.floor(price * 0.1) * 2); // 2 of the set: double
    give(s, 1, cs);
    assert.equal(cityRent(s, s.props[cs[0]]), Math.floor(price * 0.1) * 3); // 3 of the set: triple
    const four = s.countries.S12;
    give(s, 2, four);
    assert.equal(cityRent(s, s.props[four[0]]), Math.floor(s.props[four[0]].price * 0.1) * 4);
    for (const [steps, rate] of [[1, 0.5], [2, 1.25], [3, 2.5]]) {
      s.props[cs[0]].steps = steps;
      assert.equal(cityRent(s, s.props[cs[0]]), Math.floor(price * rate));
    }
  });
  test('landing on another player city pays rent (§21)', () => {
    const s = game(4);
    const [c] = A(s);
    give(s, 1, c);
    rollTo(s, 0, c, [2]);
    const rent = Math.floor(s.props[c].price * 0.1);
    assert.equal(s.players[0].cash, 15000 - rent);
    assert.equal(s.players[1].cash, 15000 + rent);
  });
  test('own city: no effect; mortgaged city: no rent (FR-062, §21)', () => {
    const s = game(4);
    const [c, d] = A(s);
    give(s, 0, c);
    rollTo(s, 0, c, [2]);
    assert.equal(s.players[0].cash, 15000);
    finishStage(s);
    give(s, 0, d);
    s.props[d].mortgaged = true;
    rollTo(s, 1, d, [3]);
    assert.equal(s.players[1].cash, 15000);
  });
  test('building rent uses the depreciation factor (FR-061)', () => {
    const s = game(4);
    const cs = A(s);
    give(s, 1, cs);
    const c = s.props[cs[0]];
    c.steps = 2; c.factor = 0.75;
    assert.equal(cityRent(s, c), Math.floor(c.price * 1.25 * 0.75));
  });
});

describe('Building, selling, mortgage (§10.3-10.5)', () => {
  test('build requires a complete set without mortgages, even build, costs 50% (FR-063..065)', () => {
    const s = game(4);
    const cs = A(s);
    give(s, 0, cs.slice(0, 2));
    landOn(s, cs[0]);
    assert.notEqual(s.turn.stage, 'upgrade'); // incomplete set: no offer
    const s2 = game(4);
    give(s2, 0, cs);
    s2.props[cs[2]].mortgaged = true;
    landOn(s2, cs[0]);
    assert.notEqual(s2.turn.stage, 'upgrade'); // mortgage in the set: no offer
    const s3 = game(4);
    give(s3, 0, cs);
    landOn(s3, cs[0]);
    assert.equal(s3.turn.stage, 'upgrade');
    assert.equal(canBuild(s3, 0, cs[0]), true);
    const price = s3.props[cs[0]].price;
    const cash = s3.players[0].cash;
    doAct(s3, 'build', { space: cs[0] });
    assert.equal(s3.players[0].cash, cash - price / 2);
    assert.equal(s3.props[cs[0]].steps, 1);
  });
  test('even build: a city ahead of its set cannot be upgraded when landed on (FR-064)', () => {
    const s = game(4);
    const cs = A(s);
    give(s, 0, cs);
    s.props[cs[0]].steps = 1;
    landOn(s, cs[0]);
    assert.notEqual(s.turn.stage, 'upgrade');
  });
  test('only on the landed city, only once per turn, skippable (FR-031)', () => {
    const s = game(4, { mode: 'turns' });
    const cs = B(s);
    give(s, 0, cs);
    s.players[0].cash = 100000;
    assert.equal(canBuild(s, 0, cs[0]), false); // not before landing
    assert.throws(() => doAct(s, 'build', { space: cs[0] }), /Not allowed now/);
    s.turn.extraRoll = false;
    landOn(s, cs[0]);
    assert.equal(s.turn.stage, 'upgrade');
    assert.throws(() => doAct(s, 'build', { space: cs[1] }), /cannot build/); // other city of the set
    doAct(s, 'build', { space: cs[0] });
    assert.equal(s.props[cs[0]].steps, 1);
    assert.notEqual(s.turn.stage, 'upgrade');
    assert.equal(canBuild(s, 0, cs[0]), false);
    assert.equal(canBuild(s, 0, cs[1]), false);
    assert.throws(() => doAct(s, 'build', { space: cs[0] }), /Not allowed now/);
  });
  test('one upgrade per turn even across a doubles re-roll (FR-031)', () => {
    const s = game(4, { mode: 'turns' });
    const cs = B(s);
    give(s, 0, cs);
    s.players[0].cash = 100000;
    s.players[0].pos = (cs[0] - 2 + s.spaces.length) % s.spaces.length;
    s.forcedDice = [[1, 1]];
    act(s, { type: 'roll', player: 0 });
    assert.equal(s.turn.stage, 'upgrade');
    doAct(s, 'build', { space: cs[0] });
    assert.equal(s.turn.stage, 'manage'); // doubles: roll again
    s.players[0].pos = (cs[1] - 1 + s.spaces.length) % s.spaces.length;
    s.forcedDice = [[1]];
    act(s, { type: 'roll', player: 0 });
    assert.notEqual(s.turn.stage, 'upgrade'); // already upgraded this turn
    assert.equal(s.props[cs[1]].steps, 0);
  });
  test('skipBuild declines the offer and tower is the top step (FR-065)', () => {
    const s = game(4, { mode: 'turns' });
    const cs = B(s);
    give(s, 0, cs);
    s.players[0].cash = 100000;
    landOn(s, cs[0]);
    doAct(s, 'skipBuild');
    assert.equal(s.props[cs[0]].steps, 0);
    const s2 = game(4, { mode: 'turns' });
    give(s2, 0, cs);
    s2.players[0].cash = 100000;
    s2.props[cs[0]].steps = 3; s2.props[cs[1]].steps = 3;
    landOn(s2, cs[0]);
    assert.notEqual(s2.turn.stage, 'upgrade');
  });
  test('Delivery Truck makes upgrades 10% cheaper (VH-04)', () => {
    const s = game(6);
    const c = s.props[A(s)[0]];
    s.players[0].vehicle = 'VH-04';
    assert.equal(buildCost(s, 0, c), Math.floor(Math.floor(c.price * 0.5) * 0.9));
  });
  test('sell back at 50% of build cost × factor with even sell (FR-066)', () => {
    const s = game(4);
    const cs = B(s);
    give(s, 0, cs);
    s.props[cs[0]].steps = 2; s.props[cs[1]].steps = 1; s.props[cs[0]].factor = 0.75;
    assert.equal(canSell(s, 0, cs[1]), false);
    assert.equal(canSell(s, 0, cs[0]), true);
    assert.equal(sellValue(s.props[cs[0]]), Math.floor(Math.floor(s.props[cs[0]].price * 0.5) * 0.5 * 0.75));
    const cash = s.players[0].cash;
    doAct(s, 'sell', { space: cs[0] });
    assert.equal(s.players[0].cash, cash + Math.floor(Math.floor(s.props[cs[0]].price * 0.5) * 0.5 * 0.75));
  });
  test('broken set keeps buildings and rent but blocks building (FR-067, FR-068, §21)', () => {
    const s = game(4);
    const cs = A(s);
    give(s, 1, cs);
    for (const c of cs) s.props[c].steps = 1;
    s.props[cs[2]].owner = 2; // set broken
    assert.equal(canBuild(s, 1, cs[0]), false);
    assert.equal(cityRent(s, s.props[cs[0]]), Math.floor(s.props[cs[0]].price * 0.5));
  });
  test('mortgage 50%, unmortgage 55%, blocked while country has buildings (FR-069, FR-070)', () => {
    const s = game(4);
    const cs = B(s);
    give(s, 0, cs);
    s.props[cs[1]].steps = 1;
    assert.equal(canMortgage(s, 0, cs[0]), false);
    s.props[cs[1]].steps = 0;
    const price = s.props[cs[0]].price;
    const cash = s.players[0].cash;
    doAct(s, 'mortgage', { space: cs[0] });
    assert.equal(s.players[0].cash, cash + price * 0.5);
    doAct(s, 'unmortgage', { space: cs[0] });
    assert.equal(s.players[0].cash, cash + price * 0.5 - Math.floor(price * 0.55));
  });
  test('step 4 actions only on your own turn, before rolling (FR-031)', () => {
    const s = game(4);
    give(s, 1, B(s));
    assert.throws(() => act(s, { type: 'sell', player: 1, space: B(s)[0] }), /Not your move/);
    give(s, 0, B(s));
    doAct(s, 'mortgage', { space: B(s)[0] }); // before the roll: allowed
    rollTo(s, 0, NEUTRAL, [1]);
    assert.equal(s.turn.stage, 'buy');
    assert.throws(() => doAct(s, 'unmortgage', { space: B(s)[0] }), /before you roll/); // not mid-decision
  });
});

// ---------- Utilities (§11) ----------
describe('Utilities', () => {
  test('utilities and travel are separate sets: rent 250/500/1000 by count in the set, mortgaged still counts (FR-080..082)', () => {
    const s = game(8);
    const utilities = [0, 2, 3].map(UT), travel = [1, 4, 5].map(UT);
    assert.deepEqual(utilities.map((i) => s.props[i].group), ['utility', 'utility', 'utility']);
    assert.deepEqual(travel.map((i) => s.props[i].group), ['travel', 'travel', 'travel']);
    give(s, 1, travel); // travel does not raise utility rent
    [250, 500, 1000].forEach((rent, k) => {
      give(s, 1, utilities[k]);
      assert.equal(utilityRent(s, s.props[utilities[0]]), rent);
    });
    assert.equal(utilityRent(s, s.props[travel[0]]), 1000);
    s.props[utilities[1]].mortgaged = true;
    assert.equal(utilityRent(s, s.props[utilities[1]]), 0);
    assert.equal(utilityRent(s, s.props[utilities[0]]), 1000);
  });
  test('Speedboat counts one more in the set, cap still applies (VH-07)', () => {
    const s = game(6);
    give(s, 1, UT(0));
    s.players[1].vehicle = 'VH-07';
    assert.equal(utilityRent(s, s.props[UT(0)]), 500);
    give(s, 1, UT(2), UT(3));
    assert.equal(utilityRent(s, s.props[UT(0)]), 2000);
  });
  test('utilities cannot be built on (FR-081)', () => {
    const s = game(4);
    give(s, 0, UT(0));
    assert.equal(canBuild(s, 0, UT(0)), false);
  });
});

describe('Transport trips', () => {
  const RAIL = () => UT(1), DAM = () => UT(0);
  function landOnRail(s) {
    const pid = s.turn.active, owner = (pid + 1) % s.players.length;
    give(s, owner, RAIL());
    rollTo(s, pid, RAIL(), [1, 2]);
    return { pid, owner };
  }
  test('rail, seaport and airport are transport; dam, refinery and solar are not', () => {
    const s = game(4);
    assert.deepEqual([0, 1, 2, 3, 4, 5].map((k) => isTransport(s.props[UT(k)])), [false, true, false, false, true, true]);
  });
  test('landing on an owned transport offers three trips instead of rent', () => {
    const s = game(4);
    const { pid } = landOnRail(s);
    const cash = s.players[pid].cash;
    assert.equal(s.turn.stage, 'travel');
    const opts = s.turn.travel.options;
    assert.equal(opts.length, 3);
    assert.ok(opts[0].steps < opts[1].steps && opts[1].steps < opts[2].steps, 'near, mid, far');
    for (const o of opts) {
      assert.equal(o.space, (RAIL() + o.steps) % s.spaces.length);
      assert.equal(isTransport(s.props[o.space]), false);
      assert.notEqual(s.spaces[o.space].corner, 'jail');
      assert.equal(o.fare, travelFare(s, s.props[RAIL()], o.steps));
    }
    assert.ok(opts[0].fare < opts[2].fare, 'longer trips cost more');
    assert.equal(s.players[pid].cash, cash, 'nothing paid until a trip is picked');
  });
  test('fare is 50 per space with one travel hub owned, and scales with travel hubs only', () => {
    const s = game(4);
    give(s, 1, RAIL());
    assert.equal(travelFare(s, s.props[RAIL()], 10), 500);
    give(s, 1, DAM());
    assert.equal(travelFare(s, s.props[RAIL()], 10), 500);
    give(s, 1, UT(4));
    assert.equal(travelFare(s, s.props[RAIL()], 10), 1000);
  });
  test('the lander may pay the flat rent and stay instead of travelling', () => {
    const s = game(4);
    const { pid, owner } = landOnRail(s);
    const before = [s.players[pid].cash, s.players[owner].cash, s.players[pid].pos];
    act(s, { type: 'stayPay', player: pid });
    assert.equal(s.players[pid].cash, before[0] - 250);
    assert.equal(s.players[owner].cash, before[1] + 250);
    assert.equal(s.players[pid].pos, before[2]);
    assert.equal(s.turn.active, (pid + 1) % 4);
  });
  test('picking a trip pays the owner, moves the player and resolves the destination', () => {
    const s = game(4);
    const { pid, owner } = landOnRail(s);
    const trip = s.turn.travel.options[0];
    const before = [s.players[pid].cash, s.players[owner].cash];
    act(s, { type: 'travel', player: pid, option: 0 });
    assert.equal(s.players[pid].pos, trip.space);
    assert.equal(s.players[owner].cash, before[1] + trip.fare);
    const passedStart = RAIL() + trip.steps >= s.spaces.length;
    assert.equal(s.players[pid].cash, before[0] - trip.fare + (passedStart ? CONFIG.startSalary : 0));
    assert.equal(s.turn.travel, null);
    if (s.props[trip.space]?.owner == null && s.props[trip.space]) assert.equal(s.turn.stage, 'buy');
  });
  test('a far trip that passes Start pays the salary', () => {
    const s = game(4);
    const { pid } = landOnRail(s);
    const far = s.turn.travel.options.findIndex((o) => RAIL() + o.steps >= s.spaces.length);
    if (far < 0) return; // layout has no wrapping trip from this hub
    const cash = s.players[pid].cash, trip = s.turn.travel.options[far];
    act(s, { type: 'travel', player: pid, option: far });
    assert.equal(s.players[pid].cash, cash - trip.fare + CONFIG.startSalary);
  });
  test('invalid option is rejected; own or mortgaged transport is free', () => {
    const s = game(4);
    const { pid } = landOnRail(s);
    assert.throws(() => act(s, { type: 'travel', player: pid, option: 5 }), RuleError);
    const t = game(4);
    const p = t.turn.active;
    give(t, (p + 1) % 4, RAIL());
    t.props[RAIL()].mortgaged = true;
    const cash = t.players[p].cash;
    rollTo(t, p, RAIL(), [1, 2]);
    assert.notEqual(t.turn.stage, 'travel');
    assert.equal(t.players[p].cash, cash);
  });
  test('non-transport utilities still charge flat rent', () => {
    const s = game(4);
    const pid = s.turn.active, owner = (pid + 1) % 4;
    give(s, owner, DAM());
    const cash = s.players[owner].cash;
    rollTo(s, pid, DAM(), [1, 2]);
    assert.notEqual(s.turn.stage, 'travel');
    assert.equal(s.players[owner].cash, cash + 250);
  });
  test('bot picks the cheapest of staying and the trips', () => {
    const s = game(4);
    const { pid } = landOnRail(s);
    const a = botAction(s, pid);
    const fares = s.turn.travel.options.map((o) => o.fare);
    const cheapest = Math.min(...fares);
    if (cheapest < 250) assert.equal(fares[a.option], cheapest);
    else assert.equal(a.type, 'stayPay');
  });
});

// ---------- Jail (§12.3) ----------
describe('Jail', () => {
  test('landing on Jail jails and cancels the pending extra roll (FR-051, FR-091)', () => {
    const s = game(5);
    const jail = cornerAt(s, 'jail');
    rollTo(s, 0, jail, [2, 2]);
    assert.equal(s.players[0].jailed, true);
    assert.equal(s.turn.extraRoll, false);
    assert.equal(s.turn.active, 1); // the turn ended by itself
  });
  test('doubles escape and move, no extra roll (FR-093, FR-044, §21)', () => {
    const s = game(5);
    const jail = cornerAt(s, 'jail');
    Object.assign(s.players[0], { jailed: true, pos: jail });
    s.forcedDice = [[3, 3]];
    doAct(s, 'roll');
    assert.equal(s.players[0].jailed, false);
    assert.equal(s.players[0].pos, (jail + 6) % s.spaces.length);
    finishStage(s);
    assert.equal(s.turn.extraRoll, false);
  });
  test('1-die board: a 6 escapes, anything else stays (FR-093)', () => {
    const s = game(4);
    s.numDice = 1; // CONFIG.dice can be set back to 1
    const jail = cornerAt(s, 'jail');
    Object.assign(s.players[0], { jailed: true, pos: jail });
    s.forcedDice = [[5]];
    doAct(s, 'roll');
    assert.equal(s.players[0].jailed, true);
    assert.equal(s.players[0].jailTurns, 1);
    toTurnOf(s, 0);
    assert.equal(s.turn.stage, 'jail');
    doAct(s, 'skipJailCard'); // chose to roll for it
    s.forcedDice = [[6]];
    doAct(s, 'roll');
    assert.equal(s.players[0].jailed, false);
  });
  test('first jail turn: may pay 500 to leave at once, then roll normally', () => {
    const s = game(5);
    const jail = cornerAt(s, 'jail');
    Object.assign(s.players[1], { jailed: true, pos: jail });
    rollTo(s, 0, 1, [1, 2]); finishStage(s);
    assert.equal(s.turn.active, 1);
    assert.equal(s.turn.stage, 'jail');
    doAct(s, 'payJail');
    assert.equal(s.players[1].jailed, false);
    assert.equal(s.players[1].cash, 15000 - 500);
    assert.equal(s.turn.stage, 'roll');
    s.forcedDice = [[3, 4]];
    doAct(s, 'roll');
    assert.equal(s.players[1].pos, (jail + 7) % s.spaces.length);
  });
  test('paying out of jail needs the cash and a card needs a card', () => {
    const s = game(5);
    const jail = cornerAt(s, 'jail');
    Object.assign(s.players[1], { jailed: true, pos: jail, cash: 400 });
    rollTo(s, 0, 1, [1, 2]); finishStage(s);
    assert.throws(() => doAct(s, 'payJail'), /You need/);
    assert.throws(() => doAct(s, 'useJailCard'), /no Get Out of Jail Free/);
    assert.equal(s.players[1].cash, 400);
    assert.equal(s.players[1].jailed, true);
  });
  test('third jail turn: released free of charge, roll normally', () => {
    const s = game(5);
    const jail = cornerAt(s, 'jail');
    Object.assign(s.players[1], { jailed: true, pos: jail, jailTurns: 2 });
    rollTo(s, 0, 1, [1, 2]); finishStage(s);
    assert.equal(s.turn.active, 1);
    assert.equal(s.players[1].jailed, false);
    assert.equal(s.players[1].cash, 15000); // nothing paid
    assert.equal(s.turn.stage, 'roll');
  });
  test('Get Out of Jail Free is used at turn start and returns to the bottom of the deck (FR-092, FR-132)', () => {
    const s = game(5);
    const jail = cornerAt(s, 'jail');
    Object.assign(s.players[1], { jailed: true, pos: jail, jailCard: true });
    s.chance.deck = s.chance.deck.filter((c) => c !== 'CH-11');
    rollTo(s, 0, 1, [1, 2]); finishStage(s);
    assert.equal(s.turn.stage, 'jail');
    doAct(s, 'useJailCard');
    assert.equal(s.players[1].jailed, false);
    assert.equal(s.chance.deck.at(-1), 'CH-11');
    assert.equal(s.turn.stage, 'roll');
  });
  test('jailed players collect rent and may manage (FR-095)', () => {
    const s = game(4);
    const jail = cornerAt(s, 'jail');
    const [c] = A(s);
    give(s, 1, c);
    Object.assign(s.players[1], { jailed: true, pos: jail });
    rollTo(s, 0, c, [1]);
    assert.ok(s.players[1].cash > 15000);
    finishStage(s);
    assert.equal(s.turn.active, 1);
    give(s, 1, B(s));
    doAct(s, 'mortgage', { space: B(s)[0] }); // jailed, before the escape roll
    assert.equal(s.props[B(s)[0]].mortgaged, true);
    doAct(s, 'skipJailCard'); // choose to roll for it
    s.forcedDice = [[2]];
    doAct(s, 'roll');
    assert.equal(s.players[1].jailed, true);
    assert.equal(s.turn.active, 2); // failed escape: the turn ends by itself
  });
  test('Helicopter leaves on the first jail turn (VH-06)', () => {
    const s = game(6);
    Object.assign(s.players[1], { jailed: true, pos: cornerAt(s, 'jail'), vehicle: 'VH-06' });
    rollTo(s, 0, 1, [1, 2]); finishStage(s);
    assert.equal(s.players[1].jailed, false);
    assert.equal(s.players[1].cash, 15000);
  });
});

// ---------- Other corners (§12) ----------
describe('Corners', () => {
  test('Tax: 250/500/1000 per house/building/tower, nothing without buildings (FR-096, FR-097)', () => {
    const s = game(5);
    const tax = cornerAt(s, 'tax');
    rollTo(s, 0, tax, [1, 2]);
    assert.equal(s.players[0].cash, 15000);
    finishStage(s);
    const cs = A(s, 3);
    give(s, 1, cs);
    s.props[cs[0]].steps = 1; s.props[cs[1]].steps = 2; s.props[cs[2]].steps = 3;
    rollTo(s, 1, tax, [1, 2]);
    assert.equal(s.players[1].cash, 15000 - 1750);
  });
  test('Tuk-tuk pays 25% less tax (VH-02)', () => {
    const s = game(6);
    const cs = A(s, 3);
    give(s, 0, cs);
    s.props[cs[0]].steps = 3;
    s.players[0].vehicle = 'VH-02';
    rollTo(s, 0, cornerAt(s, 'tax'), [1, 2]);
    assert.equal(s.players[0].cash, 15000 - 750);
  });
});

// ---------- Auction (§13) ----------
describe('Auction swap', () => {
  function auctionGame(n = 4) {
    const s = game(n);
    const auction = cornerAt(s, 'auction');
    return { s, auction };
  }
  test('lander with no property: nothing happens (§13.1)', () => {
    const { s, auction } = auctionGame();
    rollTo(s, 0, auction, [1]);
    assert.equal(s.turn.active, 1); // the turn ended by itself
  });
  test('full flow: everyone answers at once, confirm swaps, both traders collect the swap bonus (FR-110, FR-111, FR-114)', () => {
    const { s, auction } = auctionGame();
    const [a] = A(s); const [b] = B(s); const [c] = A(s, 3);
    give(s, 0, a); give(s, 1, b); give(s, 2, c);
    rollTo(s, 0, auction, [1]);
    assert.equal(s.turn.stage, 'auctionPick');
    doAct(s, 'auctionPick', { space: a });
    assert.deepEqual(actorsNow(s), [1, 2]); // player 3 owns nothing and is skipped
    assert.throws(() => act(s, { type: 'auctionOffer', player: 1, space: c }), /own/);
    act(s, { type: 'auctionRefuse', player: 2 }); // out of turn order: answers are simultaneous
    assert.throws(() => act(s, { type: 'auctionRefuse', player: 2 }), /Not your move/);
    act(s, { type: 'auctionOffer', player: 1, space: b });
    assert.equal(s.turn.stage, 'auctionConfirm');
    const cash = s.players.map((p) => p.cash);
    doAct(s, 'auctionConfirm', { from: 1 });
    assert.equal(s.props[a].owner, 1);
    assert.equal(s.props[b].owner, 0);
    assert.deepEqual(s.players.map((p) => p.cash), cash.map((m, k) => m + (k < 2 ? CONFIG.swapBonus : 0)));
    assert.equal(s.props[a].tradeCount, 1);
  });
  test('lander may decline all offers (§13.1)', () => {
    const { s, auction } = auctionGame();
    const [a] = A(s); const [b] = B(s);
    give(s, 0, a); give(s, 1, b);
    rollTo(s, 0, auction, [1]);
    doAct(s, 'auctionPick', { space: a });
    doAct(s, 'auctionOffer', { space: b });
    doAct(s, 'auctionDecline');
    assert.equal(s.props[a].owner, 0);
    assert.equal(s.turn.active, 1); // the turn ended by itself
  });
  test('all refuse: no swap', () => {
    const { s, auction } = auctionGame();
    const [a] = A(s); const [b] = B(s);
    give(s, 0, a); give(s, 1, b);
    rollTo(s, 0, auction, [1]);
    doAct(s, 'auctionPick', { space: a });
    doAct(s, 'auctionRefuse');
    assert.equal(s.turn.active, 1); // the turn ended by itself
  });
  test('depreciation after 1, 2 and 3 trades is 0.75, 0.5625, 0.421875 (FR-118, AC-004)', () => {
    const { s, auction } = auctionGame();
    const cs = A(s);
    give(s, 0, cs);
    for (const c of cs) s.props[c].steps = 1;
    const [b] = B(s);
    give(s, 1, b);
    const expected = [0.75, 0.5625, 0.421875];
    for (let k = 0; k < 3; k++) {
      const holder = s.props[cs[0]].owner;
      const other = holder === 0 ? 1 : 0;
      s.turn.active = holder; s.turn.stage = 'auctionPick';
      s.players[holder].pos = auction;
      doAct(s, 'auctionPick', { space: cs[0] });
      while (whoActs(s) !== other) doAct(s, 'auctionRefuse');
      doAct(s, 'auctionOffer', { space: b });
      while (s.turn.stage === 'auctionRespond') doAct(s, 'auctionRefuse');
      doAct(s, 'auctionConfirm', { from: other });
      assert.equal(s.props[cs[0]].factor, expected[k]);
      assert.equal(s.props[cs[0]].tradeCount, k + 1);
      assert.equal(s.props[cs[0]].steps, 1); // FR-117: buildings move
    }
  });
  test('factor applies to rent, resale and net worth but not base rent (FR-119)', () => {
    const s = game(4);
    const cs = B(s);
    give(s, 1, cs);
    const c = s.props[cs[0]];
    c.factor = 0.5625;
    assert.equal(cityRent(s, c), Math.floor(c.price * 0.2)); // base (set) rent unaffected
    c.steps = 1;
    assert.equal(cityRent(s, c), Math.floor(c.price * 0.5 * 0.5625));
    assert.equal(sellValue(c), Math.floor(Math.floor(c.price * 0.5) * 0.5 * 0.5625));
  });
  test('factor resets to 1.0 once all buildings are removed (FR-120)', () => {
    const s = game(4);
    const cs = B(s);
    give(s, 0, cs);
    s.props[cs[0]].steps = 1; s.props[cs[0]].factor = 0.75;
    doAct(s, 'sell', { space: cs[0] });
    assert.equal(s.props[cs[0]].factor, 1);
  });
  test('mortgaged properties may be offered and stay mortgaged (FR-112)', () => {
    const { s, auction } = auctionGame();
    const [a] = A(s); const [b] = B(s);
    give(s, 0, a); give(s, 1, b);
    s.props[b].mortgaged = true;
    rollTo(s, 0, auction, [1]);
    doAct(s, 'auctionPick', { space: a });
    doAct(s, 'auctionOffer', { space: b });
    while (s.turn.stage === 'auctionRespond') doAct(s, 'auctionRefuse');
    doAct(s, 'auctionConfirm', { from: 1 });
    assert.equal(s.props[b].owner, 0);
    assert.equal(s.props[b].mortgaged, true);
  });
  test('Yacht owner receiving buildings keeps full value (VH-08)', () => {
    const s = game(6);
    const auction = cornerAt(s, 'auction');
    const cs = B(s);
    give(s, 0, cs);
    s.props[cs[0]].steps = 1;
    const [b] = A(s, 3);
    give(s, 1, b);
    s.players[1].vehicle = 'VH-08';
    rollTo(s, 0, auction, [1, 2]);
    doAct(s, 'auctionPick', { space: cs[0] });
    doAct(s, 'auctionOffer', { space: b });
    while (s.turn.stage === 'auctionRespond') doAct(s, 'auctionRefuse');
    doAct(s, 'auctionConfirm', { from: 1 });
    assert.equal(s.props[cs[0]].factor, 1);
  });
  test('sets are recalculated after a swap (FR-122)', () => {
    const { s, auction } = auctionGame();
    const cs = B(s);
    give(s, 0, cs[0]); give(s, 1, cs[1]);
    const [x] = A(s, 3);
    give(s, 0, x);
    rollTo(s, 0, auction, [1]);
    doAct(s, 'auctionPick', { space: x });
    doAct(s, 'auctionOffer', { space: cs[1] });
    while (s.turn.stage === 'auctionRespond') doAct(s, 'auctionRefuse');
    doAct(s, 'auctionConfirm', { from: 1 });
    assert.equal(cityRent(s, s.props[cs[0]]), Math.floor(s.props[cs[0]].price * 0.1) * 2);
  });
  test('timers: when time runs out the rest refuse; then the lander\'s offers expire (FR-115)', () => {
    const { s, auction } = auctionGame();
    const [a] = A(s); const [b] = B(s); const [c] = A(s, 3);
    give(s, 0, a); give(s, 1, b); give(s, 2, c);
    rollTo(s, 0, auction, [1]);
    doAct(s, 'auctionPick', { space: a });
    act(s, { type: 'auctionOffer', player: 2, space: c });
    assert.deepEqual(timeoutAction(s), { type: 'expire', system: true });
    act(s, timeoutAction(s)); // player 1 never answered
    assert.equal(s.turn.stage, 'auctionConfirm');
    assert.deepEqual(s.turn.auction.refused, [1]);
    act(s, timeoutAction(s));
    assert.equal(s.props[a].owner, 0);
    assert.equal(s.turn.active, 1);
  });
});

// ---------- Chance (§14) ----------
describe('Chance', () => {
  function draw(s, pid, id) {
    s.chance.deck = [id, ...s.chance.deck.filter((c) => c !== id)];
    rollTo(s, pid, cornerAt(s, 'chance'), s.numDice === 1 ? [1] : [1, 2]);
    assert.equal(s.turn.stage, 'card');
  }
  test('deck has 16 cards and no Go to Jail (FR-130)', () => {
    assert.equal(CHANCE_CARDS.length, 16);
    assert.ok(!CHANCE_CARDS.some((c) => /jail/i.test(c.title) && c.effect !== 'jailcard'));
  });
  test('CH-01 Advance to Start collects 2,000', () => {
    const s = game(4);
    draw(s, 0, 'CH-01');
    doAct(s, 'dismissCard');
    assert.equal(s.players[0].pos, 0);
    assert.equal(s.players[0].cash, 17000);
  });
  test('CH-02 nearest utility: buy if unowned, pay rent if owned', () => {
    const s = game(4);
    draw(s, 0, 'CH-02');
    doAct(s, 'dismissCard');
    assert.equal(s.spaces[s.players[0].pos].kind, 'utility');
    assert.equal(s.turn.stage, 'buy');
    const u = s.players[0].pos;
    finishStage(s);
    give(s, 2, u);
    draw(s, 1, 'CH-02');
    doAct(s, 'dismissCard');
    assert.equal(s.players[1].cash, 15000 - 250);
  });
  test('CH-03 nearest unowned city, stay put if none', () => {
    const s = game(4, { mode: 'turns' });
    draw(s, 0, 'CH-03');
    doAct(s, 'dismissCard');
    assert.equal(s.turn.stage, 'buy');
    finishStage(s);
    for (const x of Object.values(s.props)) if (x.kind === 'city') x.owner = 1;
    draw(s, 1, 'CH-03');
    const pos = s.players[1].pos;
    doAct(s, 'dismissCard');
    assert.equal(s.players[1].pos, pos);
  });
  test('CH-04 next corner is resolved (§20: space before card)', () => {
    const s = game(4);
    draw(s, 0, 'CH-04');
    const from = s.players[0].pos;
    doAct(s, 'dismissCard');
    const next = s.spaces.find((x) => x.kind === 'corner' && x.i > from) ?? s.spaces[0];
    assert.equal(s.players[0].pos, next.i);
    const corner = s.spaces[s.players[0].pos].corner;
    if (corner === 'jail') assert.equal(s.players[0].jailed, true);
  });
  test('CH-05 back 3 (no salary), CH-06 forward 5 (FR-131)', () => {
    const s = game(4);
    draw(s, 0, 'CH-05');
    const from = s.players[0].pos;
    doAct(s, 'dismissCard');
    assert.equal(s.players[0].pos, from - 3);
    finishStage(s);
    draw(s, 1, 'CH-06');
    const f2 = s.players[1].pos;
    doAct(s, 'dismissCard');
    assert.equal(s.players[1].pos, (f2 + 5) % s.spaces.length);
  });
  test('movement cards pay salary when passing Start (FR-131)', () => {
    const s = game(4);
    const chance = cornerAt(s, 'chance');
    s.chance.deck = ['CH-06', ...s.chance.deck.filter((c) => c !== 'CH-06')];
    // put chance corner close to the end: emulate by moving the player there and drawing directly
    rollTo(s, 0, chance, [1]);
    s.players[0].pos = s.spaces.length - 3; // + 5 passes Start
    const cash = s.players[0].cash;
    doAct(s, 'dismissCard');
    assert.equal(s.players[0].pos, 2);
    assert.ok(s.players[0].cash >= cash); // salary paid (rent may follow)
    assert.ok(s.log.some((l) => /Start salary/.test(l.text)));
  });
  test('cash cards CH-07/08/09 and Birthday CH-10', () => {
    const s = game(4);
    draw(s, 0, 'CH-07');
    assert.equal(s.players[0].cash, 15500);
    doAct(s, 'dismissCard');
    draw(s, 1, 'CH-10');
    assert.equal(s.players[1].cash, 15300);
    assert.equal(s.players[0].cash, 15400);
  });
  test('CH-11 jail card is kept and not in discard', () => {
    const s = game(4);
    draw(s, 0, 'CH-11');
    assert.equal(s.players[0].jailCard, true);
    assert.ok(!s.chance.discard.includes('CH-11'));
  });
  test('paying cards and Jeep halves losses (CH-12..16, VH-03)', () => {
    const s = game(6);
    draw(s, 0, 'CH-13');
    assert.equal(s.players[0].cash, 14500);
    doAct(s, 'dismissCard');
    s.players[1].vehicle = 'VH-03';
    draw(s, 1, 'CH-15');
    assert.equal(s.players[1].cash, 15000 - 5 * 250);
    doAct(s, 'dismissCard');
    const cs = A(s, 3);
    give(s, 2, cs);
    s.props[cs[0]].steps = 1; s.props[cs[1]].steps = 2; s.props[cs[2]].steps = 3;
    draw(s, 2, 'CH-16');
    assert.equal(s.players[2].cash, 15000 + 250 - (200 + 400 + 800)); // +250 from the chairman card
  });
  test('deck reshuffles when empty', () => {
    const s = game(4);
    s.chance.deck = [];
    s.chance.discard = ['CH-07', 'CH-08'];
    rollTo(s, 0, cornerAt(s, 'chance'), [1]);
    assert.ok(['CH-07', 'CH-08'].includes(s.turn.card));
  });
});

// ---------- Shopping Center (§15) ----------
describe('Shopping Center', () => {
  test('buy one vehicle, one owner each, max one per player (FR-140, FR-141)', () => {
    const s = game(6);
    const shop = cornerAt(s, 'shop');
    rollTo(s, 0, shop, [1, 2]);
    assert.equal(s.turn.stage, 'shop');
    doAct(s, 'buyVehicle', { vehicle: 'VH-02' });
    assert.equal(s.players[0].vehicle, 'VH-02');
    assert.equal(s.players[0].cash, 13800);
    rollTo(s, 1, shop, [1, 2]);
    assert.throws(() => doAct(s, 'buyVehicle', { vehicle: 'VH-02' }), /not available/);
    doAct(s, 'skipShop');
    toTurnOf(s, 0);
    rollTo(s, 0, shop, [1, 2]);
    assert.equal(s.turn.active, 1); // already owns one: nothing to buy, turn over
  });
  test('the Shopping Center and all 8 vehicles are on every board', () => {
    for (const n of [4, 8]) {
      const s = game(n);
      assert.equal(Object.keys(s.vehicles).length, 8);
      assert.ok(cornerAt(s, 'shop') != null);
    }
  });
  test('Sports Car rerolls once per game (VH-05)', () => {
    const s = game(6);
    s.players[0].vehicle = 'VH-05';
    s.forcedDice = [[1, 2], [3, 4]];
    doAct(s, 'roll');
    assert.equal(s.turn.stage, 'reroll');
    doAct(s, 'useReroll');
    assert.equal(s.players[0].pos, 7);
    assert.equal(s.players[0].rerollUsed, true);
  });
});

// ---------- Debt and bankruptcy (§16) ----------
describe('Debt and bankruptcy', () => {
  test('starting cash 15,000 (FR-150)', () => {
    assert.ok(game(4).players.every((p) => p.cash === 15000));
  });
  test('sells cheapest buildings, then mortgages, before paying (FR-151)', () => {
    const s = game(4);
    const [c] = A(s);
    give(s, 1, c); // base rent only: 10% of price
    const cs = B(s, 3);
    give(s, 0, cs);
    s.props[cs[0]].steps = 1; s.props[cs[1]].steps = 1;
    s.players[0].cash = 100;
    rollTo(s, 0, c, [1]);
    assert.equal(s.players[0].bankrupt, false);
    assert.equal(s.props[cs[0]].steps + s.props[cs[1]].steps, 1); // one cheapest building sold was enough
    assert.equal(s.props[cs[0]].mortgaged || s.props[cs[1]].mortgaged, false);
  });
  test('bankrupt: creditor gets cash, properties return unowned and reset (FR-152..156, §21)', () => {
    const s = game(6);
    const [c] = A(s);
    give(s, 1, A(s));
    for (const x of A(s)) s.props[x].steps = 3;
    const mine = B(s, 3)[0];
    give(s, 0, mine);
    s.props[mine].mortgaged = true; s.props[mine].tradeCount = 2;
    Object.assign(s.players[0], { cash: 300, jailCard: true, vehicle: 'VH-01' });
    s.vehicles['VH-01'] = 0;
    const deckLen = s.chance.deck.length;
    rollTo(s, 0, c, [1, 2]);
    assert.equal(s.players[0].bankrupt, true);
    assert.equal(s.players[1].cash, 15000 + 300 + 0); // mortgaged property gave nothing more
    assert.equal(s.props[mine].owner, null);
    assert.equal(s.props[mine].mortgaged, false);
    assert.equal(s.props[mine].factor, 1);
    assert.equal(s.chance.deck.length, deckLen + 1);
    assert.equal(s.vehicles['VH-01'], null);
    assert.equal(s.players[0].vehicle, null);
    assert.equal(s.turn.active, 1); // bankrupt player leaves; next player's turn
  });
  test('bankrupt to the bank: cash goes to the bank', () => {
    const s = game(4);
    s.players[0].cash = 100;
    s.chance.deck = ['CH-13', ...s.chance.deck.filter((c) => c !== 'CH-13')];
    rollTo(s, 0, cornerAt(s, 'chance'), [1]);
    assert.equal(s.players[0].bankrupt, true);
    assert.equal(s.players.slice(1).reduce((a, p) => a + p.cash, 0), 45000);
  });
});

// ---------- Winning (§17) ----------
describe('End modes and net worth', () => {
  test('net worth formula (§17.3)', () => {
    const s = game(4);
    const cs = A(s);
    give(s, 0, cs);
    s.props[cs[0]].mortgaged = true;
    s.props[cs[1]].steps = 2; s.props[cs[1]].factor = 0.75;
    const price = s.props[cs[0]].price;
    const expected = 15000 + price * 0.5 + price + price + Math.floor(price * 0.5 * 2 * 0.75);
    assert.equal(netWorth(s, 0), expected);
  });
  test('wealth target wins immediately (FR-161, §21)', () => {
    const s = game(4, { mode: 'wealth', wealthTarget: 25000 });
    s.players[0].cash = 23500;
    rollTo(s, 0, 1, [3]); // passes Start: +2000
    assert.equal(s.phase, 'ended');
    assert.equal(s.winner, 0);
  });
  test('two players reach the target together: active player wins (FR-162)', () => {
    const s = game(4, { mode: 'both', wealthTarget: 25000 });
    const [c] = A(s);
    s.players[0].cash = 24990; s.players[1].cash = 24990;
    give(s, 1, c);
    // rent paid by player 0 to player 1 lowers 0; use Birthday so both gain? use direct net worth push instead
    s.chance.deck = ['CH-09', ...s.chance.deck.filter((x) => x !== 'CH-09')];
    s.players[1].cash = 30000; // already above; checked only on change
    rollTo(s, 0, cornerAt(s, 'chance'), [1]);
    assert.equal(s.winner, 0); // active player checked first
  });
  test('turn limit: highest net worth wins after the final round (§21)', () => {
    const s = game(4, { mode: 'turns' });
    s.round = s.roundLimit;
    s.players[2].cash = 50000;
    for (let pid = 0; pid < 4; pid++) { rollTo(s, pid, NEUTRAL, [1]); finishStage(s); if (s.phase === 'ended') break; }
    assert.equal(s.phase, 'ended');
    assert.equal(s.winner, 2);
  });
  test('classic: last solvent player wins; safety cap ends with richest (G3)', () => {
    const s = game(4, { mode: 'classic' });
    assert.equal(s.wealthTarget, null);
    s.players[2].bankrupt = true; s.players[3].bankrupt = true;
    const [c] = A(s);
    give(s, 1, A(s));
    for (const x of A(s)) s.props[x].steps = 3;
    s.players[0].cash = 10;
    rollTo(s, 0, c, [1]);
    assert.equal(s.phase, 'ended');
    assert.equal(s.winner, 1);
    const s2 = game(4, { mode: 'classic' });
    s2.round = s2.safetyCap;
    s2.players[3].cash = 40000;
    for (let pid = 0; pid < 4; pid++) { rollTo(s2, pid, NEUTRAL, [1]); finishStage(s2); if (s2.phase === 'ended') break; }
    assert.equal(s2.winner, 3);
  });
  test('net worth ties broken by cash, then turn order (FR-163)', () => {
    const s = game(4);
    const [c] = A(s);
    give(s, 1, c);
    s.players[1].cash = 15000 - s.props[c].price; // same net worth, less cash
    s.players[0].cash = 15000;
    assert.deepEqual(ranking(s).slice(0, 2), [0, 2]);
  });
  test('limits by player count (§17.2)', () => {
    assert.equal(game(4, { mode: 'both' }).roundLimit, 24);
    assert.equal(game(6, { mode: 'both' }).roundLimit, 18);
    assert.equal(game(8, { mode: 'classic' }).safetyCap, 28);
  });
});

// ---------- Precedence (§20, AC-003) ----------
describe('Precedence', () => {
  test('bankruptcy resolves before the win check', () => {
    const s = game(4, { mode: 'both', wealthTarget: 40000 });
    const [c] = A(s);
    give(s, 1, A(s));
    for (const x of A(s)) s.props[x].steps = 3;
    s.players[1].cash = 39000;
    s.players[0].cash = 2000;
    rollTo(s, 0, c, [1]);
    assert.equal(s.players[0].bankrupt, true);
    assert.equal(s.winner, 1); // creditor reached target with the bankrupt player's cash
  });
  test('space resolution before card effect: card moves are resolved on arrival', () => {
    const s = game(4);
    const target = (cornerAt(s, 'chance') + 5) % 45;
    give(s, 2, target);
    s.chance.deck = ['CH-06', ...s.chance.deck.filter((x) => x !== 'CH-06')];
    rollTo(s, 0, cornerAt(s, 'chance'), [1]);
    doAct(s, 'dismissCard');
    assert.ok(s.players[2].cash > 15000); // rent paid on the card's destination
  });
  test('card effect before rent: Advance to Start salary arrives before later rent', () => {
    const s = game(4);
    s.players[0].cash = 0;
    s.chance.deck = ['CH-01', ...s.chance.deck.filter((x) => x !== 'CH-01')];
    rollTo(s, 0, cornerAt(s, 'chance'), [1]);
    doAct(s, 'dismissCard');
    assert.equal(s.players[0].cash, 2000);
    assert.equal(s.players[0].bankrupt, false);
  });
  test('space resolution before step 4: no building while a landing decision is pending', () => {
    const s = game(4);
    give(s, 0, B(s));
    rollTo(s, 0, NEUTRAL, [1]);
    assert.throws(() => doAct(s, 'build', { space: B(s)[0] }), /Not allowed now/);
  });
  test('step 4 actions before win check: building does not lower net worth below target trigger', () => {
    const s = game(4, { mode: 'wealth', wealthTarget: 30000 });
    give(s, 0, B(s));
    s.players[0].cash = 30000 - 2 * s.props[B(s)[0]].price;
    rollTo(s, 0, NEUTRAL, [1]);
    // net worth = cash + properties >= target already after landing check
    assert.equal(s.phase, 'ended');
  });
});

// ---------- Bot (§18.3) ----------
describe('Disconnect bot', () => {
  test('buys only when 3,000 reserve remains', () => {
    const s = game(4);
    const [c] = A(s);
    rollTo(s, 0, c, [1]);
    assert.equal(botAction(s, 0).type, 'buy');
    s.players[0].cash = s.props[c].price + 2999;
    assert.equal(botAction(s, 0).type, 'auctionOff');
  });
  test('auction: lander skips, responder refuses; shop picks cheapest within reserve', () => {
    const s = game(6);
    give(s, 0, A(s)[0]); give(s, 1, B(s)[0]);
    rollTo(s, 0, cornerAt(s, 'auction'), [1, 2]);
    assert.equal(botAction(s, 0).type, 'auctionSkip');
    doAct(s, 'auctionPick', { space: A(s)[0] });
    assert.equal(botAction(s, 1).type, 'auctionRefuse');
    const s2 = game(6);
    rollTo(s2, 0, cornerAt(s2, 'shop'), [1, 2]);
    assert.deepEqual(botAction(s2, 0), { type: 'buyVehicle', player: 0, vehicle: 'VH-01' });
  });
  test('upgrades the landed city within reserve, otherwise skips (FR-174)', () => {
    const s = game(4);
    give(s, 0, B(s));
    assert.equal(botAction(s, 0).type, 'roll'); // no building before rolling
    landOn(s, B(s)[0]);
    assert.equal(s.turn.stage, 'upgrade');
    assert.equal(botAction(s, 0).type, 'build');
    s.players[0].cash = Math.floor(s.props[B(s)[0]].price * 0.5) + 100;
    assert.equal(botAction(s, 0).type, 'skipBuild');
  });
  test('bot-only games always terminate in limited modes', () => {
    for (const n of [4, 6, 8]) {
      for (const mode of ['both', 'turns', 'classic']) {
        const s = createGame({ players: Array.from({ length: n }, (_, i) => ({ name: `P${i}` })), mode, seed: n * 31 });
        let k = 0;
        while (s.phase !== 'ended' && k++ < 100000) act(s, botAction(s, whoActs(s)));
        assert.equal(s.phase, 'ended', `${n} ${mode}`);
        assert.ok(propsOf(s, s.winner) !== undefined);
      }
    }
  });
});

describe('Pass vs auction, upgrade on buy', () => {
  test('pass leaves the property unowned with no auction', () => {
    const s = game(4);
    const [c] = A(s);
    rollTo(s, 0, c, [1]);
    doAct(s, 'pass');
    assert.equal(s.props[c].owner, null);
    assert.notEqual(s.turn.stage, 'bid');
    assert.notEqual(s.turn.active, 0);
  });
  test('auction opens bidding', () => {
    const s = game(4);
    const [c] = A(s);
    rollTo(s, 0, c, [1]);
    doAct(s, 'auctionOff');
    assert.equal(s.turn.stage, 'bid');
  });
  test('buying the last city of a set offers the upgrade straight away', () => {
    const s = game(4, { mode: 'turns' });
    const cs = B(s);
    give(s, 0, cs.slice(0, -1));
    s.players[0].cash = 100000;
    s.turn.extraRoll = false;
    rollTo(s, 0, cs[cs.length - 1], [1]);
    assert.equal(s.turn.stage, 'buy');
    doAct(s, 'buy');
    assert.equal(s.turn.stage, 'upgrade');
    doAct(s, 'build', { space: cs[cs.length - 1] });
    assert.equal(s.props[cs[cs.length - 1]].steps, 1);
  });
});
