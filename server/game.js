// Authoritative Monopoly rules engine. Pure game logic, no networking.
import {
  TILES, GROUPS, OWNABLE, RAILROADS, UTILITIES, CHANCE, CHEST,
  START_MONEY, GO_SALARY, JAIL_FINE, mortgageValue, unmortgageCost,
} from '../shared/board.js';

const AUCTION_MS = 15000;
const MAX_LOG = 80;
const MAX_EVENTS = 20;

const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};
const die = () => 1 + Math.floor(Math.random() * 6);
const money = (n) => `$${n}`;

export class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg); };

export class Game {
  /**
   * @param {Array<{id:string,name:string,color:string,token:string}>} players
   * @param {() => void} onAsyncChange called when state changes outside a player action (auction timer)
   */
  constructor(players, onAsyncChange = () => {}) {
    this.players = players.map((p) => ({
      id: p.id, name: p.name, color: p.color, token: p.token,
      money: START_MONEY, pos: 0, inJail: false, jailTurns: 0, jailCards: [], bankrupt: false,
    }));
    this.props = {};
    for (const i of OWNABLE) this.props[i] = { owner: null, houses: 0, mortgaged: false };
    this.turn = 0;
    this.phase = 'roll'; // roll | buy | auction | debt | end | over
    this.dice = [1, 1];
    this.doubles = 0;
    this.extraRoll = false;
    this.decks = {
      chance: shuffle(CHANCE.map((_, i) => i)),
      chest: shuffle(CHEST.map((_, i) => i)),
    };
    this.creditor = {}; // debtor id -> creditor id (null = bank)
    this.auction = null;
    this.trades = [];
    this.tradeSeq = 0;
    this.log = [];
    this.events = [];
    this.eventSeq = 0;
    this.lastCard = null;
    this.winner = null;
    this.onAsyncChange = onAsyncChange;
    this.auctionTimer = null;
    this.addLog(`Game started! ${this.cur().name} goes first.`);
  }

  // ---------- helpers ----------
  cur() { return this.players[this.turn]; }
  player(id) { return this.players.find((p) => p.id === id); }
  active() { return this.players.filter((p) => !p.bankrupt); }
  addLog(text) {
    this.log.push({ t: Date.now(), text });
    if (this.log.length > MAX_LOG) this.log.shift();
  }
  event(e) {
    this.events.push({ id: ++this.eventSeq, ...e });
    if (this.events.length > MAX_EVENTS) this.events.shift();
  }
  ownedBy(id) { return OWNABLE.filter((i) => this.props[i].owner === id); }
  ownsGroup(id, group) { return GROUPS[group].every((i) => this.props[i].owner === id); }
  groupHasHouses(i) {
    const t = TILES[i];
    return t.type === 'property' && GROUPS[t.group].some((j) => this.props[j].houses > 0);
  }

  pay(from, to, amount, why) {
    from.money -= amount;
    if (to) to.money += amount;
    if (from.money < 0) this.creditor[from.id] = to ? to.id : null;
    this.addLog(`${from.name} paid ${money(amount)}${to ? ` to ${to.name}` : ''}${why ? ` (${why})` : ''}.`);
  }

  rent(i, { rrMult = 1, utilMult = 0 } = {}) {
    const t = TILES[i], pr = this.props[i], owner = pr.owner;
    if (t.type === 'property') {
      if (pr.houses > 0) return t.rent[pr.houses];
      return this.ownsGroup(owner, t.group) ? t.rent[0] * 2 : t.rent[0];
    }
    const roll = this.dice[0] + this.dice[1];
    if (t.type === 'railroad') {
      const n = RAILROADS.filter((r) => this.props[r].owner === owner).length;
      return 25 * 2 ** (n - 1) * rrMult;
    }
    if (utilMult) return roll * utilMult;
    const n = UTILITIES.filter((u) => this.props[u].owner === owner).length;
    return roll * (n === 2 ? 10 : 4);
  }

  // ---------- turn flow ----------
  requireTurn(id, ...phases) {
    if (this.cur().id !== id) fail("It's not your turn.");
    if (phases.length && !phases.includes(this.phase)) fail('You cannot do that right now.');
  }

  /** Decide what happens after the current player's action has fully resolved. */
  proceed() {
    if (this.phase === 'over') return;
    if (this.active().some((p) => p.money < 0)) { this.phase = 'debt'; return; }
    const p = this.cur();
    if (p.bankrupt) return this.nextTurn();
    this.phase = this.extraRoll && !p.inJail ? 'roll' : 'end';
  }

  nextTurn() {
    if (this.phase === 'over') return;
    this.doubles = 0;
    this.extraRoll = false;
    do { this.turn = (this.turn + 1) % this.players.length; } while (this.cur().bankrupt);
    this.phase = 'roll';
    this.addLog(`It's ${this.cur().name}'s turn.`);
  }

  roll(id) {
    this.requireTurn(id, 'roll');
    const p = this.cur();
    const d = [die(), die()];
    this.dice = d;
    const dbl = d[0] === d[1];
    this.event({ type: 'dice', player: p.id, dice: d });
    this.addLog(`${p.name} rolled ${d[0]} + ${d[1]}${dbl ? ' (doubles!)' : ''}.`);

    if (p.inJail) {
      this.extraRoll = false;
      if (dbl) {
        p.inJail = false; p.jailTurns = 0;
        this.addLog(`${p.name} rolled doubles and leaves Jail.`);
      } else if (++p.jailTurns >= 3) {
        this.pay(p, null, JAIL_FINE, 'jail fine');
        p.inJail = false; p.jailTurns = 0;
      } else {
        this.addLog(`${p.name} stays in Jail.`);
        return this.proceed();
      }
    } else if (dbl) {
      if (++this.doubles === 3) {
        this.addLog(`${p.name} rolled doubles three times — speeding to Jail!`);
        this.sendToJail(p);
        return this.proceed();
      }
      this.extraRoll = true;
    } else {
      this.extraRoll = false;
    }
    this.moveBy(p, d[0] + d[1]);
    if (this.phase !== 'buy') this.proceed();
  }

  walkTo(p, to, collectGo = true) {
    const from = p.pos;
    if (collectGo && to < from) {
      p.money += GO_SALARY;
      this.addLog(`${p.name} passed GO and collected ${money(GO_SALARY)}.`);
    }
    p.pos = to;
    this.event({ type: 'move', player: p.id, from, to, kind: 'walk' });
  }

  moveBy(p, n, opts) {
    this.walkTo(p, (p.pos + n) % 40);
    this.land(p, opts);
  }

  sendToJail(p) {
    const from = p.pos;
    p.pos = 10; p.inJail = true; p.jailTurns = 0;
    this.extraRoll = false; this.doubles = 0;
    this.event({ type: 'move', player: p.id, from, to: 10, kind: 'jump' });
    this.addLog(`${p.name} went to Jail.`);
  }

  land(p, opts = {}) {
    const i = p.pos, t = TILES[i];
    this.addLog(`${p.name} landed on ${t.name}.`);
    switch (t.type) {
      case 'property': case 'railroad': case 'utility': {
        const pr = this.props[i];
        if (!pr.owner) { this.phase = 'buy'; return; }
        if (pr.owner === p.id) return;
        if (pr.mortgaged) { this.addLog(`${t.name} is mortgaged — no rent.`); return; }
        const owner = this.player(pr.owner);
        this.pay(p, owner, this.rent(i, opts), `rent for ${t.name}`);
        return;
      }
      case 'tax': return this.pay(p, null, t.amount, t.name);
      case 'gotojail': return this.sendToJail(p);
      case 'chance': case 'chest': return this.drawCard(p, t.type);
      default: return;
    }
  }

  drawCard(p, deck) {
    const idx = this.decks[deck].shift();
    const card = (deck === 'chance' ? CHANCE : CHEST)[idx];
    const a = card.a;
    if (a.type !== 'jailfree') this.decks[deck].push(idx);
    this.lastCard = { deck, text: card.text, player: p.id };
    this.event({ type: 'card', player: p.id, deck, text: card.text });
    this.addLog(`${p.name} drew ${deck === 'chance' ? 'Chance' : 'Community Chest'}: "${card.text}"`);

    switch (a.type) {
      case 'advance':
        this.walkTo(p, a.to);
        return this.land(p);
      case 'nearest': {
        const list = a.kind === 'railroad' ? RAILROADS : UTILITIES;
        const to = list.find((x) => x > p.pos) ?? list[0];
        this.walkTo(p, to);
        return this.land(p, a.kind === 'railroad' ? { rrMult: 2 } : { utilMult: 10 });
      }
      case 'money':
        if (a.amount >= 0) { p.money += a.amount; this.addLog(`${p.name} collected ${money(a.amount)}.`); }
        else this.pay(p, null, -a.amount);
        return;
      case 'jailfree':
        p.jailCards.push(deck);
        return;
      case 'back': {
        const from = p.pos;
        p.pos = (p.pos - a.n + 40) % 40;
        this.event({ type: 'move', player: p.id, from, to: p.pos, kind: 'back' });
        return this.land(p);
      }
      case 'jail':
        return this.sendToJail(p);
      case 'repairs': {
        let cost = 0;
        for (const i of this.ownedBy(p.id)) {
          const h = this.props[i].houses;
          cost += h === 5 ? a.hotel : h * a.house;
        }
        if (cost) this.pay(p, null, cost, 'repairs');
        return;
      }
      case 'each':
        for (const o of this.active()) {
          if (o === p) continue;
          if (a.amount < 0) this.pay(p, o, -a.amount);
          else this.pay(o, p, a.amount);
        }
        return;
    }
  }

  buy(id) {
    this.requireTurn(id, 'buy');
    const p = this.cur(), t = TILES[p.pos];
    if (p.money < t.price) fail('Not enough money — put it up for auction or raise funds.');
    p.money -= t.price;
    this.props[p.pos].owner = p.id;
    this.addLog(`${p.name} bought ${t.name} for ${money(t.price)}.`);
    this.proceed();
  }

  // ---------- jail ----------
  payJail(id) {
    this.requireTurn(id, 'roll');
    const p = this.cur();
    if (!p.inJail) fail('You are not in Jail.');
    if (p.money < JAIL_FINE) fail('Not enough money.');
    this.pay(p, null, JAIL_FINE, 'jail fine');
    p.inJail = false; p.jailTurns = 0;
  }

  useJailCard(id) {
    this.requireTurn(id, 'roll');
    const p = this.cur();
    if (!p.inJail) fail('You are not in Jail.');
    const deck = p.jailCards.pop();
    if (!deck) fail('You have no Get Out of Jail Free card.');
    this.decks[deck].push(deck === 'chance' ? CHANCE.findIndex((c) => c.a.type === 'jailfree') : CHEST.findIndex((c) => c.a.type === 'jailfree'));
    p.inJail = false; p.jailTurns = 0;
    this.addLog(`${p.name} used a Get Out of Jail Free card.`);
  }

  endTurn(id) {
    this.requireTurn(id, 'end');
    this.nextTurn();
  }

  // ---------- auction ----------
  startAuction(id) {
    this.requireTurn(id, 'buy');
    const i = this.cur().pos;
    this.auction = {
      prop: i, bid: 0, bidder: null,
      bidders: this.active().map((p) => p.id),
      endsAt: Date.now() + AUCTION_MS,
    };
    this.phase = 'auction';
    this.addLog(`${TILES[i].name} is up for auction!`);
    this.armAuctionTimer();
  }

  armAuctionTimer() {
    clearTimeout(this.auctionTimer);
    const ms = Math.max(0, this.auction.endsAt - Date.now());
    this.auctionTimer = setTimeout(() => {
      if (!this.auction) return;
      this.endAuction();
      this.onAsyncChange();
    }, ms);
    this.auctionTimer.unref?.();
  }

  bid(id, amount) {
    const a = this.auction;
    if (this.phase !== 'auction' || !a) fail('No auction in progress.');
    if (!a.bidders.includes(id)) fail('You have left this auction.');
    amount = Math.floor(Number(amount));
    if (!(amount > a.bid)) fail(`Bid must be more than ${money(a.bid)}.`);
    const p = this.player(id);
    if (amount > p.money) fail('You cannot bid more than you have.');
    a.bid = amount; a.bidder = id;
    a.endsAt = Math.max(a.endsAt, Date.now() + 8000);
    this.addLog(`${p.name} bids ${money(amount)}.`);
    this.checkAuction();
  }

  passAuction(id) {
    const a = this.auction;
    if (this.phase !== 'auction' || !a) fail('No auction in progress.');
    if (!a.bidders.includes(id)) return;
    if (a.bidder === id) fail('You are the highest bidder.');
    a.bidders = a.bidders.filter((b) => b !== id);
    this.addLog(`${this.player(id).name} drops out of the auction.`);
    this.checkAuction();
  }

  checkAuction() {
    const a = this.auction;
    if (a.bidders.length === 0 || (a.bidders.length === 1 && a.bidder === a.bidders[0])) this.endAuction();
    else this.armAuctionTimer();
  }

  endAuction() {
    const a = this.auction;
    clearTimeout(this.auctionTimer);
    this.auction = null;
    const t = TILES[a.prop];
    const winner = a.bidder && this.player(a.bidder);
    if (winner && !winner.bankrupt) {
      winner.money -= a.bid;
      this.props[a.prop].owner = winner.id;
      this.addLog(`${winner.name} won ${t.name} for ${money(a.bid)}.`);
    } else {
      this.addLog(`Nobody bought ${t.name}.`);
    }
    this.phase = 'auction-done';
    this.proceed();
  }

  // ---------- property management ----------
  ownProp(id, i) {
    i = Number(i);
    const pr = this.props[i];
    if (!pr) fail('Not a property.');
    if (pr.owner !== id) fail('You do not own that.');
    return [i, pr, TILES[i]];
  }

  checkManage(id) {
    if (this.phase === 'over') fail('The game is over.');
    const p = this.player(id);
    if (!p || p.bankrupt) fail('You are not in the game.');
    return p;
  }

  build(id, idx) {
    const p = this.checkManage(id);
    const [i, pr, t] = this.ownProp(id, idx);
    if (t.type !== 'property') fail('You can only build on colored properties.');
    if (!this.ownsGroup(id, t.group)) fail('You need the whole color set to build.');
    const grp = GROUPS[t.group].map((j) => this.props[j]);
    if (grp.some((g) => g.mortgaged)) fail('Unmortgage the whole set first.');
    if (pr.houses >= 5) fail('Already has a hotel.');
    if (pr.houses > Math.min(...grp.map((g) => g.houses))) fail('Build evenly across the set.');
    if (p.money < t.house) fail('Not enough money.');
    p.money -= t.house;
    pr.houses++;
    this.addLog(`${p.name} built a ${pr.houses === 5 ? 'hotel' : 'house'} on ${t.name}.`);
  }

  sell(id, idx) {
    const p = this.checkManage(id);
    const [i, pr, t] = this.ownProp(id, idx);
    if (!pr.houses) fail('No buildings to sell.');
    const grp = GROUPS[t.group].map((j) => this.props[j]);
    if (pr.houses < Math.max(...grp.map((g) => g.houses))) fail('Sell evenly across the set.');
    pr.houses--;
    p.money += t.house / 2;
    this.addLog(`${p.name} sold a building on ${t.name} for ${money(t.house / 2)}.`);
    this.afterRaise();
  }

  mortgage(id, idx) {
    const p = this.checkManage(id);
    const [i, pr, t] = this.ownProp(id, idx);
    if (pr.mortgaged) fail('Already mortgaged.');
    if (this.groupHasHouses(i)) fail('Sell all buildings in this set first.');
    pr.mortgaged = true;
    p.money += mortgageValue(i);
    this.addLog(`${p.name} mortgaged ${t.name} for ${money(mortgageValue(i))}.`);
    this.afterRaise();
  }

  unmortgage(id, idx) {
    const p = this.checkManage(id);
    const [i, pr, t] = this.ownProp(id, idx);
    if (!pr.mortgaged) fail('Not mortgaged.');
    const cost = unmortgageCost(i);
    if (p.money < cost) fail('Not enough money.');
    p.money -= cost;
    pr.mortgaged = false;
    this.addLog(`${p.name} unmortgaged ${t.name} for ${money(cost)}.`);
  }

  afterRaise() {
    if (this.phase === 'debt') this.proceed();
  }

  // ---------- bankruptcy ----------
  bankrupt(id, reason = 'declared bankruptcy') {
    const p = this.player(id);
    if (!p || p.bankrupt) fail('Not in the game.');
    const credId = p.money < 0 ? this.creditor[id] : null;
    for (const i of this.ownedBy(id)) {
      const pr = this.props[i];
      if (pr.houses) { p.money += (pr.houses * TILES[i].house) / 2; pr.houses = 0; }
    }
    const cred = credId && this.player(credId);
    if (cred && !cred.bankrupt && p.money < 0) {
      // The creditor was credited in full when the debt was created; claw back the shortfall.
      cred.money += p.money;
      if (cred.money < 0) this.creditor[cred.id] = null;
    }
    if (cred && !cred.bankrupt) {
      if (p.money > 0) cred.money += p.money;
      for (const i of this.ownedBy(id)) this.props[i].owner = cred.id;
      cred.jailCards.push(...p.jailCards);
      this.addLog(`${p.name} ${reason}! Everything goes to ${cred.name}.`);
    } else {
      for (const i of this.ownedBy(id)) Object.assign(this.props[i], { owner: null, houses: 0, mortgaged: false });
      for (const deck of p.jailCards) {
        this.decks[deck].push((deck === 'chance' ? CHANCE : CHEST).findIndex((c) => c.a.type === 'jailfree'));
      }
      this.addLog(`${p.name} ${reason}! Their properties return to the bank.`);
    }
    p.jailCards = [];
    p.money = 0;
    p.bankrupt = true;
    delete this.creditor[id];
    this.trades = this.trades.filter((tr) => tr.from !== id && tr.to !== id);

    const left = this.active();
    if (left.length === 1) {
      this.winner = left[0].id;
      this.phase = 'over';
      clearTimeout(this.auctionTimer);
      this.auction = null;
      this.addLog(`🏆 ${left[0].name} wins the game!`);
      return;
    }
    if (this.auction) {
      const a = this.auction;
      a.bidders = a.bidders.filter((b) => b !== id);
      if (a.bidder === id) { a.bidder = null; a.bid = 0; }
      this.checkAuction();
      return;
    }
    if (this.phase === 'debt' || this.cur().id === id) this.proceed();
  }

  declareBankruptcy(id) {
    const p = this.checkManage(id);
    if (p.money >= 0) fail('You can only declare bankruptcy when you owe money.');
    this.bankrupt(id);
  }

  // ---------- trading ----------
  proposeTrade(id, offer) {
    const p = this.checkManage(id);
    if (this.phase === 'auction') fail('Wait for the auction to finish.');
    const to = this.player(offer?.to);
    if (!to || to.bankrupt || to.id === id) fail('Pick another player to trade with.');
    const clean = (list) => [...new Set((Array.isArray(list) ? list : []).map(Number))];
    const tr = {
      id: ++this.tradeSeq, from: id, to: to.id,
      giveProps: clean(offer.giveProps), getProps: clean(offer.getProps),
      giveMoney: Math.max(0, Math.floor(Number(offer.giveMoney) || 0)),
      getMoney: Math.max(0, Math.floor(Number(offer.getMoney) || 0)),
    };
    if (!tr.giveProps.length && !tr.getProps.length && !tr.giveMoney && !tr.getMoney) fail('The trade is empty.');
    this.validateTrade(tr);
    this.trades = this.trades.filter((t) => t.from !== id);
    this.trades.push(tr);
    this.addLog(`${p.name} proposed a trade to ${to.name}.`);
  }

  validateTrade(tr) {
    const from = this.player(tr.from), to = this.player(tr.to);
    if (!from || !to || from.bankrupt || to.bankrupt) fail('That trade is no longer valid.');
    const check = (list, owner) => {
      for (const i of list) {
        const pr = this.props[i];
        if (!pr || pr.owner !== owner) fail('A property in the trade changed owner.');
        if (this.groupHasHouses(i)) fail(`Sell the buildings on the ${TILES[i].group} set before trading it.`);
      }
    };
    check(tr.giveProps, tr.from);
    check(tr.getProps, tr.to);
    if (tr.giveMoney > Math.max(0, from.money)) fail(`${from.name} does not have enough money.`);
    if (tr.getMoney > Math.max(0, to.money)) fail(`${to.name} does not have enough money.`);
  }

  respondTrade(id, tradeId, accept) {
    const tr = this.trades.find((t) => t.id === Number(tradeId));
    if (!tr) fail('That trade no longer exists.');
    if (id === tr.from && !accept) {
      this.trades = this.trades.filter((t) => t !== tr);
      this.addLog(`${this.player(id).name} cancelled their trade offer.`);
      return;
    }
    if (id !== tr.to) fail('That trade is not for you.');
    if (!accept) {
      this.trades = this.trades.filter((t) => t !== tr);
      this.addLog(`${this.player(id).name} rejected ${this.player(tr.from).name}'s trade.`);
      return;
    }
    if (this.phase === 'auction') fail('Wait for the auction to finish.');
    this.validateTrade(tr);
    const from = this.player(tr.from), to = this.player(tr.to);
    for (const i of tr.giveProps) this.props[i].owner = to.id;
    for (const i of tr.getProps) this.props[i].owner = from.id;
    from.money += tr.getMoney - tr.giveMoney;
    to.money += tr.giveMoney - tr.getMoney;
    this.trades = this.trades.filter((t) => t !== tr);
    // Trades that reference properties which just changed hands are stale now.
    const moved = new Set([...tr.giveProps, ...tr.getProps]);
    this.trades = this.trades.filter((t) => ![...t.giveProps, ...t.getProps].some((i) => moved.has(i)));
    this.addLog(`${to.name} accepted ${from.name}'s trade.`);
    this.afterRaise();
  }

  // ---------- dispatch ----------
  act(id, action = {}) {
    const p = this.player(id);
    if (!p) fail('You are not in this game.');
    if (this.phase === 'over') fail('The game is over.');
    if (p.bankrupt) fail('You are bankrupt.');
    switch (action.type) {
      case 'roll': return this.roll(id);
      case 'buy': return this.buy(id);
      case 'auction': return this.startAuction(id);
      case 'bid': return this.bid(id, action.amount);
      case 'pass': return this.passAuction(id);
      case 'endTurn': return this.endTurn(id);
      case 'payJail': return this.payJail(id);
      case 'jailCard': return this.useJailCard(id);
      case 'build': return this.build(id, action.prop);
      case 'sell': return this.sell(id, action.prop);
      case 'mortgage': return this.mortgage(id, action.prop);
      case 'unmortgage': return this.unmortgage(id, action.prop);
      case 'bankrupt': return this.declareBankruptcy(id);
      case 'trade': return this.proposeTrade(id, action.offer);
      case 'tradeRespond': return this.respondTrade(id, action.id, !!action.accept);
      default: fail('Unknown action.');
    }
  }

  serialize() {
    return {
      players: this.players,
      props: this.props,
      turn: this.turn,
      phase: this.phase,
      dice: this.dice,
      extraRoll: this.extraRoll,
      auction: this.auction,
      trades: this.trades,
      log: this.log.slice(-40),
      events: this.events,
      lastCard: this.lastCard,
      winner: this.winner,
      creditor: this.creditor,
    };
  }

  dispose() { clearTimeout(this.auctionTimer); }
}
