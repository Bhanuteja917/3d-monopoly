import { Board3D } from './board3d.js';
import {
  TILES, GROUPS, GROUP_COLORS, RAILROADS, UTILITIES, TOKEN_EMOJI, MAX_PLAYERS, JAIL_FINE,
  mortgageValue, unmortgageCost,
} from '/shared/board.js';

/* global io */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => (n < 0 ? `-$${-n}` : `$${n}`);
const SESSION_KEY = 'mono3d.session';
const NAME_KEY = 'mono3d.name';

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};

// ---------- app state ----------
let session = store.get(SESSION_KEY); // {code, token, playerId}
let room = null;
let clockOffset = 0;
let board = null;
let lastEventId = null;
const queue = [];
let animating = false;
let modal = null; // {kind, arg}
let chat = [];
let unreadChat = false;
const seen = { buy: null, auction: null, trades: new Set(), over: false, turnKey: null };
let draft = null; // trade being composed

const socket = io({ transports: ['websocket', 'polling'] });

// ---------- screens ----------
function show(id) {
  for (const s of ['home', 'lobby', 'game']) $(`#${s}`).classList.toggle('hidden', s !== id);
}

function toast(text, type = '', ms = 2800) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = text;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

const me = () => room?.game?.players.find((p) => p.id === session?.playerId);
const isHost = () => room?.hostId === session?.playerId;
const playerById = (id) => room?.game?.players.find((p) => p.id === id) ?? room?.members.find((m) => m.id === id);
const memberById = (id) => room?.members.find((m) => m.id === id);

function emit(event, data) {
  return new Promise((resolve) => socket.emit(event, data, (res) => {
    if (res && !res.ok) toast(esc(res.error), 'err');
    resolve(res);
  }));
}
const act = (type, extra = {}) => emit('action', { type, ...extra });

// ---------- home ----------
const params = new URLSearchParams(location.search);
$('#name').value = store.get(NAME_KEY) ?? '';
if (params.get('room')) $('#codeInput').value = params.get('room').toUpperCase().slice(0, 4);

function getName() {
  const n = $('#name').value.trim();
  if (!n) { toast('Enter your name first', 'err'); $('#name').focus(); return null; }
  store.set(NAME_KEY, n);
  return n;
}

function saveSession(res) {
  session = { code: res.code, token: res.token, playerId: res.playerId };
  store.set(SESSION_KEY, session);
  history.replaceState(null, '', `?room=${res.code}`);
}

$('#createBtn').onclick = async () => {
  const name = getName();
  if (!name) return;
  const res = await emit('create', { name });
  if (res?.ok) saveSession(res);
};
$('#joinBtn').onclick = async () => {
  const name = getName();
  const code = $('#codeInput').value.trim().toUpperCase();
  if (!name) return;
  if (code.length !== 4) return toast('Enter the 4-letter room code', 'err');
  const res = await emit('join', { code, name });
  if (res?.ok) saveSession(res);
};
$('#codeInput').addEventListener('keydown', (e) => e.key === 'Enter' && $('#joinBtn').click());

async function shareInvite() {
  const url = `${location.origin}/?room=${room.code}`;
  const text = `Join my Monopoly game! Room code: ${room.code}`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Monopoly 3D', text, url }); return; } catch { /* cancelled */ }
  }
  try { await navigator.clipboard.writeText(url); toast('Invite link copied!'); } catch { toast(esc(url), '', 6000); }
}

async function leaveRoom() {
  await emit('leave', {});
  resetToHome();
}

function resetToHome() {
  store.del(SESSION_KEY);
  session = null;
  room = null;
  lastEventId = null;
  closeSheet();
  history.replaceState(null, '', '/');
  location.reload();
}

$('#shareBtn').onclick = shareInvite;
$('#leaveBtn').onclick = leaveRoom;
$('#startBtn').onclick = () => emit('start', {});

// ---------- connection ----------
socket.on('connect', async () => {
  $('#conn').classList.add('hidden');
  if (session) {
    const res = await new Promise((r) => socket.emit('resume', session, r));
    if (!res?.ok) {
      store.del(SESSION_KEY);
      session = null;
      show('home');
      toast('That game is no longer available.', 'err');
    }
  } else {
    show('home');
  }
});
socket.on('disconnect', () => $('#conn').classList.remove('hidden'));
socket.on('kicked', () => { toast('You were removed from the room.', 'err'); resetToHome(); });
socket.on('chat', (m) => {
  chat.push(m);
  if (chat.length > 100) chat.shift();
  if (modal?.kind === 'log') renderSheet();
  else {
    unreadChat = true;
    $('#chatDot').classList.remove('hidden');
    if (m.from !== session?.playerId) toast(`<b style="color:${esc(m.color)}">${esc(m.name)}:</b> ${esc(m.text)}`);
  }
});

socket.on('state', (r) => {
  room = r;
  clockOffset = (r.now ?? Date.now()) - Date.now();
  if (!r.game) {
    show('lobby');
    renderLobby();
    return;
  }
  show('game');
  if (!board) {
    board = new Board3D($('#stage'), { onTileTap: (i) => openSheet('tile', i) });
    board.setDiceFaces(r.game.dice);
  }
  queueEvents(r.game);
  board.sync(r.game, { tokens: !animating });
  renderGame();
});

// ---------- lobby ----------
function renderLobby() {
  $('#roomCode').textContent = room.code;
  $('#playerCount').textContent = `(${room.members.length}/${MAX_PLAYERS})`;
  $('#lobbyPlayers').innerHTML = room.members.map((m) => `
    <li style="--c:${esc(m.color)}" class="${m.connected ? '' : 'offline'}">
      <span>${TOKEN_EMOJI[m.piece] ?? '●'}</span>
      <span class="grow">${esc(m.name)} ${m.id === session?.playerId ? '<span class="tag">you</span>' : ''}</span>
      ${m.id === room.hostId ? '<span class="tag">host</span>' : ''}
      ${isHost() && m.id !== session?.playerId ? `<button data-a="kick" data-id="${m.id}">Remove</button>` : ''}
    </li>`).join('');
  const host = isHost();
  $('#startBtn').classList.toggle('hidden', !host);
  $('#startBtn').disabled = room.members.length < 2;
  $('#lobbyHint').textContent = host
    ? (room.members.length < 2 ? 'Waiting for at least one more player to join…' : 'Start when everyone is in.')
    : `Waiting for ${memberById(room.hostId)?.name ?? 'the host'} to start the game…`;
}

// ---------- animation queue ----------
function queueEvents(g) {
  const last = g.events.at(-1)?.id ?? 0;
  if (lastEventId == null || last < lastEventId) { lastEventId = last; return; }
  for (const e of g.events) if (e.id > lastEventId) queue.push(e);
  lastEventId = last;
  if (queue.length && !animating) runQueue();
}

async function runQueue() {
  animating = true;
  renderGame();
  while (queue.length) {
    const e = queue.shift();
    try {
      if (e.type === 'dice') {
        await board.rollDice(e.dice);
        await sleep(150);
      } else if (e.type === 'move') {
        await board.animateMove(e.player, e.from, e.to, e.kind);
      } else if (e.type === 'card') {
        const who = playerById(e.player);
        toast(`<div class="card-pop ${e.deck}"><small>${e.deck === 'chance' ? 'CHANCE' : 'COMMUNITY CHEST'} · ${esc(who?.name)}</small>${esc(e.text)}</div>`, '', 4500);
        await sleep(1300);
      }
    } catch (err) { console.error(err); }
  }
  animating = false;
  board.sync(room.game);
  renderGame();
}

// ---------- game HUD ----------
function renderGame() {
  const g = room.game;
  renderChips(g);
  renderStatus(g);
  autoSheets(g);
  if (modal) renderSheet();
  const incoming = g.trades.filter((t) => t.to === session?.playerId).length;
  $('#tradeBtn').textContent = incoming ? `🤝 Trade (${incoming})` : '🤝 Trade';
}

function renderChips(g) {
  $('#chips').innerHTML = g.players.map((p, i) => {
    const m = memberById(p.id);
    const cls = ['chip', i === g.turn && g.phase !== 'over' ? 'turn' : '', p.bankrupt ? 'out' : '', m && !m.connected ? 'offline' : ''].join(' ');
    return `<div class="${cls}" style="--c:${esc(p.color)}" data-a="player" data-id="${p.id}">
      <span class="tok">${TOKEN_EMOJI[p.token] ?? ''}</span>
      <span>${esc(p.name)}${p.inJail ? ' 🔒' : ''}</span>
      ${p.id === session?.playerId ? '<span class="me">YOU</span>' : ''}
      <span class="money ${p.money < 0 ? 'neg' : ''}">${fmt(p.money)}</span>
    </div>`;
  }).join('');
}

function renderStatus(g) {
  const cur = g.players[g.turn];
  const mine = cur.id === session?.playerId;
  const self = me();
  const tile = TILES[cur.pos];
  const dice = `🎲 ${g.dice[0]}+${g.dice[1]}`;
  let status = '';
  const buttons = [];
  const btn = (label, a, cls = '', extra = '') => buttons.push(`<button class="${cls}" data-a="${a}" ${extra}>${label}</button>`);

  if (animating) {
    status = `${esc(cur.name)} is moving…`;
  } else if (g.phase === 'over') {
    status = `🏆 <b>${esc(playerById(g.winner)?.name)}</b> wins the game!`;
    btn('Back to home', 'leave', 'primary');
  } else if (g.phase === 'debt') {
    const debtors = g.players.filter((p) => !p.bankrupt && p.money < 0);
    if (self && self.money < 0) {
      status = `You owe <b>${fmt(-self.money)}</b>. Sell, mortgage or trade to pay — or go bankrupt.`;
      btn('🏠 Raise funds', 'openProps', 'primary');
      btn('Declare bankruptcy', 'bankrupt', 'danger');
    } else {
      status = `Waiting for ${debtors.map((d) => `<b>${esc(d.name)}</b>`).join(', ')} to pay debts…`;
    }
  } else if (g.phase === 'auction') {
    const a = g.auction;
    status = `Auction for <b>${esc(TILES[a.prop].name)}</b> — ${a.bidder ? `${fmt(a.bid)} by ${esc(playerById(a.bidder)?.name)}` : 'no bids yet'}`;
    if (self && !self.bankrupt) btn('🔨 Open auction', 'openAuction', 'primary');
  } else if (mine) {
    if (g.phase === 'roll') {
      if (cur.inJail) {
        status = `You're in Jail (attempt ${cur.jailTurns + 1}/3). Roll doubles to escape.`;
        btn('🎲 Roll for doubles', 'act', 'primary', 'data-t="roll"');
        btn(`Pay ${fmt(JAIL_FINE)}`, 'act', '', `data-t="payJail" ${cur.money < JAIL_FINE ? 'disabled' : ''}`);
        if (cur.jailCards.length) btn('Use card', 'act', '', 'data-t="jailCard"');
      } else {
        status = g.extraRoll ? 'Doubles! <b>Roll again.</b>' : '<b>Your turn!</b> Roll the dice.';
        btn('🎲 Roll dice', 'act', 'primary', 'data-t="roll"');
      }
    } else if (g.phase === 'buy') {
      status = `${dice} — <b>${esc(tile.name)}</b> is for sale.`;
      btn(`Buy ${fmt(tile.price)}`, 'act', 'primary', `data-t="buy" ${cur.money < tile.price ? 'disabled' : ''}`);
      btn('Auction', 'act', '', 'data-t="auction"');
    } else if (g.phase === 'end') {
      status = `${dice} — on <b>${esc(tile.name)}</b>.`;
      btn('End turn ➜', 'act', 'primary', 'data-t="endTurn"');
    }
  } else {
    const name = `<b>${esc(cur.name)}</b>`;
    status = {
      roll: `${name}'s turn — rolling…`,
      buy: `${name} is deciding whether to buy ${esc(tile.name)}…`,
      end: `${dice} — ${name} is on ${esc(tile.name)}.`,
    }[g.phase] ?? `${name}'s turn`;
  }
  $('#status').innerHTML = status;
  $('#actions').innerHTML = buttons.join('');
  $('#actions').querySelectorAll('button').forEach((b) => { if (animating && b.dataset.a !== 'leave') b.disabled = true; });

  const turnKey = `${g.turn}`;
  if (seen.turnKey !== turnKey) {
    if (seen.turnKey != null && mine && g.phase === 'roll') {
      navigator.vibrate?.(150);
      toast('🎲 <b>Your turn!</b>');
    }
    seen.turnKey = turnKey;
  }
}

function autoSheets(g) {
  if (animating) return;
  const self = me();
  const mine = g.players[g.turn].id === session?.playerId;
  if (g.phase === 'over') {
    if (!seen.over) { seen.over = true; openSheet('over'); }
    return;
  }
  if (modal?.kind === 'buy' && g.phase !== 'buy') closeSheet();
  if (modal?.kind === 'auction' && g.phase !== 'auction') closeSheet();

  if (g.phase === 'buy' && mine && seen.buy !== lastEventId) {
    seen.buy = lastEventId;
    openSheet('buy');
  } else if (g.phase === 'auction' && self && !self.bankrupt) {
    const key = `${g.auction.prop}:${lastEventId}`;
    if (seen.auction !== key) { seen.auction = key; openSheet('auction'); }
  }
  const incoming = g.trades.find((t) => t.to === session?.playerId && !seen.trades.has(t.id));
  if (incoming && (!modal || modal.kind === 'tile' || modal.kind === 'player')) {
    seen.trades.add(incoming.id);
    openSheet('tradeIn', incoming.id);
  }
}

// ---------- sheets ----------
function openSheet(kind, arg) {
  modal = { kind, arg };
  if (kind === 'log') { unreadChat = false; $('#chatDot').classList.add('hidden'); }
  $('#modal').classList.remove('hidden');
  renderSheet(true);
}

function closeSheet() {
  modal = null;
  $('#modal').classList.add('hidden');
  $('#sheet').innerHTML = '';
}

$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeSheet(); });

function renderSheet(force = false) {
  if (!modal || !room?.game && !['menu'].includes(modal.kind)) return;
  // Don't clobber what the user is typing.
  if (!force && $('#sheet').contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
  const html = SHEETS[modal.kind]?.(modal.arg);
  if (html == null) return closeSheet();
  $('#sheet').innerHTML = html;
  if (modal.kind === 'log') {
    const log = $('#sheet .log');
    log.scrollTop = log.scrollHeight;
  }
}

const header = (title) => `<h2><span>${title}</span><button class="close" data-a="close">✕</button></h2>`;

function ownsGroup(g, owner, group) { return GROUPS[group].every((i) => g.props[i].owner === owner); }
function groupHasHouses(g, i) {
  const t = TILES[i];
  return t.type === 'property' && GROUPS[t.group].some((j) => g.props[j].houses > 0);
}

function deedHTML(i) {
  const g = room.game;
  const t = TILES[i];
  const pr = g.props[i];
  if (!pr) {
    const desc = {
      go: 'Collect $200 salary every time you pass GO.',
      chest: 'Draw a Community Chest card.',
      chance: 'Draw a Chance card.',
      tax: `Pay ${fmt(t.amount)} to the bank.`,
      jail: `Just visiting — or stuck in Jail. Get out by rolling doubles, paying ${fmt(JAIL_FINE)} or using a card.`,
      parking: 'Free Parking. Take a breather!',
      gotojail: 'Go directly to Jail. Do not pass GO, do not collect $200.',
    }[t.type];
    const here = g.players.filter((p) => !p.bankrupt && p.pos === i).map((p) => esc(p.name)).join(', ');
    return `<div class="deed"><div class="head" style="--g:#e8f5e9"><b>${esc(t.name)}</b></div>
      <div class="foot">${desc}${here ? `<br><br>Here: ${here}` : ''}</div></div>`;
  }
  const owner = pr.owner && playerById(pr.owner);
  let rows = [];
  let cur = -1;
  if (t.type === 'property') {
    rows = [['Rent', t.rent[0]], ['With color set', t.rent[0] * 2], ['With 1 house', t.rent[1]], ['With 2 houses', t.rent[2]],
      ['With 3 houses', t.rent[3]], ['With 4 houses', t.rent[4]], ['With hotel', t.rent[5]]].map(([a, b]) => [a, fmt(b)]);
    if (owner) cur = pr.houses ? pr.houses + 1 : ownsGroup(g, pr.owner, t.group) ? 1 : 0;
  } else if (t.type === 'railroad') {
    rows = [['Rent', '$25'], ['2 railroads', '$50'], ['3 railroads', '$100'], ['4 railroads', '$200']];
    if (owner) cur = RAILROADS.filter((r) => g.props[r].owner === pr.owner).length - 1;
  } else {
    rows = [['One utility', '4 × dice'], ['Both utilities', '10 × dice']];
    if (owner) cur = UTILITIES.filter((u) => g.props[u].owner === pr.owner).length - 1;
  }
  const headColor = t.type === 'property' ? GROUP_COLORS[t.group] : '#eee';
  const kind = t.type === 'property' ? 'TITLE DEED' : t.type === 'railroad' ? 'RAILROAD' : 'UTILITY';
  return `<div class="deed">
    <div class="head" style="--g:${headColor}"><small>${kind}</small><b>${esc(t.name)}</b></div>
    <table>${rows.map(([a, b], k) => `<tr class="${k === cur ? 'cur' : ''}"><td>${a}</td><td>${b}</td></tr>`).join('')}</table>
    <div class="foot">Price ${fmt(t.price)} · Mortgage ${fmt(mortgageValue(i))}${t.house ? ` · Houses ${fmt(t.house)} each` : ''}</div>
    ${owner ? `<div class="owner" style="background:${esc(owner.color)}">Owned by ${esc(owner.name)}${pr.mortgaged ? ' · MORTGAGED' : ''}${pr.houses ? ` · ${pr.houses === 5 ? 'Hotel' : `${pr.houses} house${pr.houses > 1 ? 's' : ''}`}` : ''}</div>`
      : '<div class="owner" style="background:#555">Unowned</div>'}
  </div>`;
}

function propItem(i, { acts = '', cls = '', a = '' } = {}) {
  const g = room.game;
  const t = TILES[i], pr = g.props[i];
  const color = t.type === 'property' ? GROUP_COLORS[t.group] : t.type === 'railroad' ? '#444' : '#aaa';
  const bits = [];
  if (pr.houses) bits.push(pr.houses === 5 ? '🏨 hotel' : `🏠×${pr.houses}`);
  if (pr.mortgaged) bits.push('mortgaged');
  return `<div class="pitem ${pr.mortgaged ? 'mortgaged' : ''} ${cls}" style="--g:${color}" ${a}>
    <div class="info"><b>${esc(t.name)}</b><small>${bits.join(' · ') || fmt(t.price)}</small></div>
    ${acts ? `<div class="acts">${acts}</div>` : ''}
  </div>`;
}

const SHEETS = {
  tile: (i) => header(esc(TILES[i].name)) + deedHTML(i),

  buy: () => {
    const g = room.game, cur = g.players[g.turn];
    if (g.phase !== 'buy' || cur.id !== session?.playerId) return null;
    const t = TILES[cur.pos];
    return `${header('For sale!')}${deedHTML(cur.pos)}
      <p class="hint" style="margin-top:10px">You have ${fmt(cur.money)}. If you don't buy it, it goes to auction.</p>
      <div class="btns">
        <button class="primary" data-a="act" data-t="buy" ${cur.money < t.price ? 'disabled' : ''}>Buy for ${fmt(t.price)}</button>
        <button data-a="act" data-t="auction">Auction</button>
      </div>`;
  },

  auction: () => {
    const g = room.game, a = g.auction, self = me();
    if (!a) return null;
    const left = Math.max(0, a.endsAt - (Date.now() + clockOffset));
    const inIt = a.bidders.includes(session?.playerId);
    const high = a.bidder && playerById(a.bidder);
    const incs = [1, 10, 50, 100];
    return `${header(`🔨 Auction: ${esc(TILES[a.prop].name)}`)}
      <div class="auction-bid">${fmt(a.bid)}</div>
      <p class="hint">${high ? `Highest bid by <b style="color:${esc(high.color)}">${esc(high.name)}</b>` : 'No bids yet'} · ${a.bidders.length} still bidding</p>
      <div class="timer"><i id="auctionTimer" style="width:${Math.min(100, (left / 15000) * 100)}%"></i></div>
      ${inIt ? `
        <p class="hint">You have ${fmt(self.money)}</p>
        <div class="bidrow">${incs.map((n) => `<button data-a="bid" data-v="${a.bid + n}" ${a.bid + n > self.money ? 'disabled' : ''}>+${n}</button>`).join('')}</div>
        <div class="chatbar"><input id="bidInput" type="number" inputmode="numeric" placeholder="Custom bid" /><button data-a="bidCustom">Bid</button></div>
        <div class="btns"><button data-a="act" data-t="pass" ${a.bidder === session?.playerId ? 'disabled' : ''}>Drop out</button></div>`
      : '<p class="hint">You are out of this auction.</p>'}
      <details style="margin-top:12px"><summary class="muted">Property card</summary><div style="margin-top:8px">${deedHTML(a.prop)}</div></details>`;
  },

  props: () => {
    const g = room.game, self = me();
    if (!self) return `${header('My properties')}<p class="hint">You are spectating.</p>`;
    const mine = Object.keys(g.props).map(Number).filter((i) => g.props[i].owner === self.id);
    const items = mine.map((i) => {
      const t = TILES[i], pr = g.props[i];
      const acts = [];
      if (t.type === 'property' && ownsGroup(g, self.id, t.group) && !pr.mortgaged && pr.houses < 5) {
        acts.push(`<button data-a="act" data-t="build" data-p="${i}">+${pr.houses === 4 ? '🏨' : '🏠'} ${fmt(t.house)}</button>`);
      }
      if (pr.houses) acts.push(`<button data-a="act" data-t="sell" data-p="${i}">Sell +${fmt(t.house / 2)}</button>`);
      if (!pr.mortgaged && !groupHasHouses(g, i)) acts.push(`<button data-a="act" data-t="mortgage" data-p="${i}">Mortgage +${fmt(mortgageValue(i))}</button>`);
      if (pr.mortgaged) acts.push(`<button data-a="act" data-t="unmortgage" data-p="${i}">Unmortgage ${fmt(unmortgageCost(i))}</button>`);
      return propItem(i, { acts: acts.join('') });
    });
    return `${header(`My properties · ${fmt(self.money)}`)}
      ${self.jailCards.length ? `<p class="hint">🃏 Get Out of Jail Free cards: ${self.jailCards.length}</p>` : ''}
      <div class="plist">${items.join('') || '<p class="hint">You don\'t own anything yet.</p>'}</div>
      <p class="hint" style="margin-top:10px">Build evenly across a full color set. Sell buildings before mortgaging.</p>`;
  },

  trade: () => {
    const g = room.game, self = me();
    if (!self || self.bankrupt) return `${header('Trade')}<p class="hint">You are not in the game.</p>`;
    const incoming = g.trades.filter((t) => t.to === self.id);
    const outgoing = g.trades.find((t) => t.from === self.id);
    const others = g.players.filter((p) => !p.bankrupt && p.id !== self.id);
    if (!draft || !others.some((o) => o.id === draft.to)) {
      draft = { to: others[0]?.id, give: new Set(), get: new Set(), giveMoney: 0, getMoney: 0 };
    }
    const tradable = (owner) => Object.keys(g.props).map(Number).filter((i) => g.props[i].owner === owner && !groupHasHouses(g, i));
    const partner = playerById(draft.to);
    let html = header('🤝 Trade');
    if (incoming.length) {
      html += `<h4 class="muted">Offers for you</h4>${incoming.map((t) => tradeSummary(t, true)).join('')}`;
    }
    if (outgoing) html += `<h4 class="muted">Your pending offer</h4>${tradeSummary(outgoing, false)}`;
    if (!partner) return html;
    html += `<h4 class="muted">New offer to</h4>
      <div class="pick">${others.map((o) => `<button class="${o.id === draft.to ? 'on' : ''}" data-a="tradeTo" data-id="${o.id}" style="border-left:6px solid ${esc(o.color)}">${esc(o.name)}</button>`).join('')}</div>
      <div class="trade-cols">
        <div><h4>You give</h4><div class="plist">
          ${tradable(self.id).map((i) => propItem(i, { cls: `check ${draft.give.has(i) ? 'sel' : ''}`, a: `data-a="tgive" data-i="${i}"` })).join('') || '<p class="hint">Nothing tradable</p>'}
          </div><label style="margin-top:8px">Cash (you have ${fmt(self.money)})<input id="giveMoney" type="number" inputmode="numeric" min="0" value="${draft.giveMoney || ''}" placeholder="$0" /></label></div>
        <div><h4>${esc(partner.name)} gives</h4><div class="plist">
          ${tradable(partner.id).map((i) => propItem(i, { cls: `check ${draft.get.has(i) ? 'sel' : ''}`, a: `data-a="tget" data-i="${i}"` })).join('') || '<p class="hint">Nothing tradable</p>'}
          </div><label style="margin-top:8px">Cash (has ${fmt(partner.money)})<input id="getMoney" type="number" inputmode="numeric" min="0" value="${draft.getMoney || ''}" placeholder="$0" /></label></div>
      </div>
      <div class="btns"><button class="primary" data-a="tsend">Send offer</button></div>
      <p class="hint">Properties in a color set with buildings can't be traded. Mortgaged properties stay mortgaged.</p>`;
    return html;
  },

  tradeIn: (id) => {
    const t = room.game.trades.find((x) => x.id === id);
    if (!t) return null;
    return header('🤝 Trade offer') + tradeSummary(t, true);
  },

  player: (id) => {
    const g = room.game;
    const p = g.players.find((x) => x.id === id);
    if (!p) return null;
    const m = memberById(id);
    const owned = Object.keys(g.props).map(Number).filter((i) => g.props[i].owner === id);
    return `${header(`${TOKEN_EMOJI[p.token] ?? ''} ${esc(p.name)}`)}
      <p>${fmt(p.money)} cash · ${owned.length} properties${p.jailCards.length ? ` · 🃏×${p.jailCards.length}` : ''}${p.inJail ? ' · 🔒 in Jail' : ''}${p.bankrupt ? ' · bankrupt' : ''}${m && !m.connected ? ' · <span style="color:var(--danger)">offline</span>' : ''}</p>
      <div class="plist">${owned.map((i) => propItem(i, { a: `data-a="deed" data-i="${i}"`, cls: 'check' })).join('')}</div>
      ${isHost() && id !== session?.playerId && !p.bankrupt && g.phase !== 'over'
        ? `<div class="btns"><button class="danger" data-a="kick" data-id="${id}">Remove from game</button></div>
           <p class="hint">Use this if a player has left for good. Their properties go back to the bank.</p>` : ''}`;
  },

  log: () => {
    const g = room.game;
    const items = [
      ...g.log.map((l) => ({ t: l.t, html: `<div>${esc(l.text)}</div>` })),
      ...chat.map((c) => ({ t: c.t, html: `<div class="chat" style="--c:${esc(c.color)}"><b>${esc(c.name)}:</b> ${esc(c.text)}</div>` })),
    ].sort((a, b) => a.t - b.t);
    return `${header('Game log & chat')}<div class="log">${items.map((x) => x.html).join('')}</div>
      <div class="chatbar"><input id="chatInput" maxlength="200" placeholder="Say something…" enterkeyhint="send" /><button data-a="chatSend">Send</button></div>`;
  },

  menu: () => `${header('Menu')}
    <p>Room code: <b style="letter-spacing:4px">${esc(room.code)}</b></p>
    <div class="plist">
      <button data-a="share">📤 Share invite link</button>
      <button data-a="openHelp">📖 How to play</button>
      <button class="danger" data-a="leaveConfirm">Leave game</button>
    </div>`,

  help: () => `${header('How to play')}
    <ul style="padding-left:18px;line-height:1.5;margin:0">
      <li>Take turns rolling the dice. Doubles = roll again; three doubles in a row sends you to Jail.</li>
      <li>Land on an unowned property to buy it. If you pass, it's auctioned to everyone.</li>
      <li>Own a full color set to double the rent and build houses (evenly), then hotels.</li>
      <li>Mortgage properties for quick cash. Trade with anyone at any time.</li>
      <li>If you can't pay, raise money or go bankrupt. Last player standing wins!</li>
      <li>Drag to rotate the board, pinch to zoom, tap any space to see its card.</li>
    </ul>`,

  over: () => {
    const g = room.game;
    const w = playerById(g.winner);
    return `${header('Game over')}<div class="winner"><div class="big">🏆</div><b style="color:${esc(w?.color)}">${esc(w?.name)}</b> wins!</div>
      <div class="btns"><button data-a="close">Look at the board</button><button class="primary" data-a="leave">Back to home</button></div>`;
  },

  leaveConfirm: () => `${header('Leave game?')}
    <p>If you leave a running game you go bankrupt and your properties return to the bank. You can't rejoin.</p>
    <p class="hint">Just closing the tab is fine — you can come back with the same link.</p>
    <div class="btns"><button data-a="close">Stay</button><button class="danger" data-a="leave">Leave</button></div>`,

  kickConfirm: (id) => `${header('Remove player?')}
    <p>Remove <b>${esc(playerById(id)?.name)}</b> from the game? They will be declared bankrupt.</p>
    <div class="btns"><button data-a="close">Cancel</button><button class="danger" data-a="kickYes" data-id="${id}">Remove</button></div>`,
};

function tradeSummary(t, forMe) {
  const from = playerById(t.from), to = playerById(t.to);
  const list = (props, money) => [
    ...props.map((i) => `<li>${esc(TILES[i].name)}${room.game.props[i]?.mortgaged ? ' (mortgaged)' : ''}</li>`),
    money ? `<li>${fmt(money)} cash</li>` : '',
  ].join('') || '<li class="muted">nothing</li>';
  const iAmTarget = t.to === session?.playerId;
  return `<div class="pitem" style="--g:${esc(from?.color)};display:block">
    <div class="trade-cols">
      <div><h4>${esc(from?.name)} gives</h4><ul style="margin:0;padding-left:18px">${list(t.giveProps, t.giveMoney)}</ul></div>
      <div><h4>${esc(to?.name)} gives</h4><ul style="margin:0;padding-left:18px">${list(t.getProps, t.getMoney)}</ul></div>
    </div>
    <div class="btns">${forMe && iAmTarget
      ? `<button data-a="trespond" data-id="${t.id}" data-y="0">Reject</button><button class="primary" data-a="trespond" data-id="${t.id}" data-y="1">Accept</button>`
      : `<button data-a="trespond" data-id="${t.id}" data-y="0">Cancel offer</button>`}</div>
  </div>`;
}

// auction countdown bar
setInterval(() => {
  const bar = document.getElementById('auctionTimer');
  const a = room?.game?.auction;
  if (!bar || !a) return;
  const left = Math.max(0, a.endsAt - (Date.now() + clockOffset));
  bar.style.width = `${Math.min(100, (left / 15000) * 100)}%`;
}, 250);

// ---------- click handling ----------
const HANDLERS = {
  close: closeSheet,
  act: async (d) => {
    const extra = d.p != null ? { prop: Number(d.p) } : {};
    const res = await act(d.t, extra);
    if (res?.ok && ['buy', 'auction', 'pass'].includes(d.t) && modal?.kind === 'buy') closeSheet();
  },
  bankrupt: () => openSheet('bankruptConfirm'),
  openProps: () => openSheet('props'),
  openAuction: () => openSheet('auction'),
  openHelp: () => openSheet('help'),
  deed: (d) => openSheet('tile', Number(d.i)),
  player: (d) => openSheet('player', d.id),
  share: shareInvite,
  leave: leaveRoom,
  leaveConfirm: () => openSheet('leaveConfirm'),
  kick: (d) => (room.game ? openSheet('kickConfirm', d.id) : emit('kick', { playerId: d.id })),
  kickYes: async (d) => { await emit('kick', { playerId: d.id }); closeSheet(); },
  bid: (d) => act('bid', { amount: Number(d.v) }),
  bidCustom: () => {
    const v = Number($('#bidInput')?.value);
    if (v > 0) act('bid', { amount: v });
  },
  tradeTo: (d) => { draft = { to: d.id, give: new Set(), get: new Set(), giveMoney: 0, getMoney: 0 }; renderSheet(true); },
  tgive: (d) => { toggle(draft.give, Number(d.i)); renderSheet(true); },
  tget: (d) => { toggle(draft.get, Number(d.i)); renderSheet(true); },
  tsend: async () => {
    syncDraftMoney();
    const res = await act('trade', {
      offer: { to: draft.to, giveProps: [...draft.give], getProps: [...draft.get], giveMoney: draft.giveMoney, getMoney: draft.getMoney },
    });
    if (res?.ok) { toast('Offer sent!'); draft = null; renderSheet(true); }
  },
  trespond: async (d) => {
    const res = await act('tradeRespond', { id: Number(d.id), accept: d.y === '1' });
    if (res?.ok && modal?.kind === 'tradeIn') closeSheet();
  },
  chatSend: () => {
    const input = $('#chatInput');
    const text = input?.value.trim();
    if (!text) return;
    socket.emit('chat', { text });
    input.value = '';
    input.focus();
  },
};

SHEETS.bankruptConfirm = () => `${header('Declare bankruptcy?')}
  <p>You will be out of the game. Your assets go to whoever you owe.</p>
  <div class="btns"><button data-a="close">Cancel</button><button class="danger" data-a="bankruptYes">I'm bankrupt</button></div>`;
HANDLERS.bankruptYes = async () => { await act('bankrupt'); closeSheet(); };

const toggle = (set, v) => (set.has(v) ? set.delete(v) : set.add(v));
function syncDraftMoney() {
  if (!draft) return;
  const g = $('#giveMoney'), r = $('#getMoney');
  if (g) draft.giveMoney = Math.max(0, Math.floor(Number(g.value) || 0));
  if (r) draft.getMoney = Math.max(0, Math.floor(Number(r.value) || 0));
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const fn = HANDLERS[el.dataset.a];
  if (fn) fn(el.dataset);
});
document.addEventListener('input', (e) => { if (e.target.id === 'giveMoney' || e.target.id === 'getMoney') syncDraftMoney(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'chatInput') HANDLERS.chatSend();
  if (e.target.id === 'bidInput') HANDLERS.bidCustom();
});

$('#propsBtn').onclick = () => openSheet('props');
$('#tradeBtn').onclick = () => openSheet('trade');
$('#logBtn').onclick = () => openSheet('log');
$('#menuBtn').onclick = () => openSheet('menu');
$('#viewBtn').onclick = () => board?.resetView();
