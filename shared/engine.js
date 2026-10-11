// Global Business rules engine. Pure, serialisable state; runs on the server (online) and in the
// browser (pass-and-play). All randomness comes from a seeded RNG stored in the state.
import { CONFIG } from './config.js';
import { TOKENS, REGIONS, SETS, UTILITIES, BOARD_LAYOUT, CORNERS, CORNER_ORDER, SHUFFLED_CORNERS, CHANCE_CARDS, VEHICLES } from './content.js';

export class RuleError extends Error {}

// Bump when the board or state shape changes; older saved games are then discarded.
export const STATE_VERSION = 5;

// ---------- RNG ----------
function nextRandom(state) {
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randInt = (state, n) => Math.floor(nextRandom(state) * n);
function shuffle(state, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(state, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Tests may inject fixed dice via state.forcedDice = [[3,4], [6], ...].
function rollDice(state) {
  if (state.forcedDice?.length) return state.forcedDice.shift().slice();
  return Array.from({ length: state.numDice }, () => 1 + randInt(state, 6));
}
const sum = (d) => d.reduce((a, b) => a + b, 0);
const isDoubles = (d) => d.length === 2 && d[0] === d[1];

// ---------- Setup ----------
/**
 * @param {{players: {name:string}[], mode?: string, wealthTarget?: number, seed?: number}} opts
 */
export function createGame({ players, mode = 'both', wealthTarget = null, seed } = {}) {
  const n = players.length;
  if (n < CONFIG.minPlayers || n > CONFIG.maxPlayers) throw new RuleError(`Need ${CONFIG.minPlayers}-${CONFIG.maxPlayers} players`);
  const limits = CONFIG.limits[n];
  if ((mode === 'both' || mode === 'wealth') && !wealthTarget) wealthTarget = limits.targets[1];
  const state = {
    v: STATE_VERSION,
    rng: (seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0,
    phase: 'firstRoll',
    mode,
    wealthTarget: mode === 'both' || mode === 'wealth' ? wealthTarget : null,
    roundLimit: limits.rounds,
    safetyCap: limits.safetyCap,
    round: 1,
    turnNo: 0,
    numDice: CONFIG.dice,
    players: players.map((p, i) => ({
      id: i, name: String(p.name || `Player ${i + 1}`).slice(0, 16),
      token: null, color: '#888', cash: CONFIG.startingCash, pos: 0,
      jailed: false, jailTurns: 0, jailCard: false, vehicle: null, rerollUsed: false, bankrupt: false,
      orderRolls: [],
    })),
    order: [],
    spaces: [],
    props: {},
    countries: {},
    chance: { deck: [], discard: [] },
    vehicles: {},
    firstRoll: { queue: players.map((_, i) => i), lastRolls: {} },
    tokenPick: { queue: [] },
    turn: null,
    winner: null,
    endReason: null,
    log: [],
    lastEvents: [],
  };
  buildBoard(state);
  state.chance.deck = shuffle(state, CHANCE_CARDS.map((c) => c.id));
  for (const v of VEHICLES) state.vehicles[v.id] = null; // the Shopping Center is on every board
  log(state, `New game: ${n} players, ${state.numDice === 1 ? '1 die' : '2 dice'}, ${state.spaces.length} spaces.`);
  return state;
}

function buildBoard(state) {
  // Fixed 45-space board; Auction, Jail and Chance are shuffled across corners C2-C4 each game (FR-024).
  const corners = CORNER_ORDER.slice();
  const shuffled = shuffle(state, SHUFFLED_CORNERS.slice());
  for (let k = 1; k <= 3; k++) corners[k] = shuffled[k - 1];
  const regionName = (id) => REGIONS.find((r) => r.id === id).name;
  const nextCity = {};
  BOARD_LAYOUT.forEach((slot, i) => {
    if (slot.corner) {
      state.spaces.push({ i, kind: 'corner', corner: corners[slot.corner - 1], region: slot.region });
    } else if (slot.set) {
      const set = SETS.find((x) => x.id === slot.set);
      const k = (nextCity[set.id] = (nextCity[set.id] ?? -1) + 1);
      state.spaces.push({ i, kind: 'city', region: set.region });
      state.props[i] = {
        kind: 'city', id: `${set.id}-${String(k + 1).padStart(2, '0')}`, name: set.cities[k],
        country: set.id, countryName: set.name, color: set.color, region: set.region, regionName: regionName(set.region),
        tier: `Set ${set.id.slice(1)}`, price: set.price,
        owner: null, mortgaged: false, steps: 0, factor: 1, tradeCount: 0,
      };
      (state.countries[set.id] ||= []).push(i);
    } else {
      const u = UTILITIES.find((x) => x.id === slot.utility);
      state.spaces.push({ i, kind: 'utility', region: u.region });
      state.props[i] = {
        kind: 'utility', id: u.id, name: u.name, model: u.model, lm: u.lm,
        region: u.region, regionName: regionName(u.region), price: CONFIG.utilityPrice,
        owner: null, mortgaged: false, tradeCount: 0, steps: 0, factor: 1,
      };
    }
  });
}

// ---------- Helpers ----------
function log(state, text) {
  state.log.push({ n: state.log.length ? state.log[state.log.length - 1].n + 1 : 1, text });
  if (state.log.length > 60) state.log.shift();
}
function emit(state, ev) { state.lastEvents.push(ev); }
const P = (state, id) => state.players[id];
const fmt = (n) => n.toLocaleString('en-IN');
const nm = (state, id) => P(state, id).name;
export const vehicleOf = (p) => (p.vehicle ? VEHICLES.find((v) => v.id === p.vehicle) : null);
const hasVehicle = (p, effect) => vehicleOf(p)?.effect === effect;

export function propsOf(state, pid) {
  return Object.keys(state.props).map(Number).filter((i) => state.props[i].owner === pid);
}
export function completeSet(state, pid, country) {
  return state.countries[country].every((i) => state.props[i].owner === pid);
}
const countryProps = (state, country) => state.countries[country].map((i) => state.props[i]);
const minSteps = (state, country) => Math.min(...countryProps(state, country).map((c) => c.steps));
const maxSteps = (state, country) => Math.max(...countryProps(state, country).map((c) => c.steps));
const utilitiesOwned = (state, pid) => Object.values(state.props).filter((x) => x.kind === 'utility' && x.owner === pid).length;
export const activePlayers = (state) => state.order.filter((id) => !P(state, id).bankrupt);

export function baseBuildCost(c) { return Math.floor(c.price * CONFIG.buildCostRate); }
export function buildCost(state, pid, c) {
  let cost = baseBuildCost(c);
  if (hasVehicle(P(state, pid), 'BUILD_MINUS_10')) cost = Math.floor(cost * (1 - CONFIG.vehicleEffects.truckBuildDiscount));
  return cost;
}
export function sellValue(c) { return Math.floor(baseBuildCost(c) * CONFIG.buildingResaleRate * c.factor); }
export const mortgageValue = (x) => Math.floor(x.price * CONFIG.mortgageRate);
export const unmortgageCost = (x) => Math.floor(x.price * CONFIG.unmortgageRate);

export function cityRent(state, c) {
  if (c.owner == null || c.mortgaged) return 0;
  if (c.steps === 0) {
    const base = Math.floor(c.price * CONFIG.cityRentBase);
    return completeSet(state, c.owner, c.country) ? base * CONFIG.cityRentSetMultiplier : base;
  }
  return Math.floor(c.price * CONFIG.cityRentByStep[c.steps] * c.factor);
}
export function utilityRent(state, u) {
  if (u.owner == null || u.mortgaged) return 0;
  let n = utilitiesOwned(state, u.owner); // FR-082: mortgaged utilities still count
  if (hasVehicle(P(state, u.owner), 'UTILITY_PLUS_ONE')) n += 1;
  return CONFIG.utilityRent[Math.min(n, 4)];
}
export const rentOf = (state, x) => (x.kind === 'city' ? cityRent(state, x) : utilityRent(state, x));
export const spaceName = (state, i) => state.props[i]?.name ?? CORNERS[state.spaces[i].corner]?.name ?? `Space ${i}`;
export const isTransport = (x) => !!x && x.kind === 'utility' && CONFIG.transportModels.includes(x.model);

/** Fare for riding a transport utility `steps` spaces: per-space rate scales with the owner's utility rent. */
export function travelFare(state, u, steps) {
  const perSpace = utilityRent(state, u) * CONFIG.travelFareRate;
  return Math.max(10, Math.round((perSpace * steps) / 10) * 10);
}

// Three trips (near, mid, far) from a transport utility. Never to another transport hub or to Jail.
function travelOptions(state, from, u) {
  const n = state.spaces.length;
  const ok = (i) => !isTransport(state.props[i]) && state.spaces[i].corner !== 'jail';
  const options = [];
  for (const [lo, hi] of CONFIG.travelBands) {
    const steps = [];
    for (let k = lo; k <= Math.min(hi, n - 1); k++) if (ok((from + k) % n)) steps.push(k);
    if (!steps.length) continue;
    const k = steps[randInt(state, steps.length)];
    options.push({ space: (from + k) % n, steps: k, fare: travelFare(state, u, k) });
  }
  return options;
}

export function netWorth(state, pid) {
  const p = P(state, pid);
  let w = p.cash;
  for (const x of Object.values(state.props)) {
    if (x.owner !== pid) continue;
    w += x.mortgaged ? Math.floor(x.price * CONFIG.mortgageRate) : x.price;
    if (x.kind === 'city' && x.steps) w += Math.floor(baseBuildCost(x) * x.steps * x.factor);
  }
  return w;
}

function stepCounts(state, pid) {
  const counts = [0, 0, 0, 0];
  for (const x of Object.values(state.props)) if (x.owner === pid && x.kind === 'city' && x.steps) counts[x.steps]++;
  return counts;
}

// ---------- Legality checks (also used by the UI) ----------
export function canBuild(state, pid, i) {
  const c = state.props[i];
  if (!c || c.kind !== 'city' || c.owner !== pid) return false;
  if (!completeSet(state, pid, c.country)) return false; // FR-063, FR-067
  if (countryProps(state, c.country).some((x) => x.mortgaged)) return false;
  if (c.steps >= 3 || c.steps !== minSteps(state, c.country)) return false; // FR-064
  return P(state, pid).cash >= buildCost(state, pid, c);
}
export function canSell(state, pid, i) {
  const c = state.props[i];
  return !!c && c.kind === 'city' && c.owner === pid && c.steps > 0 && c.steps === maxSteps(state, c.country); // FR-066
}
export function canMortgage(state, pid, i) {
  const x = state.props[i];
  if (!x || x.owner !== pid || x.mortgaged) return false;
  if (x.kind === 'city' && countryProps(state, x.country).some((c) => c.steps > 0)) return false; // FR-069
  return true;
}
export function canUnmortgage(state, pid, i) {
  const x = state.props[i];
  return !!x && x.owner === pid && x.mortgaged && P(state, pid).cash >= unmortgageCost(x);
}

// Who must act next (null if nobody, e.g. game over).
export function whoActs(state) {
  if (state.phase === 'firstRoll') return state.firstRoll.queue[0] ?? null;
  if (state.phase === 'tokenPick') return state.tokenPick.queue[0] ?? null;
  if (state.phase !== 'turn') return null;
  const t = state.turn;
  if (t.stage === 'auctionRespond') return t.auction.queue[0];
  return t.active;
}

// ---------- Money ----------
function credit(state, to, amount) {
  if (to != null && to !== 'bank') P(state, to).cash += amount;
}

function liquidateCheapest(state, pid) {
  // Sell the cheapest sellable building first, then mortgage the cheapest property (§18.3, B.7).
  const owned = propsOf(state, pid);
  const sellable = owned.filter((i) => canSell(state, pid, i)).sort((a, b) => sellValue(state.props[a]) - sellValue(state.props[b]) || a - b);
  if (sellable.length) { doSell(state, pid, sellable[0], true); return true; }
  const mortgageable = owned.filter((i) => canMortgage(state, pid, i)).sort((a, b) => state.props[a].price - state.props[b].price || a - b);
  if (mortgageable.length) { doMortgage(state, pid, mortgageable[0], true); return true; }
  return false;
}

// Returns true if paid in full, false if the payer went bankrupt.
// `kind` tags what the payment was for (rent, fare, tax, jail, card) and `space` the property involved,
// so clients can announce it.
function pay(state, pid, to, amount, reason, { kind = null, space = null } = {}) {
  const p = P(state, pid);
  if (amount <= 0) return true;
  if (p.cash < amount) {
    let raised = false;
    while (p.cash < amount && liquidateCheapest(state, pid)) raised = true;
    if (raised) log(state, `${p.name} raised cash by selling buildings and mortgaging.`);
  }
  if (p.cash < amount) { bankrupt(state, pid, to); return false; }
  p.cash -= amount;
  credit(state, to, amount);
  emit(state, { type: 'pay', from: pid, to, amount, reason: reason ?? null, kind, space });
  log(state, `${p.name} paid ${fmt(amount)}${to != null && to !== 'bank' ? ` to ${nm(state, to)}` : ''}${reason ? ` (${reason})` : ''}.`);
  return true;
}
function receive(state, pid, amount, reason) {
  P(state, pid).cash += amount;
  emit(state, { type: 'earn', to: pid, amount, reason: reason ?? null });
  log(state, `${nm(state, pid)} collected ${fmt(amount)}${reason ? ` (${reason})` : ''}.`);
}

function bankrupt(state, pid, to) {
  const p = P(state, pid);
  credit(state, to, p.cash); // FR-153
  p.cash = 0;
  for (const x of Object.values(state.props)) {
    if (x.owner !== pid) continue;
    Object.assign(x, { owner: null, mortgaged: false, steps: 0, factor: 1 }); // FR-154
  }
  if (p.jailCard) { p.jailCard = false; state.chance.deck.push('CH-11'); } // FR-155
  if (p.vehicle) { state.vehicles[p.vehicle] = null; p.vehicle = null; }
  p.bankrupt = true;
  p.jailed = false;
  emit(state, { type: 'bankrupt', player: pid });
  log(state, `💥 ${p.name} is bankrupt and leaves the game.`);
  checkLastStanding(state);
}

// ---------- Win checks ----------
function endGame(state, winner, reason) {
  if (state.phase === 'ended') return;
  state.phase = 'ended';
  state.winner = winner;
  state.endReason = reason;
  if (state.turn) state.turn.stage = 'over';
  emit(state, { type: 'gameOver', winner, reason });
  log(state, `🏆 ${nm(state, winner)} wins! (${reason})`);
}
export function ranking(state) {
  const idx = (id) => state.order.indexOf(id);
  return state.order.slice().sort((a, b) => {
    const pa = P(state, a), pb = P(state, b);
    if (pa.bankrupt !== pb.bankrupt) return pa.bankrupt ? 1 : -1;
    return netWorth(state, b) - netWorth(state, a) || pb.cash - pa.cash || idx(a) - idx(b); // FR-163
  });
}
function turnOrderFrom(state, start) {
  const k = state.order.indexOf(start);
  return state.order.slice(k).concat(state.order.slice(0, k));
}
function checkWealth(state) {
  if (state.phase !== 'turn' || !state.wealthTarget) return;
  for (const q of turnOrderFrom(state, state.turn.active)) { // FR-162
    if (P(state, q).bankrupt) continue;
    if (netWorth(state, q) >= state.wealthTarget) { endGame(state, q, 'Reached the wealth target'); return; }
  }
}
function checkLastStanding(state) {
  const alive = activePlayers(state);
  if (state.phase === 'turn' && alive.length === 1) endGame(state, alive[0], 'Last player standing');
}

// ---------- Actions ----------
export function act(state, action) {
  state.lastEvents = [];
  const actor = action.player;
  if (state.phase === 'ended') throw new RuleError('The game is over');
  const expected = whoActs(state);
  const manageAction = ['build', 'sell', 'mortgage', 'unmortgage'].includes(action.type);
  if (actor !== expected) throw new RuleError('Not your move');
  const handler = HANDLERS[action.type];
  if (!handler) throw new RuleError(`Unknown action ${action.type}`);
  // Step 4 (build, sell, mortgage) happens on your own turn before you roll, or while a doubles re-roll is pending.
  if (manageAction && !(state.phase === 'turn' && ['roll', 'manage'].includes(state.turn.stage))) throw new RuleError('You can only manage properties before you roll');
  handler(state, action);
  checkWealth(state); // FR-161: immediate wealth check
  return state.lastEvents;
}

const HANDLERS = {
  // First roll (FR-014, FR-015)
  orderRoll(state, { player }) {
    if (state.phase !== 'firstRoll') throw new RuleError('Not rolling for order');
    const dice = rollDice(state);
    const p = P(state, player);
    p.orderRolls.push(sum(dice));
    state.firstRoll.lastRolls[player] = dice;
    state.firstRoll.queue.shift();
    emit(state, { type: 'dice', player, dice });
    log(state, `${p.name} rolled ${sum(dice)} for turn order.`);
    if (state.firstRoll.queue.length) return;
    // Group by roll history; tied groups re-roll among themselves.
    const groups = new Map();
    for (const q of state.players) {
      const key = q.orderRolls.join(',');
      (groups.get(key) || groups.set(key, []).get(key)).push(q.id);
    }
    const tied = [...groups.values()].filter((g) => g.length > 1).flat();
    if (tied.length) {
      state.firstRoll.queue = tied;
      log(state, `Tie! ${tied.map((id) => nm(state, id)).join(', ')} roll again.`);
      emit(state, { type: 'tie', players: tied });
      return;
    }
    const cmp = (a, b) => {
      const ra = P(state, a).orderRolls, rb = P(state, b).orderRolls;
      for (let i = 0; i < Math.max(ra.length, rb.length); i++) {
        const d = (rb[i] ?? -1) - (ra[i] ?? -1);
        if (d) return d;
      }
      return 0;
    };
    state.order = state.players.map((q) => q.id).sort(cmp);
    state.phase = 'tokenPick';
    state.tokenPick.queue = state.order.slice();
    log(state, `Turn order: ${state.order.map((id) => nm(state, id)).join(' → ')}.`);
  },

  pickToken(state, { player, token }) {
    if (state.phase !== 'tokenPick') throw new RuleError('Not picking tokens');
    const t = TOKENS.find((x) => x.id === token);
    if (!t) throw new RuleError('Unknown token');
    if (state.players.some((q) => q.token === token)) throw new RuleError('Token already taken');
    const p = P(state, player);
    p.token = t.id; p.color = t.color;
    state.tokenPick.queue.shift();
    log(state, `${p.name} is the ${t.name}.`);
    if (!state.tokenPick.queue.length) {
      state.phase = 'turn';
      startTurn(state, state.order[0]);
    }
  },

  useJailCard(state, { player }) {
    const t = needStage(state, 'jail');
    const p = P(state, player);
    p.jailCard = false;
    state.chance.deck.push('CH-11'); // FR-132: back to the bottom of the deck
    release(state, p, 'used Get Out of Jail Free');
    t.stage = 'roll';
  },
  skipJailCard(state, { player }) {
    const t = needStage(state, 'jail');
    const p = P(state, player);
    t.stage = 'roll';
    if (p.jailTurns >= CONFIG.jailMaxFailedRolls) payJailFee(state, p);
  },

  roll(state, { player }) {
    const t = state.turn;
    if (state.phase !== 'turn') throw new RuleError('Not your turn');
    const extra = t.stage === 'manage' && t.extraRoll;
    if (t.stage !== 'roll' && !extra) throw new RuleError('You cannot roll now');
    if (extra) { t.extraRoll = false; t.extraUsed = true; }
    const dice = rollDice(state);
    t.dice = dice;
    emit(state, { type: 'dice', player, dice });
    const p = P(state, player);
    if (hasVehicle(p, 'REROLL_ONCE') && !p.rerollUsed) {
      t.stage = 'reroll';
      t.pendingDice = dice;
      return;
    }
    proceedRoll(state, p, dice);
  },
  useReroll(state, { player }) {
    const t = needStage(state, 'reroll');
    const p = P(state, player);
    p.rerollUsed = true;
    const dice = rollDice(state);
    t.dice = dice;
    emit(state, { type: 'dice', player, dice, reroll: true });
    log(state, `${p.name} used the Sports Car reroll.`);
    proceedRoll(state, p, dice);
  },
  keepRoll(state, { player }) {
    const t = needStage(state, 'reroll');
    proceedRoll(state, P(state, player), t.pendingDice);
  },

  buy(state, { player }) {
    const t = needStage(state, 'buy');
    const x = state.props[t.buy];
    const p = P(state, player);
    if (p.cash < x.price) throw new RuleError('Not enough cash');
    p.cash -= x.price;
    x.owner = player;
    emit(state, { type: 'buy', player, space: t.buy });
    log(state, `${p.name} bought ${x.name} for ${fmt(x.price)}.`);
    t.buy = null;
    toManage(state);
  },
  travel(state, { player, option }) {
    const t = needStage(state, 'travel');
    const trip = t.travel.options[option];
    if (!trip) throw new RuleError('Pick one of the destinations');
    const from = t.travel.from, x = state.props[from];
    const p = P(state, player);
    t.travel = null;
    if (!pay(state, player, x.owner, trip.fare, `${x.name} fare, ${trip.steps} spaces`, { kind: 'fare', space: from })) return afterBankruptActive(state);
    emit(state, { type: 'travel', player, from, to: trip.space, fare: trip.fare, owner: x.owner });
    log(state, `${p.name} travels to ${spaceName(state, trip.space)}.`);
    moveBy(state, p, trip.steps);
    resolveSpace(state, p);
  },
  decline(state, { player }) {
    const t = needStage(state, 'buy');
    log(state, `${nm(state, player)} passed on ${state.props[t.buy].name}.`); // FR-050: stays unowned
    t.buy = null;
    toManage(state);
  },

  // Auction (§13)
  auctionPick(state, { player, space }) {
    const t = needStage(state, 'auctionPick');
    const x = state.props[space];
    if (!x || x.owner !== player) throw new RuleError('Pick one of your own properties');
    const queue = turnOrderFrom(state, player).slice(1).filter((q) => !P(state, q).bankrupt && propsOf(state, q).length);
    t.auction = { offered: space, queue, offers: [], refused: [] };
    log(state, `🔨 ${nm(state, player)} puts ${x.name} up for swap.`);
    emit(state, { type: 'auction', player, space });
    if (!queue.length) { log(state, 'Nobody has a property to offer.'); t.auction = null; toManage(state); return; }
    t.stage = 'auctionRespond';
  },
  auctionSkip(state, { player }) {
    needStage(state, 'auctionPick');
    log(state, `${nm(state, player)} skipped the auction.`);
    toManage(state);
  },
  auctionOffer(state, { player, space }) {
    const t = needStage(state, 'auctionRespond');
    const x = state.props[space];
    if (!x || x.owner !== player) throw new RuleError('Offer one of your own properties');
    t.auction.offers.push({ player, space });
    log(state, `${nm(state, player)} offers ${x.name}.`);
    nextResponder(state);
  },
  auctionRefuse(state, { player }) {
    const t = needStage(state, 'auctionRespond');
    t.auction.refused.push(player);
    log(state, `${nm(state, player)} refuses.`);
    nextResponder(state);
  },
  auctionConfirm(state, { player, from }) {
    const t = needStage(state, 'auctionConfirm');
    const offer = t.auction.offers.find((o) => o.player === from);
    if (!offer) throw new RuleError('No such offer');
    swap(state, t.auction.offered, offer.space);
    t.auction = null;
    toManage(state);
  },
  auctionDecline(state, { player }) {
    needStage(state, 'auctionConfirm');
    log(state, `${nm(state, player)} declined all offers.`);
    state.turn.auction = null;
    toManage(state);
  },

  buyVehicle(state, { player, vehicle }) {
    needStage(state, 'shop');
    const v = VEHICLES.find((x) => x.id === vehicle);
    const p = P(state, player);
    if (!v || state.vehicles[v.id] !== null) throw new RuleError('Vehicle not available');
    if (p.vehicle) throw new RuleError('You already own a vehicle'); // FR-141
    if (p.cash < v.price) throw new RuleError('Not enough cash');
    p.cash -= v.price;
    p.vehicle = v.id;
    state.vehicles[v.id] = player;
    emit(state, { type: 'vehicle', player, vehicle: v.id });
    log(state, `${p.name} bought the ${v.name} ${v.icon}.`);
    toManage(state);
  },
  skipShop(state, { player }) {
    needStage(state, 'shop');
    log(state, `${nm(state, player)} left the Shopping Center.`);
    toManage(state);
  },

  dismissCard(state) { needStage(state, 'card'); continueAfterCard(state); },

  // Step 4 (FR-031): active player only, checked in act()
  build(state, { player, space }) {
    if (!canBuild(state, player, space)) throw new RuleError('You cannot build there');
    const c = state.props[space];
    const cost = buildCost(state, player, c);
    P(state, player).cash -= cost;
    c.steps += 1;
    emit(state, { type: 'build', player, space, steps: c.steps });
    log(state, `${nm(state, player)} built a ${STEP_NAMES[c.steps]} in ${c.name} (${fmt(cost)}).`);
  },
  sell(state, { player, space }) {
    if (!canSell(state, player, space)) throw new RuleError('You cannot sell there');
    doSell(state, player, space);
  },
  mortgage(state, { player, space }) {
    if (!canMortgage(state, player, space)) throw new RuleError('You cannot mortgage that');
    doMortgage(state, player, space);
  },
  unmortgage(state, { player, space }) {
    if (!canUnmortgage(state, player, space)) throw new RuleError('You cannot unmortgage that');
    const x = state.props[space];
    const cost = unmortgageCost(x);
    P(state, player).cash -= cost;
    x.mortgaged = false;
    emit(state, { type: 'unmortgage', player, space });
    log(state, `${nm(state, player)} unmortgaged ${x.name} (${fmt(cost)}).`);
  },


};

export const STEP_NAMES = ['none', 'house', 'building', 'tower'];

function needStage(state, stage) {
  if (state.phase !== 'turn' || state.turn.stage !== stage) throw new RuleError(`Not allowed now (${state.turn?.stage ?? state.phase})`);
  return state.turn;
}

function doSell(state, pid, i, auto = false) {
  const c = state.props[i];
  const value = sellValue(c);
  c.steps -= 1;
  if (c.steps === 0) c.factor = 1; // FR-120
  P(state, pid).cash += value;
  emit(state, { type: 'sell', player: pid, space: i, steps: c.steps });
  if (!auto) log(state, `${nm(state, pid)} sold a building in ${c.name} for ${fmt(value)}.`);
}
function doMortgage(state, pid, i, auto = false) {
  const x = state.props[i];
  x.mortgaged = true;
  P(state, pid).cash += mortgageValue(x);
  emit(state, { type: 'mortgage', player: pid, space: i });
  if (!auto) log(state, `${nm(state, pid)} mortgaged ${x.name} for ${fmt(mortgageValue(x))}.`);
}

function swap(state, a, b) {
  const xa = state.props[a], xb = state.props[b];
  const oa = xa.owner, ob = xb.owner;
  xa.owner = ob; xb.owner = oa;
  for (const x of [xa, xb]) {
    x.tradeCount += 1;
    if (x.kind === 'city' && x.steps > 0 && !hasVehicle(P(state, x.owner), 'TRADE_NO_DEPRECIATION')) {
      x.factor *= CONFIG.depreciationPerTrade; // FR-118
    }
  }
  emit(state, { type: 'swap', a, b });
  log(state, `🤝 Swap! ${nm(state, oa)} gets ${xb.name}, ${nm(state, ob)} gets ${xa.name}.`);
}

function nextResponder(state) {
  const t = state.turn;
  t.auction.queue.shift();
  if (t.auction.queue.length) return;
  if (!t.auction.offers.length) {
    log(state, 'No offers were made.');
    t.auction = null;
    toManage(state);
    return;
  }
  t.stage = 'auctionConfirm';
}

// ---------- Turn flow ----------
function startTurn(state, pid) {
  const p = P(state, pid);
  state.turnNo += 1;
  state.turn = {
    active: pid, stage: 'roll', dice: null, extraRoll: false, extraUsed: false, rolls: 0,
    escaped: false, buy: null, auction: null, card: null, travel: null, pendingDice: null, turnNo: state.turnNo,
  };
  emit(state, { type: 'turnStart', player: pid });
  log(state, `— ${p.name}'s turn (round ${state.round}) —`);
  if (!p.jailed) return;
  if (hasVehicle(p, 'JAIL_FREE_FIRST') && p.jailTurns === 0) { release(state, p, 'flew out by Helicopter'); return; }
  if (p.jailCard) { state.turn.stage = 'jail'; return; }
  if (p.jailTurns >= CONFIG.jailMaxFailedRolls) payJailFee(state, p);
}

function payJailFee(state, p) {
  if (!pay(state, p.id, 'bank', CONFIG.jailFee, 'jail release', { kind: 'jail' })) { afterBankruptActive(state); return; }
  release(state, p, `paid ${fmt(CONFIG.jailFee)} to leave jail`);
}
function release(state, p, how) {
  p.jailed = false;
  p.jailTurns = 0;
  emit(state, { type: 'release', player: p.id });
  log(state, `🔓 ${p.name} ${how}.`);
}

function proceedRoll(state, p, dice) {
  const t = state.turn;
  t.pendingDice = null;
  t.rolls += 1;
  const total = sum(dice);
  log(state, `${p.name} rolled ${dice.join(' + ')}${dice.length > 1 ? ` = ${total}` : ''}.`);
  if (p.jailed) {
    const escaped = state.numDice === 1 ? total === CONFIG.jailEscapeFace1d6 : isDoubles(dice); // FR-093
    if (!escaped) {
      p.jailTurns += 1;
      log(state, `${p.name} stays in jail.`);
      toManage(state); // FR-095: jailed players manage before rolling, like everyone else
      return;
    }
    release(state, p, 'escaped jail');
    t.escaped = true; // FR-044: no extra roll
  } else if (state.numDice === 2 && isDoubles(dice) && !t.extraUsed && t.rolls === 1) {
    t.extraRoll = true; // FR-041
    log(state, 'Doubles! One extra roll after this move.');
  }
  moveBy(state, p, total);
  resolveSpace(state, p);
}

function moveBy(state, p, steps) {
  const n = state.spaces.length;
  const path = [];
  let pos = p.pos;
  const dir = steps >= 0 ? 1 : -1;
  for (let k = 0; k < Math.abs(steps); k++) {
    pos = (pos + dir + n) % n;
    path.push(pos);
    if (dir > 0 && pos === 0) paySalary(state, p); // FR-043: passing or landing on Start
  }
  p.pos = pos;
  emit(state, { type: 'move', player: p.id, path });
}
function moveTo(state, p, target) {
  const n = state.spaces.length;
  moveBy(state, p, (target - p.pos + n) % n || 0);
}
function paySalary(state, p) {
  let amount = CONFIG.startSalary;
  if (hasVehicle(p, 'START_SALARY_PLUS_10')) amount = Math.floor(amount * (1 + CONFIG.vehicleEffects.scooterSalaryBonus));
  receive(state, p.id, amount, 'Start salary');
}

function resolveSpace(state, p) {
  if (p.bankrupt || state.phase === 'ended') return;
  const t = state.turn;
  const space = state.spaces[p.pos];
  emit(state, { type: 'land', player: p.id, space: p.pos });
  if (space.kind !== 'corner') {
    const x = state.props[p.pos];
    if (x.owner == null) { t.stage = 'buy'; t.buy = p.pos; return; }
    if (x.owner === p.id) { log(state, `${p.name} visits their own ${x.name}.`); return toManage(state); }
    if (x.mortgaged) { log(state, `${x.name} is mortgaged: no rent.`); return toManage(state); }
    if (isTransport(x)) {
      // Transport: pick one of three trips and pay the owner a fare by distance (no flat rent).
      t.travel = { from: p.pos, options: travelOptions(state, p.pos, x) };
      t.stage = 'travel';
      log(state, `🚆 ${p.name} boards ${x.name} (owned by ${nm(state, x.owner)}): pick a destination.`);
      return;
    }
    const rent = rentOf(state, x);
    if (!pay(state, p.id, x.owner, rent, `rent for ${x.name}`, { kind: 'rent', space: p.pos })) return afterBankruptActive(state);
    return toManage(state);
  }
  switch (space.corner) {
    case 'start':
      return toManage(state); // salary already paid on arrival
    case 'jail':
      p.jailed = true; p.jailTurns = 0;
      t.extraRoll = false; // FR-091
      emit(state, { type: 'jailed', player: p.id });
      log(state, `🔒 ${p.name} is in jail!`);
      return toManage(state);
    case 'auction':
      if (!propsOf(state, p.id).length) { log(state, `${p.name} owns nothing to swap.`); return toManage(state); }
      t.stage = 'auctionPick';
      return;
    case 'chance':
      return drawChance(state, p);
    case 'tax': {
      const counts = stepCounts(state, p.id);
      let tax = counts.reduce((a, c, s) => a + c * CONFIG.taxPerStep[s], 0);
      if (hasVehicle(p, 'TAX_MINUS_25')) tax = Math.floor(tax * (1 - CONFIG.vehicleEffects.tuktukTaxDiscount));
      if (!tax) { log(state, `${p.name} owns no buildings: no tax.`); return toManage(state); }
      if (!pay(state, p.id, 'bank', tax, 'building tax', { kind: 'tax' })) return afterBankruptActive(state);
      return toManage(state);
    }
    case 'shop': {
      const available = Object.entries(state.vehicles).filter(([, o]) => o === null);
      if (p.vehicle || !available.length) { log(state, `${p.name} browses the Shopping Center.`); return toManage(state); }
      t.stage = 'shop';
      return;
    }
  }
  toManage(state);
}

function drawChance(state, p) {
  const ch = state.chance;
  if (!ch.deck.length) { ch.deck = shuffle(state, ch.discard); ch.discard = []; }
  const id = ch.deck.shift();
  const card = CHANCE_CARDS.find((c) => c.id === id);
  if (card.effect !== 'jailcard') ch.discard.push(id);
  emit(state, { type: 'card', player: p.id, card: id });
  log(state, `❓ ${p.name} drew "${card.title}".`);
  state.turn.card = id;
  state.turn.stage = 'card';
  // Effects without movement apply now; movement effects apply when the card is dismissed.
  if (!['start', 'utility', 'land', 'corner', 'move'].includes(card.effect)) applyCard(state, p, card);
}
function continueAfterCard(state) {
  const t = state.turn;
  const card = CHANCE_CARDS.find((c) => c.id === t.card);
  const p = P(state, t.active);
  t.card = null;
  if (['start', 'utility', 'land', 'corner', 'move'].includes(card.effect)) { t.stage = 'moving'; applyCard(state, p, card); }
  else toManage(state);
}

function applyCard(state, p, card) {
  const loss = (amt) => (hasVehicle(p, 'CHANCE_LOSS_HALF') ? Math.floor(amt * CONFIG.vehicleEffects.jeepChanceLossFactor) : amt);
  switch (card.effect) {
    case 'start':
      moveTo(state, p, 0); // salary is paid on arrival
      return toManage(state);
    case 'utility': {
      const target = findForward(state, p.pos, (i) => state.spaces[i].kind === 'utility');
      moveTo(state, p, target);
      return resolveSpace(state, p);
    }
    case 'land': {
      const target = findForward(state, p.pos, (i) => state.spaces[i].kind === 'city' && state.props[i].owner == null);
      if (target == null) { log(state, 'No unowned city left: stay put.'); return toManage(state); }
      moveTo(state, p, target);
      return resolveSpace(state, p);
    }
    case 'corner': {
      const target = findForward(state, p.pos, (i) => state.spaces[i].kind === 'corner');
      moveTo(state, p, target);
      return resolveSpace(state, p);
    }
    case 'move':
      moveBy(state, p, card.amount);
      return resolveSpace(state, p);
    case 'cash':
      receive(state, p.id, card.amount, card.title);
      return;
    case 'birthday':
      for (const q of turnOrderFrom(state, p.id).slice(1)) {
        if (!P(state, q).bankrupt) pay(state, q, p.id, card.amount, 'birthday');
        if (state.phase === 'ended') return;
      }
      return;
    case 'jailcard':
      p.jailCard = true;
      return;
    case 'pay':
      if (!pay(state, p.id, 'bank', loss(card.amount), card.title)) afterBankruptActive(state);
      return;
    case 'payall':
      for (const q of turnOrderFrom(state, p.id).slice(1)) {
        if (P(state, q).bankrupt) continue;
        if (!pay(state, p.id, q, loss(card.amount), 'chairman')) { afterBankruptActive(state); return; }
      }
      return;
    case 'repairs': {
      const counts = stepCounts(state, p.id);
      const amt = loss(counts.reduce((a, c, s) => a + c * CONFIG.repairsPerStep[s], 0));
      if (!amt) { log(state, 'No buildings to repair.'); return; }
      if (!pay(state, p.id, 'bank', amt, 'repairs')) afterBankruptActive(state);
      return;
    }
  }
}

function findForward(state, from, pred) {
  const n = state.spaces.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (pred(i)) return i;
  }
  return null;
}

// The space is resolved. With a doubles re-roll pending the player stays on (and may manage first);
// otherwise the turn ends immediately: there is no end-turn button or delay.
function toManage(state) {
  if (state.phase !== 'turn') return;
  const t = state.turn;
  const p = P(state, t.active);
  if (p.jailed) t.extraRoll = false;
  if (t.extraRoll) { t.stage = 'manage'; return; }
  advanceTurn(state);
}

function afterBankruptActive(state) {
  if (state.phase !== 'turn') return;
  advanceTurn(state);
}

function advanceTurn(state) {
  if (state.phase !== 'turn') return;
  const cur = state.turn.active;
  const k = state.order.indexOf(cur);
  let next = null, wrapped = false;
  for (let s = 1; s <= state.order.length; s++) {
    const idx = (k + s) % state.order.length;
    if (k + s >= state.order.length) wrapped = true;
    if (!P(state, state.order[idx]).bankrupt) { next = state.order[idx]; break; }
  }
  if (next == null) return;
  if (wrapped) {
    // End of round (§17)
    if ((state.mode === 'both' || state.mode === 'turns') && state.round >= state.roundLimit) {
      endGame(state, ranking(state)[0], `Turn limit of ${state.roundLimit} rounds reached`);
      return;
    }
    if (state.mode === 'classic' && state.round >= state.safetyCap) {
      endGame(state, ranking(state)[0], `Safety cap of ${state.safetyCap} rounds reached`);
      return;
    }
    state.round += 1;
  }
  startTurn(state, next);
}

// ---------- Bot (FR-174) ----------
export function botAction(state, pid) {
  const reserve = CONFIG.botCashReserve;
  const p = P(state, pid);
  if (state.phase === 'firstRoll') return { type: 'orderRoll', player: pid };
  if (state.phase === 'tokenPick') return { type: 'pickToken', player: pid, token: TOKENS.find((t) => !state.players.some((q) => q.token === t.id)).id };
  const t = state.turn;
  switch (t.stage) {
    case 'jail': return { type: 'useJailCard', player: pid };
    case 'roll': return botBuild(state, pid) ?? { type: 'roll', player: pid };
    case 'reroll': return { type: 'keepRoll', player: pid };
    case 'card': return { type: 'dismissCard', player: pid };
    case 'buy': return p.cash - state.props[t.buy].price >= reserve ? { type: 'buy', player: pid } : { type: 'decline', player: pid };
    case 'travel': { // cheapest trip
      const k = t.travel.options.reduce((best, o, i, all) => (o.fare < all[best].fare ? i : best), 0);
      return { type: 'travel', player: pid, option: k };
    }
    case 'auctionPick': return { type: 'auctionSkip', player: pid };
    case 'auctionRespond': return { type: 'auctionRefuse', player: pid };
    case 'auctionConfirm': return { type: 'auctionDecline', player: pid };
    case 'shop': {
      const v = VEHICLES.filter((x) => state.vehicles[x.id] === null).sort((a, b) => a.price - b.price)[0];
      return v && p.cash - v.price >= reserve ? { type: 'buyVehicle', player: pid, vehicle: v.id } : { type: 'skipShop', player: pid };
    }
    case 'manage': return botBuild(state, pid) ?? { type: 'roll', player: pid }; // only reached with a re-roll pending
  }
  return null;
}

// Bot builds the cheapest legal step while keeping its cash reserve (FR-174).
function botBuild(state, pid) {
  const p = P(state, pid);
  const options = propsOf(state, pid).filter((i) => canBuild(state, pid, i))
    .sort((a, b) => buildCost(state, pid, state.props[a]) - buildCost(state, pid, state.props[b]) || a - b);
  if (options.length && p.cash - buildCost(state, pid, state.props[options[0]]) >= CONFIG.botCashReserve) return { type: 'build', player: pid, space: options[0] };
  return null;
}

// Online timers (FR-115): what happens when a responder or lander runs out of time.
export function timeoutAction(state) {
  if (state.phase !== 'turn') return null;
  const t = state.turn;
  if (t.stage === 'auctionRespond') return { type: 'auctionRefuse', player: t.auction.queue[0] };
  if (t.stage === 'auctionConfirm') return { type: 'auctionDecline', player: t.active };
  return null;
}
