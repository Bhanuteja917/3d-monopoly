// UI controller: screens, HUD, modals, pass-and-play hand-offs and online play.
import { S, t } from './strings.js';
import { Board } from './board.js';
import { characterUrl } from './characters.js';
import { cardHTML } from './cards.js';
import { cardModel, UTILITY_COLOR } from '/shared/cards.js';
import { CONFIG } from '/shared/config.js';
import { TOKENS, CHANCE_CARDS, VEHICLES, CORNERS, BOARD_LAYOUT } from '/shared/content.js';
import * as E from '/shared/engine.js';

const $ = (s) => document.querySelector(s);
const fmt = (n) => Math.round(n).toLocaleString('en-IN');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const tokenInfo = (id) => TOKENS.find((x) => x.id === id);

let clientId = store.get('gb.clientId', null);
if (!clientId) { clientId = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('gb.clientId', clientId); }

let portraits = {};
let closeUps = {}; // character art cropped to the drawing, for the big hand-off portrait
let board = null;
let ctl = null; // { kind, send(action), viewer() }
let shown = null; // state currently displayed
const queue = [];
let busy = false;
let lastHandoff = null;
let room = null;
let socket = null;
let sheet = null; // open manage sheet: 'build' | 'sell' | 'mortgage' | 'unmortgage'
let modalOwner = null; // 'stage' | 'user'
let modalKey = null;
let selected = null; // auction pick selection

// ---------- Boot ----------
async function boot() {
  for (const el of document.querySelectorAll('[data-s]')) el.textContent = S[el.dataset.s];
  await Promise.race([document.fonts?.load('40px "Lilita One"'), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
  portraits = Object.fromEntries(TOKENS.map((tk) => [tk.id, characterUrl(tk.id)]));
  for (const tk of TOKENS) cropToArt(portraits[tk.id]).then((url) => { closeUps[tk.id] = url; }).catch(() => {});
  $('#parade').innerHTML = TOKENS.map((tk, i) => `<img src="${portraits[tk.id] || ''}" alt="${esc(tk.name)}" title="${esc(tk.name)}" style="animation-delay:${i * 0.15}s">`).join('');
  bindMenus();
  setupInstall();
  refreshHome();
}

// ---------- Installable app (PWA) ----------
let installPrompt = null;
const isStandalone = () => matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function setupInstall() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('sw', e));
  const btn = $('#btn-install');
  const show = (on) => btn.classList.toggle('hidden', !on || isStandalone());
  // Android / desktop Chrome: keep the browser's install prompt for our own button.
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; show(true); });
  window.addEventListener('appinstalled', () => { installPrompt = null; show(false); toast(S.installDone); });
  // iPhone / iPad have no prompt: show the Add to Home Screen steps instead.
  if (isIOS()) show(true);
  btn.onclick = async () => {
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice.catch(() => null);
      installPrompt = null;
      show(false);
      return;
    }
    openModal(`<h2 class="modal-title">📲 ${S.installIosTitle}</h2><ol class="install-steps">${S.installIosSteps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
      <div class="modal-buttons"><button class="btn btn-ghost" id="m-close">${S.cancel}</button></div>`, 'user');
    onModal('#m-close', () => closeModal());
  };
}

function showScreen(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('active', s.id === id);
}

function refreshHome() {
  const save = store.get('gb.save', null);
  if (save && save.state?.v !== E.STATE_VERSION) store.del('gb.save'); // saved on an older board
  $('#btn-resume').classList.toggle('hidden', !store.get('gb.save', null));
  const code = store.get('gb.room', null);
  $('#btn-rejoin').classList.toggle('hidden', !code);
  if (code) $('#btn-rejoin').textContent = t(S.rejoin, { code });
  showScreen('screen-home');
}

// ---------- Menus ----------
const setup = { kind: 'local', count: 4, names: [], mode: 'both', target: null };

function bindMenus() {
  $('#btn-pass').onclick = () => openSetup('local');
  $('#btn-create').onclick = () => openSetup('online');
  $('#btn-join').onclick = () => { $('#join-name').value = store.get('gb.name', ''); $('#join-error').textContent = ''; showScreen('screen-join'); };
  $('#btn-settings').onclick = () => openSettings();
  $('#btn-resume').onclick = () => {
    const save = store.get('gb.save', null);
    if (save) startLocal(save.state, save.lastHandoff);
  };
  $('#btn-rejoin').onclick = () => joinRoom(store.get('gb.room', ''), store.get('gb.name', 'Player'));
  for (const b of document.querySelectorAll('[data-back]')) b.onclick = () => refreshHome();
  $('#pc-minus').onclick = () => { setup.count = Math.max(CONFIG.minPlayers, setup.count - 1); setup.target = null; renderSetup(); };
  $('#pc-plus').onclick = () => { setup.count = Math.min(CONFIG.maxPlayers, setup.count + 1); setup.target = null; renderSetup(); };
  $('#btn-setup-go').onclick = () => {
    if (setup.kind === 'local') {
      const names = Array.from({ length: setup.count }, (_, i) => (setup.names[i] || '').trim() || t(S.playerName, { n: i + 1 }));
      store.set('gb.names', names);
      const state = E.createGame({ players: names.map((name) => ({ name })), mode: setup.mode, wealthTarget: setup.target });
      startLocal(state, null);
    } else {
      const name = $('#my-name').value.trim() || 'Player';
      store.set('gb.name', name);
      createRoom(name);
    }
  };
  $('#btn-join-go').onclick = () => {
    const name = $('#join-name').value.trim() || 'Player';
    store.set('gb.name', name);
    joinRoom($('#join-code').value.trim().toUpperCase(), name);
  };
  $('#btn-leave-lobby').onclick = () => leaveRoom();
  $('#btn-start-online').onclick = () => socket?.emit('room:start', {}, (res) => { if (!res.ok) toast(res.error, true); });
  $('#btn-game-settings').onclick = () => openSettings();
  $('#btn-view').onclick = () => { if (board && shown) board.toggleOverview(camPid(shown.phase === 'turn' ? shown.turn.active : null)); };
  $('#btn-home').onclick = () => {
    const pid = camPid(shown?.phase === 'turn' ? shown.turn.active : null);
    if (board && pid != null) board.focusToken(pid, { zoom: true });
  };
  $('#tog-players').onclick = () => toggleRail('players');
  $('#tog-actions').onclick = () => toggleRail('actions');
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' && modalOwner === 'user') closeModal(); });
}

function openSetup(kind) {
  setup.kind = kind;
  setup.names = store.get('gb.names', []);
  $('#setup-title').textContent = kind === 'local' ? S.passPlay : S.createRoom;
  $('#field-myname').classList.toggle('hidden', kind === 'local');
  $('#field-names').classList.toggle('hidden', kind !== 'local');
  $('#my-name').value = store.get('gb.name', '');
  $('#btn-setup-go').textContent = kind === 'local' ? S.start : S.createRoom;
  renderSetup();
  showScreen('screen-setup');
}

function renderSetup() {
  const n = setup.count;
  const lim = CONFIG.limits[n];
  $('#pc-value').textContent = n;
  $('#board-info').textContent = t(S.boardInfo, { shape: S.boardShape, spaces: BOARD_LAYOUT.length, dice: CONFIG.dice === 1 ? S.oneDie : S.twoDice });
  $('#name-list').innerHTML = Array.from({ length: n }, (_, i) => `<input data-i="${i}" maxlength="16" placeholder="${esc(t(S.playerName, { n: i + 1 }))}" value="${esc(setup.names[i] || '')}">`).join('');
  for (const inp of $('#name-list').querySelectorAll('input')) inp.oninput = () => { setup.names[inp.dataset.i] = inp.value; };
  $('#mode-list').innerHTML = ['both', 'wealth', 'turns', 'classic'].map((m) => {
    const extra = m === 'both' || m === 'turns' ? ` · ${t(S.roundsInfo, { rounds: lim.rounds })}` : m === 'classic' ? ` · ${t(S.capInfo, { rounds: lim.safetyCap })}` : '';
    return `<button class="mode-opt ${setup.mode === m ? 'sel' : ''}" data-m="${m}"><b>${S.modes[m].name}${m === 'both' ? `<em>${S.recommended}</em>` : ''}</b><small>${S.modes[m].desc}${extra}</small></button>`;
  }).join('');
  for (const b of $('#mode-list').querySelectorAll('button')) b.onclick = () => { setup.mode = b.dataset.m; renderSetup(); };
  const usesTarget = setup.mode === 'both' || setup.mode === 'wealth';
  $('#field-target').classList.toggle('hidden', !usesTarget);
  if (!lim.targets.includes(setup.target)) setup.target = lim.targets[1];
  $('#target-list').innerHTML = lim.targets.map((v) => `<button class="chip ${v === setup.target ? 'sel' : ''}" data-v="${v}">${fmt(v)}</button>`).join('');
  for (const b of $('#target-list').querySelectorAll('button')) b.onclick = () => { setup.target = Number(b.dataset.v); renderSetup(); };
}

// ---------- Controllers ----------
function startLocal(state, handoff) {
  room = null;
  lastHandoff = handoff;
  ctl = {
    kind: 'local',
    state,
    send(action) {
      try {
        const events = E.act(this.state, action);
        saveLocal();
        enqueue(structuredClone(this.state), events);
      } catch (e) { toast(e.message, true); }
    },
    viewer() { return E.whoActs(this.state); },
  };
  saveLocal();
  enterGame();
  enqueue(structuredClone(state), []);
}
function saveLocal() {
  if (ctl?.kind !== 'local') return;
  if (ctl.state.phase === 'ended') store.del('gb.save');
  else store.set('gb.save', { state: ctl.state, lastHandoff }); // NFR-008
}

function ensureSocket() {
  if (socket) return socket;
  if (!window.io) { toast(S.error, true); return null; }
  socket = window.io({ transports: ['websocket', 'polling'] });
  socket.on('room', (r) => {
    room = r;
    if (!r.started) { renderLobby(); showScreen('screen-lobby'); }
    else renderHUD();
  });
  socket.on('game', ({ state, events }) => {
    if (!ctl || ctl.kind !== 'online') startOnlineView();
    enqueue(state, events);
  });
  socket.on('disconnect', () => { if (ctl?.kind === 'online') toast(S.disconnected, true); });
  socket.io.on('reconnect', () => {
    const code = store.get('gb.room', null);
    if (code) socket.emit('room:join', { code, name: store.get('gb.name', 'Player'), clientId }, () => {});
  });
  return socket;
}
function createRoom(name) {
  const s = ensureSocket();
  if (!s) return;
  s.emit('room:create', { name, clientId, playerCount: setup.count, mode: setup.mode, target: setup.target }, (res) => {
    if (!res.ok) return toast(res.error, true);
    store.set('gb.room', res.code);
  });
}
function joinRoom(code, name) {
  const s = ensureSocket();
  if (!s) return;
  s.emit('room:join', { code, name, clientId }, (res) => {
    if (!res.ok) {
      $('#join-error').textContent = res.error;
      if (res.error === 'Room not found') store.del('gb.room');
      toast(res.error, true);
      if (!$('#screen-join').classList.contains('active')) refreshHome();
      return;
    }
    store.set('gb.room', res.code);
  });
}
function leaveRoom() {
  store.del('gb.room');
  socket?.disconnect();
  socket = null;
  room = null;
  ctl = null;
  shown = null;
  refreshHome();
}
function startOnlineView() {
  ctl = {
    kind: 'online',
    send(action) { socket.emit('game:action', action, (res) => { if (!res.ok) toast(res.error, true); }); },
    viewer() { return room?.you ?? null; },
  };
  enterGame();
}

function renderLobby() {
  if (!room) return;
  $('#lobby-code').textContent = room.code;
  const st = room.settings;
  $('#lobby-settings').textContent = `${st.playerCount} ${S.players} · ${S.modes[st.mode].name}${st.mode === 'both' || st.mode === 'wealth' ? ` · ${t(S.target, { t: fmt(st.target) })}` : ''}`;
  const rows = [];
  for (let i = 0; i < st.playerCount; i++) {
    const seat = room.seats[i];
    rows.push(seat
      ? `<li><span>${esc(seat.name)}${i === room.you ? ` (${S.you})` : ''}</span><span>${i === room.host ? `<span class="tag">${S.host}</span>` : ''}</span></li>`
      : '<li class="empty"><span>…</span></li>');
  }
  $('#seat-list').innerHTML = rows.join('');
  const full = room.seats.length === st.playerCount;
  const isHost = room.you === room.host;
  $('#btn-start-online').classList.toggle('hidden', !isHost);
  $('#btn-start-online').disabled = !full;
  $('#lobby-status').textContent = !full ? t(S.waitingPlayers, { have: room.seats.length, need: st.playerCount }) : isHost ? '' : S.hostStarts;
}

// ---------- Game screen ----------
function enterGame() {
  showScreen('screen-game');
  $('#notes').innerHTML = '';
  $('#turn-bar').classList.add('hidden');
  $('#spotlight').classList.add('hidden');
  shown = null;
  queue.length = 0;
  closeModal(true);
  if (!board) {
    board = new Board($('#board'), { onTileTap });
    board.onViewChange = (whole) => { $('#btn-view').textContent = whole ? '🎯' : '🗺️'; $('#btn-view').title = whole ? S.viewFollow : S.viewWhole; };
    $('#board').addEventListener('pointerdown', () => { if (busy) board.skip(); }); // FR-183: tap to skip
    $('#dice').addEventListener('pointerdown', () => board.skip());
  }
  applyRails();
}

// Collapsible side rails: hide the players and/or the action buttons so the board gets the whole screen.
const rails = store.get('gb.rails', { players: false, actions: false }); // true = minimised
function applyRails() {
  const g = $('#screen-game');
  g.classList.toggle('players-min', rails.players);
  g.classList.toggle('actions-min', rails.actions);
  $('#tog-players').innerHTML = rails.players ? '<span>👥</span><b>›</b>' : '<b>‹</b>';
  $('#tog-actions').innerHTML = rails.actions ? '<b>‹</b><span>🛠️</span>' : '<b>›</b>';
  $('#tog-players').setAttribute('aria-expanded', String(!rails.players));
  $('#tog-actions').setAttribute('aria-expanded', String(!rails.actions));
}
function toggleRail(which) {
  rails[which] = !rails[which];
  store.set('gb.rails', rails);
  applyRails();
}

function enqueue(state, events) {
  queue.push({ state, events });
  pump();
}
async function pump() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      const item = queue.shift();
      await playBatch(item);
      shown = item.state;
      if (queue.length === 0) renderHUD();
    }
  } catch (e) {
    console.error(e);
  } finally {
    busy = false;
    board?.endSkip();
  }
}

// Whose pawn the camera stays with: whoever is playing, for every viewer (online as in pass-and-play).
const camPid = (active) => active;
const online = () => ctl?.kind === 'online';

const wait = (ms) => board.tween(ms, () => {});

async function playBatch({ state, events }) {
  const prev = shown;
  if (!prev || prev.phase !== 'turn') board.sync(state);
  // Joining or resuming mid-game: start close to whoever is playing.
  if (!board.hasFocused && state.phase === 'turn' && !events.some((e) => e.type === 'turnStart')) board.focusToken(camPid(state.turn.active), { zoom: true, ms: 0 });
  let moved = false;
  if (events.length) {
    // The answer is in: clear the question and the turn bar while it plays out (both come back after if needed).
    $('#turn-bar').classList.add('hidden');
    if (modalOwner === 'stage') closeModal(true);
  }
  for (const [k, ev] of events.entries()) {
    switch (ev.type) {
      case 'turnStart':
        board.sync(state, { animatingTokens: new Set(state.players.map((p) => p.id)) });
        // A beat to take in how the last turn ended, then (online) a big "whose turn" splash; pass-and-play
        // has its hand-off screen for that. Then pan to the next player (zooming in the first time).
        if (k > 0 || prev?.phase === 'turn') await wait(700);
        if (online()) await turnSplash(state, ev.player);
        await board.focusToken(ev.player, { zoom: !board.hasFocused });
        break;
      case 'dice':
        await showDice(ev.dice, state.phase === 'firstRoll' || state.phase === 'tokenPick' ? 500 : 650);
        break;
      case 'move':
        // Dice rolled: come back in to the play zoom and follow the pawn.
        if (!moved) await board.focusToken(ev.player, { zoom: true });
        moved = true;
        await board.animateMove(ev.player, ev.path);
        break;
      case 'pay':
        board.floatText(ev.from, `-${fmt(ev.amount)}`, 'loss');
        board.setMood(ev.from, ev.to === 'bank' ? 'angry' : 'shocked');
        if (ev.to != null && ev.to !== 'bank') { board.floatText(ev.to, `+${fmt(ev.amount)}`, 'gain'); board.setMood(ev.to, 'celebrate'); }
        await wait(220);
        await announce(state, ev);
        break;
      case 'earn':
        board.floatText(ev.to, `+${fmt(ev.amount)}`, 'gain');
        board.setMood(ev.to, 'celebrate');
        await wait(220);
        await announce(state, ev);
        break;
      case 'buy': case 'build': case 'unmortgage':
        board.sparkle(ev.space);
        await announce(state, ev);
        break;
      case 'swap':
        board.sparkle(ev.a); board.sparkle(ev.b);
        await announce(state, ev);
        break;
      case 'travel': case 'jailed': case 'release': case 'bankrupt': case 'vehicle': case 'sell': case 'mortgage': case 'auction':
        await announce(state, ev);
        break;
      case 'tie': toast(S.tieReroll); break;
      case 'gameOver': board.setMood(ev.winner, 'celebrate'); break;
    }
  }
  board.sync(state);
}

async function showDice(dice, ms) {
  const tray = $('#dice');
  const rot = { 1: [0, 0], 2: [90, 0], 3: [0, -90], 4: [0, 90], 5: [-90, 0], 6: [0, 180] };
  const pips = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
  const face = (v) => `<div class="face f${v}">${Array.from({ length: 9 }, (_, k) => (pips[v].includes(k + 1) ? '<i></i>' : '<span></span>')).join('')}</div>`;
  tray.innerHTML = dice.map(() => `<div class="die" style="transform:rotateX(${Math.random() * 360}deg) rotateY(${Math.random() * 360}deg)">${[1, 2, 3, 4, 5, 6].map(face).join('')}</div>`).join('')
    + (dice.length > 1 ? `<div class="die-total stroke"></div>` : '');
  tray.classList.remove('hidden');
  await new Promise((r) => setTimeout(r, 30)); // let the start pose apply before spinning
  [...tray.querySelectorAll('.die')].forEach((el, k) => {
    const [rx, ry] = rot[dice[k]];
    el.style.transform = `rotateX(${rx + 720}deg) rotateY(${ry + 720 + (k ? 360 : 0)}deg)`;
  });
  await wait(ms);
  const total = tray.querySelector('.die-total');
  if (total) total.textContent = `${dice.reduce((a, b) => a + b, 0)}${dice[0] === dice[1] ? ' · DOUBLES!' : ''}`;
  await wait(350);
  tray.classList.add('hidden');
}

// ---------- HUD ----------
function renderHUD() {
  const st = shown;
  if (!st || !ctl) return;
  renderPlayers(st);
  renderFeed(st);
  renderModeChip(st);
  renderActions(st);
  renderTurnBar(st);
  renderStageModal(st);
  maybeHandoff(st);
  board.highlight(highlightFor(st));
}

const viewerIs = (pid) => ctl.kind === 'local' || ctl.viewer() === pid;

function renderPlayers(st) {
  const order = st.order.length ? st.order : st.players.map((p) => p.id);
  const maxW = Math.max(1, ...order.map((id) => E.netWorth(st, id)));
  const active = st.phase === 'turn' ? st.turn.active : E.whoActs(st);
  $('#players').innerHTML = order.map((id) => {
    const p = st.players[id];
    const tk = tokenInfo(p.token);
    const v = E.vehicleOf(p);
    const nw = E.netWorth(st, id);
    const seat = room?.seats?.[id];
    const badges = [
      v ? `<span title="${esc(v.name)}: ${esc(v.text)}">${v.icon}</span>` : '',
      p.jailCard ? `<span title="${esc(S.jailCard)}">🎫</span>` : '',
      p.jailed ? `<span title="${esc(S.inJail)}">🔒</span>` : '',
      seat && !seat.connected ? `<span title="${S.offline}">📴</span>` : '',
      seat?.bot ? `<span title="${S.bot}">🤖</span>` : '',
    ].join('');
    return `<div class="pcard ${id === active ? 'active' : ''} ${p.bankrupt ? 'out' : ''}" style="--c:${p.color}" data-p="${id}">
      <div class="avatar">${tk ? `<img src="${portraits[tk.id] || ''}" alt="">` : ''}</div>
      <div><div class="p-name">${esc(p.name)}${ctl.kind === 'online' && id === room?.you ? ` (${S.you})` : ''}</div>
      <div class="p-sub">${tk ? esc(tk.name) : '—'}</div>
      <div class="p-cash">💰${fmt(p.cash)} <span class="p-sub"><span class="nw-long">· ${S.netWorth}</span><span class="nw-short">${S.netWorthShort}</span> ${fmt(nw)}</span></div></div>
      <div class="p-badges">${badges}</div>
      ${st.wealthTarget ? `<div class="bar"><i style="width:${Math.min(100, (nw / st.wealthTarget) * 100)}%"></i></div>` : `<div class="bar"><i style="width:${(nw / maxW) * 100}%"></i></div>`}
    </div>`;
  }).join('');
  for (const el of $('#players').querySelectorAll('.pcard')) el.onclick = () => openPlayer(Number(el.dataset.p));
}

function renderFeed(st) {
  $('#feed').innerHTML = st.log.slice(-5).map((l) => `<li>${esc(l.text)}</li>`).join('');
}
function renderModeChip(st) {
  const m = S.modes[st.mode].name;
  const parts = [];
  if (st.mode === 'both' || st.mode === 'turns') parts.push(t(S.round, { r: st.round, max: st.roundLimit }));
  else if (st.mode === 'classic') parts.push(t(S.round, { r: st.round, max: st.safetyCap }));
  else parts.push(t(S.roundOpen, { r: st.round }));
  if (st.wealthTarget) parts.push(t(S.target, { t: fmt(st.wealthTarget) }));
  $('#mode-chip').innerHTML = `${m}${room ? ` · ${room.code}` : ''}<small>${parts.join(' · ')}</small>`;
}

function renderActions(st) {
  const el = $('#actions');
  const actor = E.whoActs(st);
  if (st.phase !== 'turn' || actor == null) { el.innerHTML = ''; return; }
  if (!viewerIs(actor)) { el.innerHTML = ''; return; } // the turn bar says who we are waiting for
  const tn = st.turn;
  const p = st.players[tn.active];
  if (tn.stage !== 'roll' && tn.stage !== 'manage') { el.innerHTML = ''; return; }
  // Your turn, before rolling (or with a doubles re-roll pending): manage properties, then roll.
  // The turn ends by itself once the roll is resolved.
  const hint = tn.stage === 'roll' && p.jailed ? (p.jailTurns >= CONFIG.jailMaxFailedRolls ? '' : st.numDice === 1 ? S.jailHint1 : S.jailHint2) : '';
  const owned = E.propsOf(st, p.id);
  const can = {
    build: owned.some((i) => E.canBuild(st, p.id, i)),
    sell: owned.some((i) => E.canSell(st, p.id, i)),
    mortgage: owned.some((i) => E.canMortgage(st, p.id, i)),
    unmortgage: owned.some((i) => E.canUnmortgage(st, p.id, i)),
  };
  const icons = { build: '🏗️', sell: '💸', mortgage: '🏦', unmortgage: '🔓' };
  const mb = (k, cls) => `<button class="btn ${cls} btn-manage" data-sheet="${k}" ${can[k] ? '' : 'disabled'}><span class="ic">${icons[k]}</span><span class="tx">${S[k]}</span></button>`;
  el.innerHTML = (hint ? `<div class="waiting">🔒 ${hint}</div>` : '')
    + mb('build', 'btn-green') + mb('sell', 'btn-blue') + mb('mortgage', 'btn-purple') + mb('unmortgage', 'btn-purple')
    + `<button class="btn btn-yellow btn-roll" id="a-roll"><span class="ic">🎲</span><span class="tx">${tn.stage === 'manage' ? S.rollAgain : S.roll}</span></button>`;
  for (const b of el.querySelectorAll('[data-sheet]')) b.onclick = () => { sheet = b.dataset.sheet; renderStageModal(shown, true); };
  $('#a-roll').onclick = () => { sheet = null; send({ type: 'roll' }); };
}

// Bottom-centre bar: loud "Your turn!" (tap to roll) for the player whose turn it is; for everyone else,
// whose turn it is and that we are waiting for them.
function renderTurnBar(st) {
  const bar = $('#turn-bar');
  const actor = st.phase === 'turn' ? E.whoActs(st) : null;
  if (actor == null) { bar.classList.add('hidden'); return; }
  const stage = st.turn.stage;
  const p = st.players[actor];
  const mine = viewerIs(actor);
  const canRoll = mine && (stage === 'roll' || stage === 'manage');
  if (mine && !canRoll) { bar.classList.add('hidden'); return; } // a dialog is asking them something
  const img = avatarOf(p);
  const title = mine ? (online() ? S.yourTurn : t(S.yourTurnName, { name: p.name })) : t(S.turnOf, { name: p.name });
  const sub = mine ? (stage === 'manage' ? S.tapToRollAgain : S.tapToRoll)
    : t(S.waitingFor, { name: p.name }) + (room?.seats?.[room.you]?.bot ? ` · ${S.botPlaying}` : '');
  bar.style.setProperty('--c', p.color);
  bar.classList.toggle('mine', mine);
  bar.disabled = !mine;
  bar.innerHTML = `<span class="tb-av">${img ? `<img src="${img}" alt="">` : ''}</span><span class="tb-text"><b>${esc(title)}</b><small>${esc(sub)}</small></span>${mine ? '<span class="tb-dice">🎲</span>' : ''}`;
  bar.onclick = canRoll ? () => { sheet = null; send({ type: 'roll' }); } : null;
  bar.classList.remove('hidden');
}

function send(action) {
  if (busy) board.skip();
  ctl.send({ player: E.whoActs(shown), ...action });
}

function highlightFor(st) {
  if (st.phase !== 'turn') return [];
  const tn = st.turn;
  const actor = E.whoActs(st);
  if (!viewerIs(actor)) return [];
  if (tn.stage === 'auctionPick') return E.propsOf(st, actor);
  if (tn.stage === 'auctionRespond') return [tn.auction.offered, ...E.propsOf(st, actor)];
  if ((tn.stage === 'manage' || tn.stage === 'roll') && sheet) return E.propsOf(st, actor).filter((i) => sheetCan(st, actor, i));
  if (tn.stage === 'buy') return [tn.buy];
  if (tn.stage === 'travel') return tn.travel.options.map((o) => o.space);
  return [];
}
const sheetCan = (st, pid, i) => ({ build: E.canBuild, sell: E.canSell, mortgage: E.canMortgage, unmortgage: E.canUnmortgage })[sheet]?.(st, pid, i);

// ---------- Hand-off (FR-170, FR-116) ----------
// The character SVGs have a lot of empty canvas around the drawing; crop to the drawn pixels (square,
// with a little room) so the character fills the hand-off circle.
function cropToArt(url, size = 512) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const W = img.naturalWidth || 640, H = img.naturalHeight || 640;
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, W, H);
      const a = g.getImageData(0, 0, W, H).data;
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (a[(y * W + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      if (x1 < 0) { resolve(url); return; }
      const side = Math.max(x1 - x0, y1 - y0) * 1.06;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const out = document.createElement('canvas');
      out.width = out.height = size;
      out.getContext('2d').drawImage(c, cx - side / 2, cy - side / 2, side, side, 0, 0, size, size);
      resolve(out.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function maybeHandoff(st) {
  const el = $('#handoff');
  if (ctl.kind !== 'local' || st.phase !== 'turn') { el.classList.add('hidden'); return; }
  const actor = E.whoActs(st);
  if (actor == null || actor === lastHandoff) { el.classList.add('hidden'); return; }
  const p = st.players[actor];
  const tk = tokenInfo(p.token);
  const auction = st.turn.stage === 'auctionRespond';
  el.style.setProperty('--c', p.color);
  el.innerHTML = `<div class="stroke" style="font-size:20px">${auction ? '🔨 ' + S.auctionTurn : S.handoffTitle}</div>
    <img src="${closeUps[tk.id] || portraits[tk.id] || ''}" alt="${esc(tk.name)}">
    <div class="handoff-info"><div class="handoff-name">${esc(p.name)}</div><div class="stroke">${esc(tk.name)}</div>
    <button class="btn btn-yellow btn-big">${S.tapToStart}</button></div>`;
  el.classList.remove('hidden');
  el.onclick = () => {
    lastHandoff = actor;
    saveLocal();
    el.classList.add('hidden');
    board.focusToken(actor, { zoom: true });
  };
}

// ---------- Modals ----------
function openModal(html, owner, { passive = false } = {}) {
  modalOwner = owner;
  const m = $('#modal');
  m.classList.toggle('passive', passive);
  $('#modal-card').innerHTML = html;
  m.classList.remove('hidden');
  $('#modal-card').scrollTop = 0;
}
function closeModal(force = false) {
  if (!force && modalOwner === 'stage') return;
  $('#modal').classList.add('hidden');
  modalOwner = null;
  modalKey = null;
}
function onModal(sel, fn) { for (const el of $('#modal-card').querySelectorAll(sel)) el.onclick = () => fn(el); }

function renderStageModal(st, forceSheet = false) {
  const actor = E.whoActs(st);
  const tn = st.turn;
  const key = `${st.phase}|${tn?.stage}|${actor}|${st.turnNo}|${st.log.length}|${sheet}|${selected}|${room?.deadline || ''}|${st.firstRoll.queue.join(',')}|${st.tokenPick.queue.length}`;
  if (key === modalKey && !forceSheet && !$('#modal').classList.contains('hidden')) return;
  const html = stageModalHTML(st, actor);
  if (html) {
    modalKey = key;
    openModal(html, 'stage');
    wireStageModal(st, actor);
    return;
  }
  if (modalOwner === 'stage') closeModal(true);
}

function stageModalHTML(st, actor) {
  if (st.phase === 'ended') return endHTML(st);
  const mine = actor != null && viewerIs(actor);
  if (st.phase === 'firstRoll') {
    const rows = st.players.map((p) => `<li class="${p.id === actor ? 'now' : ''}"><span>${esc(p.name)}</span><span>${p.orderRolls.join(' → ') || '—'}</span></li>`).join('');
    return `<h2 class="modal-title">${S.firstRollTitle}</h2><p class="modal-sub">${S.firstRollHint}</p><ul class="order-list">${rows}</ul>
      <div class="modal-buttons">${mine ? `<button class="btn btn-yellow btn-big" id="m-orderroll">🎲 ${esc(t(S.rollFor, { name: st.players[actor].name }))}</button>` : `<div class="waiting">${esc(t(S.waitingFor, { name: st.players[actor].name }))}</div>`}</div>`;
  }
  if (st.phase === 'tokenPick') {
    const taken = new Map(st.players.filter((p) => p.token).map((p) => [p.token, p.name]));
    const grid = TOKENS.map((tk) => `<button class="token-opt" style="--c:${tk.color}" data-token="${tk.id}" ${taken.has(tk.id) || !mine ? 'disabled' : ''}>
      <img src="${portraits[tk.id] || ''}" alt=""><span>${esc(tk.name)}</span><span>${taken.has(tk.id) ? esc(taken.get(tk.id)) : esc(tk.colorName)}</span></button>`).join('');
    return `<h2 class="modal-title">${S.pickTitle}</h2><p class="modal-sub">${esc(mine ? t(S.pickHint, { name: st.players[actor].name }) : t(S.waitingFor, { name: st.players[actor].name }))}</p><div class="token-grid">${grid}</div>`;
  }
  const tn = st.turn;
  const p = st.players[tn.active];
  if (!mine) {
    if (tn.stage === 'auctionRespond' || tn.stage === 'auctionConfirm') {
      return `<h2 class="modal-title">🔨 ${S.auction}</h2>${propCardHTML(st, tn.auction.offered)}<p class="modal-sub" style="margin-top:10px">${esc(t(S.waitingFor, { name: st.players[actor].name }))}</p>${timerHTML()}`;
    }
    if (tn.stage === 'card') return `<div class="chance-card"><div class="q">?</div><h3>${esc(CHANCE_CARDS.find((c) => c.id === tn.card).title)}</h3><p>${esc(CHANCE_CARDS.find((c) => c.id === tn.card).text)}</p></div>`;
    return null;
  }
  switch (tn.stage) {
    case 'jail': {
      const third = p.jailTurns >= CONFIG.jailMaxFailedRolls;
      return `<h2 class="modal-title">🔒 ${S.jailTitle}</h2><p class="modal-sub">${third ? t(S.jailHintThird, { fee: fmt(CONFIG.jailFee) }) : st.numDice === 1 ? S.jailHint1 : S.jailHint2}</p>
        <div class="modal-buttons"><button class="btn btn-green" id="m-card">🎫 ${S.jailUseCard}</button>
        <button class="btn btn-yellow" id="m-nocard">${third ? t(S.jailPay, { fee: fmt(CONFIG.jailFee) }) : '🎲 ' + S.jailRoll}</button></div>`;
    }
    case 'reroll': {
      const total = tn.pendingDice.reduce((a, b) => a + b, 0);
      return `<h2 class="modal-title">🏎️ ${S.rerollTitle}</h2><p class="modal-sub">${t(S.rerollText, { total: `${tn.pendingDice.join(' + ')} = ${total}` })}</p>
        <div class="modal-buttons"><button class="btn btn-purple" id="m-reroll">${S.useReroll}</button><button class="btn btn-yellow" id="m-keep">${S.keepRoll}</button></div>`;
    }
    case 'buy': {
      const x = st.props[tn.buy];
      return `${propCardHTML(st, tn.buy)}<div class="modal-buttons"><button class="btn btn-green btn-big" id="m-buy" ${p.cash < x.price ? 'disabled' : ''}>${t(S.buyFor, { price: fmt(x.price) })}</button><button class="btn btn-red" id="m-pass">${S.pass}</button></div>`;
    }
    case 'travel': {
      // Transport: three trips, fare by distance (tap one here or its highlighted tile on the board).
      const hub = st.props[tn.travel.from];
      const trips = tn.travel.options.map((o, k) => {
        const x = st.props[o.space];
        const where = x ? x.name : `${CORNERS[st.spaces[o.space].corner].icon} ${CORNERS[st.spaces[o.space].corner].name}`;
        const bits = [S.travelBands[k] ?? '', t(S.travelSpaces, { n: o.steps })];
        if (x?.owner != null) bits.push(`${S.owner}: ${st.players[x.owner].name}`);
        else if (x) bits.push(S.unowned);
        return `<button class="pick-item" style="--c:${x?.color || '#9aa'}" data-space="${o.space}" data-trip="${k}"><span class="sw"></span><span class="grow"><b>${esc(where)}</b><small>${esc(bits.join(' · '))}</small></span><span class="val">-${fmt(o.fare)}</span></button>`;
      }).join('');
      return `<h2 class="modal-title">🚆 ${esc(t(S.travelTitle, { prop: hub.name }))}</h2><p class="modal-sub">${esc(t(S.travelHint, { owner: st.players[hub.owner].name }))}</p><div class="pick-list">${trips}</div>`;
    }
    case 'card': {
      const c = CHANCE_CARDS.find((k) => k.id === tn.card);
      return `<div class="chance-card"><div class="q">?</div><h3>${esc(c.title)}</h3><p>${esc(c.text)}</p></div><div class="modal-buttons"><button class="btn btn-yellow btn-big" id="m-cardok">${S.ok}</button></div>`;
    }
    case 'auctionPick': {
      const own = E.propsOf(st, p.id);
      return `<h2 class="modal-title">🔨 ${S.auctionPickTitle}</h2><p class="modal-sub">${S.auctionPickHint}</p>${pickListHTML(st, own, (i) => fmt(st.props[i].price))}
        <div class="modal-buttons"><button class="btn btn-red" id="m-skip">${S.skip}</button></div>`;
    }
    case 'auctionRespond': {
      const a = tn.auction;
      const offered = st.props[a.offered];
      const own = E.propsOf(st, actor);
      return `<h2 class="modal-title">🔨 ${esc(t(S.auctionRespondTitle, { name: p.name, prop: offered.name }))}</h2>${propCardHTML(st, a.offered)}
        <p class="modal-sub" style="margin-top:10px">${S.auctionRespondHint}</p>${timerHTML()}${pickListHTML(st, own, (i) => fmt(st.props[i].price), 'offer')}
        <div class="modal-buttons"><button class="btn btn-red" id="m-refuse">${S.refuse}</button></div>`;
    }
    case 'auctionConfirm': {
      const a = tn.auction;
      const offers = a.offers.map((o) => {
        const x = st.props[o.space];
        const op = st.players[o.player];
        return `<button class="pick-item" style="--c:${x.color || '#888'}" data-from="${o.player}"><span class="sw"></span><span class="grow"><b>${esc(x.name)}</b><small>${esc(op.name)} · ${esc(x.countryName || x.regionName)}${x.steps ? ` · ${S.steps[x.steps]}` : ''}${x.mortgaged ? ` · ${S.mortgaged}` : ''}</small></span><span class="val">${fmt(x.price)}</span></button>`;
      }).join('');
      return `<h2 class="modal-title">🔨 ${esc(t(S.auctionConfirmTitle, { prop: st.props[a.offered].name }))}</h2>${timerHTML()}<div class="pick-list">${offers || `<p class="modal-sub">${S.noOffers}</p>`}</div>
        <div class="modal-buttons"><button class="btn btn-red" id="m-declineall">${S.declineAll}</button></div>`;
    }
    case 'shop': {
      const items = VEHICLES.map((v) => {
        const owner = st.vehicles[v.id];
        return `<button class="vehicle" data-v="${v.id}" ${owner !== null || p.cash < v.price ? 'disabled' : ''}><span class="vi">${v.icon}</span><b>${esc(v.name)}</b><small>${esc(v.text)}</small>
          <span class="val">${owner !== null ? `${S.soldOut} · ${esc(st.players[owner].name)}` : fmt(v.price)}</span></button>`;
      }).join('');
      return `<h2 class="modal-title">🛍️ ${S.shopTitle}</h2><p class="modal-sub">${S.shopHint}</p><div class="vehicle-grid">${items}</div>
        <div class="modal-buttons"><button class="btn btn-red" id="m-leave">${S.leave}</button></div>`;
    }
    case 'roll':
    case 'manage': {
      if (!sheet) return null;
      const own = E.propsOf(st, p.id).filter((i) => sheetCan(st, p.id, i));
      const value = (i) => {
        const x = st.props[i];
        if (sheet === 'build') return `-${fmt(E.buildCost(st, p.id, x))}`;
        if (sheet === 'sell') return `+${fmt(E.sellValue(x))}`;
        if (sheet === 'mortgage') return `+${fmt(E.mortgageValue(x))}`;
        return `-${fmt(E.unmortgageCost(x))}`;
      };
      return `<h2 class="modal-title">${esc(t(S.manageTitle, { action: S[sheet] }))}</h2><p class="modal-sub">💰 ${fmt(p.cash)}</p>
        ${own.length ? pickListHTML(st, own, value, 'manage') : `<p class="modal-sub">${S.nothingToManage}</p>`}
        <div class="modal-buttons"><button class="btn btn-ghost" id="m-closesheet">${S.cancel}</button></div>`;
    }
  }
  return null;
}

function wireStageModal(st, actor) {
  const a = (type, extra = {}) => () => send({ type, player: actor, ...extra });
  onModal('#m-orderroll', a('orderRoll'));
  onModal('[data-token]', (el) => send({ type: 'pickToken', player: actor, token: el.dataset.token }));
  onModal('#m-card', a('useJailCard'));
  onModal('#m-nocard', a('skipJailCard'));
  onModal('#m-reroll', a('useReroll'));
  onModal('#m-keep', a('keepRoll'));
  onModal('#m-buy', a('buy'));
  onModal('#m-pass', a('decline'));
  onModal('#m-cardok', a('dismissCard'));
  onModal('#m-skip', a('auctionSkip'));
  onModal('#m-refuse', a('auctionRefuse'));
  onModal('#m-declineall', a('auctionDecline'));
  onModal('#m-leave', a('skipShop'));
  onModal('[data-v]', (el) => send({ type: 'buyVehicle', player: actor, vehicle: el.dataset.v }));
  onModal('[data-from]', (el) => send({ type: 'auctionConfirm', player: actor, from: Number(el.dataset.from) }));
  onModal('#m-closesheet', () => { sheet = null; closeModal(true); renderHUD(); });
  onModal('[data-space]', (el) => {
    const space = Number(el.dataset.space);
    const stage = st.turn?.stage;
    if (stage === 'travel') send({ type: 'travel', player: actor, option: Number(el.dataset.trip) });
    else if (stage === 'auctionPick') send({ type: 'auctionPick', player: actor, space });
    else if (stage === 'auctionRespond') send({ type: 'auctionOffer', player: actor, space });
    else if ((stage === 'manage' || stage === 'roll') && sheet) send({ type: sheet, player: actor, space });
  });
}

function pickListHTML(st, spaces, valueFn) {
  if (!spaces.length) return `<p class="modal-sub">${S.none}</p>`;
  return `<div class="pick-list">${spaces.map((i) => {
    const x = st.props[i];
    const bits = [x.countryName || x.regionName];
    if (x.steps) bits.push(S.steps[x.steps]);
    if (x.mortgaged) bits.push(S.mortgaged);
    if (x.tradeCount) bits.push(`${S.trades} ${x.tradeCount} · ×${x.factor.toFixed(2)}`);
    return `<button class="pick-item" style="--c:${x.color || '#9aa'}" data-space="${i}"><span class="sw"></span><span class="grow"><b>${esc(x.name)}</b><small>${esc(bits.join(' · '))}</small></span><span class="val">${valueFn(i)}</span></button>`;
  }).join('')}</div>`;
}

function timerHTML() {
  if (!room?.deadline) return '';
  return `<div class="timer" data-deadline="${room.deadline}">⏱ ${Math.max(0, Math.ceil((room.deadline - Date.now()) / 1000))}s</div>`;
}
setInterval(() => {
  for (const el of document.querySelectorAll('[data-deadline]')) el.textContent = `⏱ ${Math.max(0, Math.ceil((Number(el.dataset.deadline) - Date.now()) / 1000))}s`;
}, 500);

// Property card (Appendix A.1)
function propCardHTML(st, i) {
  const x = st.props[i];
  const owner = x.owner != null ? st.players[x.owner] : null;
  const rows = [];
  if (x.kind === 'city') {
    const base = Math.floor(x.price * CONFIG.cityRentBase);
    const fac = x.factor;
    const complete = owner && E.completeSet(st, owner.id, x.country);
    const cur = x.steps ? x.steps + 1 : complete ? 1 : 0;
    const r = [[S.rentBase, base], [S.rentSet, base * 2], [S.rentHouse, Math.floor(x.price * 0.5 * fac)], [S.rentBuilding, Math.floor(x.price * 1.25 * fac)], [S.rentTower, Math.floor(x.price * 2.5 * fac)]];
    r.forEach(([k, v], idx) => rows.push(`<tr class="${owner && idx === cur ? 'now' : ''}"><td>${k}</td><td>${fmt(v)}</td></tr>`));
  } else {
    const n = owner ? st.props && Object.values(st.props).filter((u) => u.kind === 'utility' && u.owner === owner.id).length : 0;
    const transport = E.isTransport(x); // transport charges a fare per space travelled instead of rent
    CONFIG.utilityRent.slice(1).forEach((v, idx) => rows.push(`<tr class="${owner && Math.min(n, 4) === idx + 1 ? 'now' : ''}"><td>${t(transport ? S.fareRow : S.utilityRentRow, { n: idx === 3 ? '4+' : idx + 1 })}</td><td>${fmt(transport ? v * CONFIG.travelFareRate : v)}</td></tr>`));
  }
  const ownerTk = owner ? tokenInfo(owner.token) : null;
  const meta = [
    `<div><span>${S.owner}</span><b>${owner ? `${esc(owner.name)} · ${esc(ownerTk?.name || '')}` : S.unowned}</b></div>`,
    x.kind === 'city' ? `<div><span>${S.buildings}</span><b>${S.steps[x.steps]}</b></div>` : '',
    x.kind === 'city' ? `<div><span>${S.buildCost}</span><b>${fmt(E.baseBuildCost(x))}</b></div>` : '',
    `<div><span>${S.trades}</span><b>${x.tradeCount}</b></div>`,
    x.kind === 'city' ? `<div><span>${S.factor}</span><b>×${x.factor.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}</b></div>` : '',
  ].join('');
  // The card face is the same design as the board tile; rent and status sit beside it.
  return `<div class="prop-wrap">${cardHTML(cardModel(st, i))}
    <div class="prop-details" style="--c:${x.kind === 'city' ? x.color : UTILITY_COLOR}">
      <h4>${x.kind === 'utility' && E.isTransport(x) ? S.farePerSpace : S.rent}</h4><table>${rows.join('')}</table>
      <div class="prop-meta">${meta}</div>
    </div></div>`;
}

function onTileTap(i) {
  if (!shown || i == null) return;
  const st = shown;
  if (modalOwner === 'stage') {
    // Tapping a highlighted tile acts like picking it from the list.
    const btn = $('#modal-card').querySelector(`[data-space="${i}"]`);
    if (btn) btn.click();
    return;
  }
  const sp = st.spaces[i];
  if (sp.kind === 'corner') {
    openModal(`<h2 class="modal-title">${CORNERS[sp.corner].icon} ${CORNERS[sp.corner].name}</h2><p class="modal-sub">${S.cornerText[sp.corner]}</p><div class="modal-buttons"><button class="btn btn-ghost" id="m-close">${S.cancel}</button></div>`, 'user');
  } else {
    openModal(`${propCardHTML(st, i)}<div class="modal-buttons"><button class="btn btn-ghost" id="m-close">${S.cancel}</button></div>`, 'user');
  }
  onModal('#m-close', () => closeModal());
}

function openPlayer(pid) {
  if (modalOwner === 'stage') return;
  const st = shown;
  const p = st.players[pid];
  const tk = tokenInfo(p.token);
  const v = E.vehicleOf(p);
  const own = E.propsOf(st, pid);
  openModal(`<div class="end-winner" style="--c:${p.color}">${tk ? `<img src="${portraits[tk.id]}" style="width:96px;height:96px" alt="">` : ''}<h2 class="modal-title">${esc(p.name)}</h2>
    <p class="modal-sub">${tk ? esc(tk.name) : ''} · 💰${fmt(p.cash)} · ${S.netWorth} ${fmt(E.netWorth(st, pid))}</p></div>
    ${v ? `<p class="modal-sub">${v.icon} <b>${esc(v.name)}</b> — ${esc(v.text)}</p>` : ''}
    ${p.jailCard ? `<p class="modal-sub">🎫 ${S.jailCard}</p>` : ''}
    <h3 class="stroke" style="margin:8px 0">${S.properties}</h3>${pickListHTML(st, own, (i) => fmt(st.props[i].price))}
    <div class="modal-buttons"><button class="btn btn-ghost" id="m-close">${S.cancel}</button></div>`, 'user');
  onModal('#m-close', () => closeModal());
  onModal('[data-space]', (el) => onTileTap(Number(el.dataset.space)));
}

function endHTML(st) {
  const w = st.players[st.winner];
  const tk = tokenInfo(w.token);
  const rank = E.ranking(st).map((id, k) => {
    const p = st.players[id];
    return `<li style="--c:${p.color}"><b>${k + 1}</b><img src="${portraits[p.token] || ''}" alt=""><span class="grow">${esc(p.name)}${p.bankrupt ? ` · ${S.bankrupt}` : ''}</span><b>${fmt(E.netWorth(st, id))}</b></li>`;
  }).join('');
  return `<div class="end-winner" style="--c:${w.color}"><h2 class="modal-title">🏆 ${S.gameOver}</h2><img src="${portraits[tk.id] || ''}" alt="">
    <h2 class="modal-title" style="font-size:34px">${esc(t(S.winner, { name: w.name }))}</h2><p class="modal-sub">${esc(st.endReason)}</p></div>
    <ol class="rank-list">${rank}</ol>
    <div class="modal-buttons">${ctl.kind === 'local' ? `<button class="btn btn-yellow" id="m-rematch">${S.rematch}</button>` : ''}<button class="btn btn-blue" id="m-home">${S.home}</button></div>`;
}
document.addEventListener('click', (e) => {
  if (e.target.id === 'm-rematch' && shown) {
    const st = E.createGame({ players: shown.players.map((p) => ({ name: p.name })), mode: shown.mode, wealthTarget: shown.wealthTarget });
    startLocal(st, null);
  }
  if (e.target.id === 'm-home') {
    closeModal(true);
    if (ctl?.kind === 'online') leaveRoom();
    else { ctl = null; shown = null; refreshHome(); }
  }
});

function openSettings() {
  const inGame = $('#screen-game').classList.contains('active') && ctl;
  const html = `<h2 class="modal-title">⚙ ${S.settingsTitle}</h2>
    <p class="modal-sub">${S.cameraHint}</p>
    <div class="modal-buttons">${inGame ? `<button class="btn btn-red" id="m-quit">${ctl.kind === 'local' ? S.quit : S.leaveRoom}</button>` : ''}<button class="btn btn-ghost" id="m-close">${S.cancel}</button></div>`;
  const prevOwner = modalOwner;
  openModal(html, 'user');
  onModal('#m-close', () => { closeModal(true); if (prevOwner === 'stage') { modalKey = null; renderHUD(); } });
  onModal('#m-quit', () => {
    closeModal(true);
    if (ctl.kind === 'local') { saveLocal(); ctl = null; shown = null; refreshHome(); }
    else leaveRoom();
  });
}

// ---------- Event notifications ----------
// Buying, rent, fares, taxes, building, swaps... pop up as a card with the player's character, so every
// player sees what just happened (online too). Newest on top; each fades after a few seconds.
const bold = (s) => `<b>${esc(s)}</b>`;
// The moments that matter most (buying, rent, fares, tax, jail, swaps, bankruptcy) also take the centre of
// the screen for a moment; everything goes to the notification stack.
async function announce(st, ev) {
  const name = (pid) => bold(st.players[pid]?.name ?? '?');
  const prop = (i) => bold(st.props[i]?.name ?? E.spaceName(st, i));
  const N = S.note;
  let pid, icon, text, amount = null, tone = 'info', big = false;
  switch (ev.type) {
    case 'buy':
      pid = ev.player; icon = '🏠'; tone = 'loss';
      text = t(N.bought, { p: name(pid), x: prop(ev.space) }); amount = -(st.props[ev.space]?.price ?? 0); big = true;
      break;
    case 'pay': {
      if (ev.kind === 'fare') return; // the trip itself is announced (travel)
      pid = ev.from; tone = 'loss'; amount = -ev.amount;
      const toPlayer = ev.to != null && ev.to !== 'bank';
      if (ev.kind === 'rent') { icon = '💸'; big = true; text = t(N.rent, { p: name(pid), q: name(ev.to), x: prop(ev.space) }); }
      else if (ev.kind === 'tax') { icon = '🧾'; big = true; text = t(N.tax, { p: name(pid) }); }
      else if (ev.kind === 'jail') { icon = '🔓'; text = t(N.jail, { p: name(pid) }); }
      else if (toPlayer) { icon = '💸'; text = t(N.paidTo, { p: name(pid), q: name(ev.to), why: esc(ev.reason ?? '') }); }
      else { icon = '🏦'; text = t(N.paidBank, { p: name(pid), why: esc(ev.reason ?? '') }); }
      break;
    }
    case 'earn':
      pid = ev.to; icon = '💰'; tone = 'gain'; amount = ev.amount;
      text = t(N.earned, { p: name(pid), why: esc(ev.reason ?? '') });
      break;
    case 'build':
      pid = ev.player; icon = '🏗️';
      text = t(N.built, { p: name(pid), what: esc(S.steps[ev.steps]?.toLowerCase() ?? ''), x: prop(ev.space) });
      break;
    case 'sell': pid = ev.player; icon = '🏚️'; text = t(N.sold, { p: name(pid), x: prop(ev.space) }); break;
    case 'mortgage': pid = ev.player; icon = '🏦'; text = t(N.mortgaged, { p: name(pid), x: prop(ev.space) }); break;
    case 'unmortgage': pid = ev.player; icon = '🔑'; text = t(N.unmortgaged, { p: name(pid), x: prop(ev.space) }); break;
    case 'vehicle': {
      const v = VEHICLES.find((x) => x.id === ev.vehicle);
      pid = ev.player; icon = v?.icon ?? '🚗'; tone = 'loss'; amount = v ? -v.price : null;
      text = t(N.vehicle, { p: name(pid), v: bold(v?.name ?? '') });
      break;
    }
    case 'bankrupt': pid = ev.player; icon = '💥'; tone = 'bad'; big = true; text = t(N.bankrupt, { p: name(pid) }); break;
    case 'swap': pid = st.props[ev.a]?.owner; icon = '🤝'; big = true; text = t(N.swap, { x: prop(ev.a), y: prop(ev.b) }); break;
    case 'auction': pid = ev.player; icon = '🔨'; text = t(N.swapOffer, { p: name(pid), x: prop(ev.space) }); break;
    case 'travel':
      pid = ev.player; icon = '🚆'; tone = 'loss'; amount = ev.fare != null ? -ev.fare : null; big = true;
      text = t(N.travel, { p: name(pid), x: prop(ev.from), y: bold(E.spaceName(st, ev.to)), q: name(ev.owner) });
      break;
    case 'jailed': pid = ev.player; icon = '🔒'; tone = 'bad'; big = true; text = t(N.jailed, { p: name(pid) }); break;
    case 'release': pid = ev.player; icon = '🔓'; text = t(N.released, { p: name(pid) }); break;
    default: return;
  }
  const note = { player: st.players[pid], icon, html: text, amount, tone };
  notify(note);
  if (big) await spotlight(note);
}

const avatarOf = (player) => (player?.token ? portraits[player.token] : null);
const amountHTML = (amount, cls) => (amount ? `<div class="${cls} ${amount < 0 ? 'neg' : 'pos'}">${amount < 0 ? '−' : '+'}${fmt(Math.abs(amount))}</div>` : '');

// Centre-screen card that holds the stage for a moment (tap the board to skip, like every animation).
async function spotlight({ player, icon, html, amount, tone }, { turn = false, ms = 1900 } = {}) {
  if (board.skipping) return;
  const el = $('#spotlight');
  const img = avatarOf(player);
  el.style.setProperty('--c', player?.color || '#8890b0');
  el.className = `spotlight spot-${tone}${turn ? ' spot-turn' : ''}`;
  el.innerHTML = `<div class="spot-card"><div class="spot-av">${img ? `<img src="${img}" alt="">` : ''}${icon ? `<span class="spot-ic">${icon}</span>` : ''}</div>`
    + `<div class="spot-text">${html}</div>${amountHTML(amount, 'spot-amt')}</div>`;
  await wait(ms);
  el.classList.add('out');
  await new Promise((r) => setTimeout(r, 240));
  el.classList.add('hidden');
}

// Online: everyone sees whose turn starts; the player whose turn it is gets a loud "Your turn!".
function turnSplash(st, pid) {
  const p = st.players[pid];
  const mine = ctl.viewer() === pid;
  const html = `<div class="spot-title">${mine ? S.yourTurn : esc(t(S.turnOf, { name: p.name }))}</div>${mine ? `<div class="spot-sub">${esc(p.name)}</div>` : ''}`;
  return spotlight({ player: p, icon: mine ? '🎲' : '', html, tone: mine ? 'mine' : 'info' }, { turn: true, ms: mine ? 1500 : 1100 });
}

function notify({ player, icon, html, amount, tone }) {
  const el = document.createElement('div');
  el.className = `note note-${tone}`;
  if (player?.color) el.style.setProperty('--c', player.color);
  const img = avatarOf(player);
  el.innerHTML = `<div class="note-av">${img ? `<img src="${img}" alt="">` : ''}<span class="note-ic">${icon}</span></div>`
    + `<div class="note-text">${html}</div>${amountHTML(amount, 'note-amt')}`;
  const stack = $('#notes');
  stack.prepend(el);
  noteLife(el, 4200);
  while (stack.children.length > 4) stack.lastChild.remove();
}
// A notification outlives a pass-and-play hand-off screen, so the next player still gets to read it.
function noteLife(el, ms, held = false) {
  setTimeout(() => {
    if (!el.isConnected) return;
    if (!$('#handoff').classList.contains('hidden')) return noteLife(el, 500, true);
    if (held) return noteLife(el, 3500);
    el.classList.add('out');
    setTimeout(() => el.remove(), 400);
  }, ms);
}

function toast(text, bad = false) {
  const el = document.createElement('div');
  el.className = `toast ${bad ? 'bad' : ''}`;
  el.textContent = text;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3100);
  while ($('#toasts').children.length > 3) $('#toasts').firstChild.remove();
}

boot();

// Debug handle for automated UI checks.
window.__gb = { get busy() { return busy; }, get shown() { return shown; }, get queue() { return queue.length; }, get board() { return board; } };
