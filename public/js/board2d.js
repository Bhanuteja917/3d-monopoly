import { TILES, GROUPS, GROUP_COLORS, RAILROADS, UTILITIES } from '/shared/board.js';

// Board layout in board units: 9 regular tiles per side (1 unit each) between 1.6-unit corners.
const C = 1.6;
const SIZE = 9 + 2 * C;
const FAR = SIZE - C;

/** Side of the board a tile sits on: 0 bottom, 1 left, 2 top, 3 right. */
const sideOf = (i) => Math.floor(i / 10);

/** Tile rectangle [x, y, w, h] in board units. GO is bottom-right; play runs clockwise. */
function tileRect(i) {
  const k = i % 10;
  if (k === 0) return [[FAR, FAR], [0, FAR], [0, 0], [FAR, 0]][sideOf(i)].concat([C, C]);
  switch (sideOf(i)) {
    case 0: return [C + 9 - k, FAR, 1, C];
    case 1: return [0, C + 9 - k, C, 1];
    case 2: return [C + k - 1, 0, 1, C];
    default: return [FAR, C + k - 1, C, 1];
  }
}

// Short labels that fit narrow tiles on a phone; the full name is on the title deed.
const SHORT = {
  1: 'Medit.', 9: 'Conn.', 11: 'St. Charles', 15: 'Penn. RR', 16: 'St. James', 18: 'Tenn.', 25: 'B&O',
  28: 'Water', 29: 'Marvin', 32: 'N. Carolina', 34: 'Penn. Ave', 37: 'Park Place',
};
const shortName = (t, i) => SHORT[i] ?? t.name.replace(/ (Avenue|Railroad|Company)$/, '');

/** Rent shown on an owned tile's tag, e.g. "$50" or "4×" for utilities. */
export function rentLabel(state, i) {
  const t = TILES[i], pr = state.props[i];
  if (pr.mortgaged) return 'M';
  if (t.type === 'property') {
    if (pr.houses) return `$${t.rent[pr.houses]}`;
    const set = GROUPS[t.group].every((j) => state.props[j].owner === pr.owner);
    return `$${t.rent[0] * (set ? 2 : 1)}`;
  }
  if (t.type === 'railroad') return `$${25 * 2 ** (RAILROADS.filter((r) => state.props[r].owner === pr.owner).length - 1)}`;
  return UTILITIES.every((u) => state.props[u].owner === pr.owner) ? '10×' : '4×';
}

// Jail corner: the cell is the inner square, "just visiting" is the outer L.
const JAIL_CELL = [[0.95, 11.0], [1.3, 11.0], [0.95, 11.3], [1.3, 11.3], [0.95, 10.75], [1.3, 10.75]];
const VISITING = [[0.3, 10.85], [0.3, 11.27], [0.3, 11.69], [0.68, 11.92], [1.04, 11.92], [1.4, 11.92]];

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const pipHTML = (n) => Array.from({ length: 9 }, (_, k) => `<i class="${PIPS[n].includes(k) ? 'on' : ''}"></i>`).join('');

function tileHTML(t, i) {
  if (i % 10 === 0) {
    const body = t.type === 'jail'
      ? '<div class="cell"><span>🔒</span></div><span class="pill">JAIL</span>'
      : {
        go: '<span class="ico">⬅️</span><span class="pill">GO</span><small>+$200</small>',
        parking: '<span class="ico">🅿️</span><span class="pill">PARKING</span>',
        gotojail: '<span class="ico">👮</span><span class="pill">GO TO JAIL</span>',
      }[t.type];
    return `<div class="tile corner ${t.type}" data-i="${i}">${body}</div>`;
  }
  const icon = { railroad: '🚂', chance: '❓', chest: '🎁', tax: '💰' }[t.type]
    ?? (t.type === 'utility' ? (t.name.startsWith('Electric') ? '💡' : '🚰') : '');
  const tag = t.price ? `$${t.price}` : t.amount ? `-$${t.amount}` : '';
  const name = t.type === 'property' ? shortName(t, i) : { chance: 'Chance', chest: 'Chest', tax: shortName(t, i) }[t.type] ?? '';
  const color = t.type === 'property' ? ` style="--g:${GROUP_COLORS[t.group]}"` : '';
  return `<div class="tile ${t.type} ${t.group ?? ''}" data-i="${i}"${color}>
    ${tag ? `<span class="ptag">${tag}</span>` : ''}
    ${icon ? `<span class="ico">${icon}</span>` : ''}
    ${name ? `<span class="name">${name}</span>` : ''}
    ${t.type === 'property' ? '<span class="bld"></span>' : ''}
  </div>`;
}

export class Board2D {
  /**
   * @param {HTMLElement} container
   * @param {{onTileTap?: (i:number) => void, layouts?: () => Array<{top:number,right:number,bottom:number,left:number}>}} opts
   *   layouts returns candidate insets; the one that gives the largest board wins.
   */
  constructor(container, { onTileTap, layouts } = {}) {
    this.container = container;
    this.layouts = layouts ?? (() => [{ top: 0, right: 0, bottom: 0, left: 0 }]);
    this.tokens = new Map();
    this.tweens = [];
    this.propKeys = new Map();
    this.unit = 1;

    const root = document.createElement('div');
    root.className = 'b2d';
    root.innerHTML = `<div class="b2d-board">
      ${TILES.map(tileHTML).join('')}
      <div class="b2d-center">
        <div class="b2d-bubble"><span class="txt">Roll the dice to start!</span></div>
        <div class="b2d-art">🏛️</div>
        <div class="b2d-dice"><div class="die"></div><div class="die"></div></div>
      </div>
      <div class="b2d-tokens"></div>
    </div>`;
    container.appendChild(root);
    this.root = root;
    this.board = root.querySelector('.b2d-board');
    this.tokenLayer = root.querySelector('.b2d-tokens');
    this.bubble = root.querySelector('.b2d-bubble');
    this.art = root.querySelector('.b2d-art');
    this.dice = [...root.querySelectorAll('.die')];
    this.tiles = [...root.querySelectorAll('.tile')];
    this.tiles.forEach((el) => {
      const [x, y, w, h] = tileRect(Number(el.dataset.i));
      Object.assign(el.style, { left: `calc(var(--u) * ${x})`, top: `calc(var(--u) * ${y})`, width: `calc(var(--u) * ${w})`, height: `calc(var(--u) * ${h})` });
    });
    this.board.addEventListener('click', (e) => {
      const el = e.target.closest('.tile');
      if (el) onTileTap?.(Number(el.dataset.i));
    });

    this.setDiceFaces([5, 2]);
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
  }

  resize() {
    const W = this.container.clientWidth, H = this.container.clientHeight;
    if (!W || !H) return;
    let best = null;
    for (const l of this.layouts()) {
      const size = Math.min(W - l.left - l.right, H - l.top - l.bottom);
      if (!best || size > best.size) best = { size, l };
    }
    const { l } = best;
    const size = Math.max(160, Math.floor(best.size));
    const left = l.left + Math.max(0, (W - l.left - l.right - size) / 2);
    const top = l.top + Math.max(0, (H - l.top - l.bottom - size) / 2);
    Object.assign(this.board.style, { width: `${size}px`, height: `${size}px`, left: `${left}px`, top: `${top}px` });
    this.unit = size / SIZE;
    this.board.style.setProperty('--u', `${this.unit}px`);
    this.board.classList.toggle('compact', this.unit < 26); // too small for names: show tags only
    for (const tok of this.tokens.values()) this.draw(tok);
    this.fitNames();
  }

  /** Shrink tile names that don't fit their tile (long single words like "ATLANTIC"). */
  fitNames() {
    for (const el of this.board.querySelectorAll('.name')) {
      el.style.fontSize = '';
      let px = parseFloat(getComputedStyle(el).fontSize);
      while (px > 4.5 && el.scrollWidth > el.clientWidth + 0.5) {
        px -= 0.5;
        el.style.fontSize = `${px}px`;
      }
    }
  }

  resetView() {}

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const tw of this.tweens) tw.done();
    this.tweens = [];
    this.resizeObs.disconnect();
    this.root.remove();
  }

  tween(dur, fn) {
    if (this.disposed) return Promise.resolve();
    return new Promise((done) => {
      this.tweens.push({ start: performance.now(), dur, fn, done });
      if (this.tweens.length === 1) this.raf = requestAnimationFrame(() => this.frame());
    });
  }

  frame() {
    const now = performance.now();
    this.tweens = this.tweens.filter((tw) => {
      const k = Math.min(1, (now - tw.start) / tw.dur);
      tw.fn(k);
      if (k >= 1) { tw.done(); return false; }
      return true;
    });
    if (this.tweens.length) this.raf = requestAnimationFrame(() => this.frame());
  }

  /** Speech bubble in the middle of the board, like "You paid $70 rent to Sam". */
  showNotice({ html, icon }) {
    this.bubble.querySelector('.txt').innerHTML = html;
    this.art.textContent = icon || '🏛️';
    for (const el of [this.bubble, this.art]) {
      el.classList.remove('pop');
      void el.offsetWidth; // restart the animation
      el.classList.add('pop');
    }
  }

  // ---------- tokens ----------
  slotPosition(i, slot, inJail) {
    if (i === 10) return (inJail ? JAIL_CELL : VISITING)[slot];
    const [x, y, w, h] = tileRect(i);
    const cx = x + w / 2, cy = y + h / 2;
    if (i % 10 === 0) {
      const col = slot % 3, row = Math.floor(slot / 3);
      return [cx + (col - 1) * 0.42, cy + (row - 0.5) * 0.46];
    }
    const wide = w > h;
    const cols = wide ? 3 : 2, rows = wide ? 2 : 3;
    const col = slot % cols, row = Math.floor(slot / cols);
    return [cx + (col - (cols - 1) / 2) * 0.38, cy + 0.08 + (row - (rows - 1) / 2) * 0.36];
  }

  ensureTokens(players) {
    players.forEach((p, slot) => {
      if (this.tokens.has(p.id)) return;
      const el = document.createElement('div');
      el.className = 'tok';
      el.style.setProperty('--c', p.color);
      this.tokenLayer.appendChild(el);
      const tok = { el, slot, pos: p.pos, inJail: p.inJail, x: 0, y: 0, lift: 0 };
      this.tokens.set(p.id, tok);
      this.placeToken(tok, p.pos, p.inJail);
    });
  }

  placeToken(tok, pos, inJail) {
    [tok.x, tok.y] = this.slotPosition(pos, tok.slot, inJail);
    tok.pos = pos;
    tok.inJail = inJail;
    tok.lift = 0;
    tok.el.classList.toggle('jailed', inJail);
    this.draw(tok);
  }

  draw(tok) {
    const u = this.unit;
    tok.el.style.transform = `translate(${tok.x * u}px, ${(tok.y - tok.lift) * u}px) translate(-50%, -50%) scale(${1 + tok.lift * 0.5})`;
  }

  async hop(tok, to, inJail = false, height = 0.35, dur = 150) {
    const fx = tok.x, fy = tok.y;
    const [x, y] = this.slotPosition(to, tok.slot, inJail);
    tok.el.classList.toggle('jailed', inJail);
    await this.tween(dur, (k) => {
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      tok.x = fx + (x - fx) * e;
      tok.y = fy + (y - fy) * e;
      tok.lift = Math.sin(k * Math.PI) * height;
      this.draw(tok);
    });
    tok.pos = to;
    tok.inJail = inJail;
  }

  async animateMove(id, from, to, kind) {
    const tok = this.tokens.get(id);
    if (!tok) return;
    tok.el.classList.add('moving');
    try {
      if (kind === 'jump') {
        await this.hop(tok, to, to === 10, 1.2, 650);
        return;
      }
      const step = kind === 'back' ? -1 : 1;
      const steps = (((to - from) * step) % 40 + 40) % 40;
      const dur = steps > 12 ? 95 : 150;
      let p = from;
      for (let n = 0; n < steps; n++) {
        p = (p + step + 40) % 40;
        await this.hop(tok, p, false, 0.35, dur);
      }
    } finally {
      tok.el.classList.remove('moving');
    }
  }

  // ---------- dice ----------
  setDiceFaces(values) {
    values.forEach((v, k) => { this.dice[k].innerHTML = pipHTML(v); });
  }

  async rollDice(values) {
    this.dice.forEach((d) => d.classList.add('rolling'));
    let last = 0;
    await this.tween(750, (k) => {
      const tick = Math.floor(k * 10);
      if (tick !== last && k < 1) {
        last = tick;
        this.setDiceFaces([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]);
      }
    });
    this.setDiceFaces(values);
    this.dice.forEach((d) => d.classList.remove('rolling'));
    await this.tween(200, () => {});
  }

  // ---------- board state ----------
  sync(state, { tokens = true } = {}) {
    this.ensureTokens(state.players);
    state.players.forEach((p, idx) => {
      const tok = this.tokens.get(p.id);
      tok.el.classList.toggle('hidden', p.bankrupt);
      tok.el.classList.toggle('active', idx === state.turn && state.phase !== 'over');
      if (tokens && (tok.pos !== p.pos || tok.inJail !== p.inJail)) this.placeToken(tok, p.pos, p.inJail);
    });
    const byId = Object.fromEntries(state.players.map((p) => [p.id, p]));
    for (const [k, pr] of Object.entries(state.props)) this.syncProp(state, Number(k), pr, byId[pr.owner]);
    if (tokens) {
      const here = state.phase === 'over' ? null : state.players[state.turn]?.pos;
      this.tiles.forEach((el, i) => el.classList.toggle('here', i === here));
    }
  }

  syncProp(state, i, pr, owner) {
    const label = owner ? rentLabel(state, i) : `$${TILES[i].price}`;
    const key = `${pr.owner}|${pr.houses}|${pr.mortgaged}|${label}`;
    if (this.propKeys.get(i) === key) return;
    this.propKeys.set(i, key);
    const el = this.tiles[i];
    el.classList.toggle('owned', !!owner);
    el.classList.toggle('mortgaged', pr.mortgaged);
    if (owner) el.style.setProperty('--owner', owner.color);
    else el.style.removeProperty('--owner');
    el.querySelector('.ptag').textContent = label;
    const bld = el.querySelector('.bld');
    if (bld) bld.innerHTML = pr.houses === 5 ? '<i class="hotel"></i>' : '<i class="house"></i>'.repeat(pr.houses);
  }
}
