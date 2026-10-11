import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TILES, GROUP_COLORS } from '/shared/board.js';

// Board layout (world units): 13 x 13, corners 2 x 2, regular tiles 1 wide x 2 deep.
const HALF = 6.5;
const TOP_Y = 0.2;
const TEX = 2048;
const PX = TEX / 13;

/** Side of the board a tile sits on: 0 bottom, 1 left, 2 top, 3 right. */
const sideOf = (i) => Math.floor(i / 10);
const INWARD = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const ALONG = [[-1, 0], [0, -1], [1, 0], [0, 1]]; // direction of travel

export function tileCenter(i) {
  const s = sideOf(i), k = i % 10;
  if (k === 0) return [[5.5, 5.5], [-5.5, 5.5], [-5.5, -5.5], [5.5, -5.5]][s];
  const off = 4.5 - (k - 1) - 0.5; // 4 .. -4
  return [[off, 5.5], [-5.5, off], [-off, -5.5], [5.5, -off]][s];
}

export function tileAt(x, z) {
  if (Math.abs(x) > HALF || Math.abs(z) > HALF) return null;
  if (Math.abs(x) < 4.5 && Math.abs(z) < 4.5) return null;
  if (z > 4.5) return x > 4.5 ? 0 : x < -4.5 ? 10 : 1 + Math.floor(4.5 - x);
  if (x < -4.5) return z < -4.5 ? 20 : 11 + Math.floor(4.5 - z);
  if (z < -4.5) return x > 4.5 ? 30 : 21 + Math.floor(x + 4.5);
  return 31 + Math.floor(z + 4.5);
}

// ---------- board texture ----------
function wrapText(ctx, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

function makeBoardTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  const ctx = c.getContext('2d');
  const sep = '#ffffff', frame = '#e9eef2', ink = '#2b2f36', muted = '#8a929c';
  const font = (px, w = 900) => `${w} ${px}px "Nunito", "Trebuchet MS", "Segoe UI", Roboto, sans-serif`;
  const emoji = (ch, x, y, size) => { ctx.font = `${size}px ${EMOJI_FONT}`; ctx.fillText(ch, x, y); };
  const pill = (text, x, y, color) => {
    ctx.font = font(30);
    const w = ctx.measureText(text).width + 36;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.roundRect(x - w / 2, y - 22, w, 44, 22); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(text, x, y + 2);
  };

  ctx.fillStyle = sep;
  ctx.fillRect(0, 0, TEX, TEX);

  // center panel with a big illustration
  ctx.fillStyle = '#c8d5de';
  ctx.beginPath(); ctx.roundRect(2 * PX + 24, 2 * PX + 24, 9 * PX - 48, 9 * PX - 48, 24); ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  emoji('🏛️', TEX / 2, TEX / 2 - 60, 420);
  ctx.fillStyle = '#7f95a6';
  ctx.font = font(96);
  ctx.fillText('MONOPOLY', TEX / 2, TEX / 2 + 260);

  TILES.forEach((t, i) => {
    const [x, z] = tileCenter(i);
    const cx = (x + HALF) * PX, cy = (z + HALF) * PX;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate([0, Math.PI / 2, Math.PI, -Math.PI / 2][sideOf(i)]);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (i % 10 === 0) {
      const s = 2 * PX;
      ctx.fillStyle = '#f6f8fa';
      ctx.fillRect(-s / 2 + 4, -s / 2 + 4, s - 8, s - 8);
      if (t.type === 'jail') {
        ctx.rotate(-[0, Math.PI / 2, Math.PI, -Math.PI / 2][1]); // keep the cell on the inner corner
        const cell = 1.25 * PX;
        for (let k = 0; k < 7; k++) {
          ctx.fillStyle = k % 2 ? '#9aa6b2' : '#d7dde3';
          ctx.fillRect(s / 2 - cell + (k * cell) / 7 - 4, -s / 2 + 4, cell / 7, cell);
        }
        emoji('🔒', s / 2 - cell / 2 - 4, -s / 2 + cell / 2, 70);
        pill('JAIL', -s / 2 + 0.55 * PX, s / 2 - 0.4 * PX, '#9aa6b2');
      } else {
        ctx.rotate(Math.PI / 4);
        const [icon, label, color] = {
          go: ['⬅️', 'GO  +$200', '#2fb36b'], parking: ['🅿️', 'FREE PARKING', '#9aa6b2'], gotojail: ['👮', 'GO TO JAIL', '#e5484d'],
        }[t.type];
        emoji(icon, 0, -30, 120);
        pill(label, 0, 75, color);
      }
      ctx.restore();
      return;
    }
    const w = PX, h = 2 * PX;
    const prop = t.type === 'property';
    ctx.fillStyle = prop ? GROUP_COLORS[t.group] : frame;
    ctx.fillRect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 8);
    const dark = prop && ['yellow', 'lightblue'].includes(t.group);
    const price = t.price ? `$${t.price}` : t.amount ? `-$${t.amount}` : '';
    if (price) {
      ctx.font = font(34);
      ctx.fillStyle = prop ? (dark ? ink : '#fff') : t.type === 'tax' ? '#e5484d' : muted;
      ctx.fillText(price, 0, -h / 2 + 44);
    }
    const icon = { railroad: '🚂', chance: '❓', chest: '🎁', tax: '💰' }[t.type]
      ?? (t.type === 'utility' ? (t.name.startsWith('Electric') ? '💡' : '🚰') : '');
    if (icon) emoji(icon, 0, 10, 72);
    ctx.fillStyle = prop ? (dark ? ink : '#fff') : ink;
    ctx.font = font(prop ? 25 : 21);
    const label = { chance: 'CHANCE', chest: 'CHEST' }[t.type] ?? t.name.toUpperCase();
    const lines = wrapText(ctx, label, w - 18);
    const top = prop ? -10 : h / 2 - 30 - (lines.length - 1) * 26;
    lines.forEach((ln, k) => ctx.fillText(ln, 0, top + k * 28));
    ctx.restore();
  });
  return c;
}

// ---------- tokens ----------
function makeToken(kind, color) {
  // White puck with a colored top, like a game counter.
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
  const top = new THREE.MeshStandardMaterial({ color, roughness: 0.3, emissive: color, emissiveIntensity: 0.15 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.21, 0.14, 32), white);
  base.position.y = 0.07;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 32), top);
  cap.position.y = 0.15;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.15, 32, 12, 0, Math.PI * 2, 0, Math.PI / 5), top);
  dome.position.y = 0.04;
  base.castShadow = cap.castShadow = true;
  g.add(base, cap, dome);
  return g;
}

// ---------- dice ----------
function pipTexture(n) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fbfbf7';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = n === 1 ? '#c62828' : '#111';
  const P = { 1: [[2, 2]], 2: [[1, 1], [3, 3]], 3: [[1, 1], [2, 2], [3, 3]], 4: [[1, 1], [3, 1], [1, 3], [3, 3]],
    5: [[1, 1], [3, 1], [2, 2], [1, 3], [3, 3]], 6: [[1, 1], [3, 1], [1, 2], [3, 2], [1, 3], [3, 3]] }[n];
  for (const [x, y] of P) {
    ctx.beginPath();
    ctx.arc(x * 32, y * 32, n === 1 ? 17 : 12, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Box face order: +x, -x, +y, -y, +z, -z
const FACE_VALUES = [1, 6, 2, 5, 3, 4];
const FACE_UP = {
  1: new THREE.Euler(0, 0, Math.PI / 2),
  6: new THREE.Euler(0, 0, -Math.PI / 2),
  2: new THREE.Euler(0, 0, 0),
  5: new THREE.Euler(Math.PI, 0, 0),
  3: new THREE.Euler(-Math.PI / 2, 0, 0),
  4: new THREE.Euler(Math.PI / 2, 0, 0),
};

const ease = (t) => 1 - (1 - t) ** 3;

export class Board3D {
  constructor(container, { onTileTap } = {}) {
    this.container = container;
    this.onTileTap = onTileTap;
    this.tokens = new Map();
    this.tweens = [];
    this.buildings = new Map();
    this.markers = new Map();

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x45464c);
    scene.fog = new THREE.Fog(0x45464c, 30, 60);
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2.15;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 40;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(6, 14, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 });
    scene.add(sun);

    // table
    const table = new THREE.Mesh(new THREE.CircleGeometry(40, 48),
      new THREE.MeshStandardMaterial({ color: 0x3a3b41, roughness: 0.9 }));
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = true;
    scene.add(table);

    // board body + printed top
    const body = new THREE.Mesh(new THREE.BoxGeometry(13.4, TOP_Y, 13.4),
      new THREE.MeshStandardMaterial({ color: 0xc3ccd4, roughness: 0.6 }));
    body.position.y = TOP_Y / 2 - 0.001;
    body.castShadow = true;
    body.receiveShadow = true;
    scene.add(body);

    const tex = new THREE.CanvasTexture(makeBoardTexture());
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    this.boardTop = new THREE.Mesh(new THREE.PlaneGeometry(13, 13),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
    this.boardTop.rotation.x = -Math.PI / 2;
    this.boardTop.position.y = TOP_Y + 0.001;
    this.boardTop.receiveShadow = true;
    scene.add(this.boardTop);

    // highlight under the active tile
    this.highlight = new THREE.Mesh(new THREE.PlaneGeometry(1, 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false }));
    this.highlight.rotation.x = -Math.PI / 2;
    this.highlight.position.y = TOP_Y + 0.004;
    this.highlight.visible = false;
    scene.add(this.highlight);

    // dice
    const dieMats = FACE_VALUES.map((v) => new THREE.MeshStandardMaterial({ map: pipTexture(v), roughness: 0.35 }));
    this.dice = [0, 1].map((k) => {
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), dieMats);
      d.castShadow = true;
      d.position.set(k ? 0.5 : -0.5, TOP_Y + 0.3, 1.2);
      scene.add(d);
      return d;
    });
    this.setDiceFaces([5, 2], 0);

    // tap to inspect a tile
    const ray = new THREE.Raycaster();
    let down = null;
    renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 8) return;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
      const hit = ray.intersectObject(this.boardTop)[0];
      if (hit) {
        const i = tileAt(hit.point.x, hit.point.z);
        if (i != null) this.onTileTap?.(i);
      }
    });

    this.resize();
    this.resetView();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.clock = new THREE.Clock();
    renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  resetView() {
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const fit = 7.6 / t / Math.min(1, this.camera.aspect);
    const dir = new THREE.Vector3(0, 1, 0.62).normalize();
    this.camera.position.copy(dir.multiplyScalar(fit));
    this.controls.target.set(0, 0, 0.4);
    this.controls.update();
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    for (const tw of this.tweens) tw.done();
    this.tweens = [];
    this.resizeObs.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  frame() {
    const now = performance.now();
    this.tweens = this.tweens.filter((tw) => {
      const k = Math.min(1, (now - tw.start) / tw.dur);
      tw.fn(k);
      if (k >= 1) { tw.done(); return false; }
      return true;
    });
    const t = this.clock.getElapsedTime();
    for (const tok of this.tokens.values()) {
      tok.mesh.scale.setScalar(tok.active ? 1.15 + 0.1 * Math.sin(t * 5) : 1.1);
    }
    if (this.highlight.visible) this.highlight.material.opacity = 0.18 + 0.12 * Math.sin(t * 4);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  tween(dur, fn) {
    if (this.disposed) return Promise.resolve();
    return new Promise((done) => this.tweens.push({ start: performance.now(), dur, fn, done }));
  }

  // ---------- tokens ----------
  slotPosition(i, slot, inJail) {
    const [cx, cz] = tileCenter(i);
    if (i === 10) {
      if (inJail) {
        const col = slot % 3, row = Math.floor(slot / 3);
        return [-5.55 + col * 0.4, 4.8 + row * 0.55];
      }
      const spots = [[-6.15, 4.75], [-6.15, 5.25], [-6.15, 5.75], [-6.15, 6.18], [-5.6, 6.18], [-5.05, 6.18]];
      return spots[slot];
    }
    if (i % 10 === 0) {
      const col = slot % 3, row = Math.floor(slot / 3);
      return [cx - 0.4 + col * 0.4, cz - 0.2 + row * 0.45];
    }
    const s = sideOf(i);
    const [ix, iz] = INWARD[s], [ax, az] = ALONG[s];
    const col = slot % 2 ? 0.2 : -0.2, row = [-0.65, -0.2, 0.25][Math.floor(slot / 2)];
    return [cx + ax * col + ix * row, cz + az * col + iz * row];
  }

  ensureTokens(players) {
    players.forEach((p, slot) => {
      if (this.tokens.has(p.id)) return;
      const mesh = makeToken(p.token, p.color);
      mesh.scale.setScalar(1.1);
      this.scene.add(mesh);
      this.tokens.set(p.id, { mesh, slot, pos: p.pos, inJail: p.inJail });
      this.placeToken(p.id, p.pos, p.inJail);
    });
  }

  placeToken(id, pos, inJail) {
    const tok = this.tokens.get(id);
    const [x, z] = this.slotPosition(pos, tok.slot, inJail);
    tok.mesh.position.set(x, TOP_Y, z);
    tok.pos = pos;
    tok.inJail = inJail;
  }

  async hop(tok, to, inJail = false, height = 0.5, dur = 170) {
    const from = tok.mesh.position.clone();
    const [x, z] = this.slotPosition(to, tok.slot, inJail);
    await this.tween(dur, (k) => {
      tok.mesh.position.set(from.x + (x - from.x) * k, TOP_Y + Math.sin(k * Math.PI) * height, from.z + (z - from.z) * k);
    });
    tok.pos = to;
    tok.inJail = inJail;
  }

  async animateMove(id, from, to, kind) {
    const tok = this.tokens.get(id);
    if (!tok) return;
    if (kind === 'jump') {
      await this.hop(tok, to, to === 10, 2.5, 700);
      return;
    }
    const step = kind === 'back' ? -1 : 1;
    let p = from;
    const steps = (((to - from) * step) % 40 + 40) % 40;
    const dur = steps > 12 ? 110 : 170;
    for (let n = 0; n < steps; n++) {
      p = (p + step + 40) % 40;
      await this.hop(tok, p, false, 0.45, dur);
    }
  }

  // ---------- dice ----------
  setDiceFaces(values, spinY = 0) {
    values.forEach((v, k) => {
      const q = new THREE.Quaternion().setFromEuler(FACE_UP[v]);
      const y = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spinY + k * 0.4);
      this.dice[k].quaternion.copy(y.multiply(q));
    });
  }

  async rollDice(values) {
    const starts = this.dice.map((d) => d.position.clone());
    const targets = values.map((v, k) => {
      const y = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
      return y.multiply(new THREE.Quaternion().setFromEuler(FACE_UP[v]));
    });
    const ends = [new THREE.Vector3(-0.5 + Math.random() * 0.3, 0, 0.8 + Math.random() * 0.8),
      new THREE.Vector3(0.6 + Math.random() * 0.3, 0, 0.8 + Math.random() * 0.8)];
    const spins = this.dice.map(() => new THREE.Vector3(Math.random() * 20 + 10, Math.random() * 10, Math.random() * 20 + 10));
    await this.tween(1100, (k) => {
      const e = ease(k);
      this.dice.forEach((d, i) => {
        const s = starts[i], t = ends[i];
        const bounce = Math.abs(Math.sin(k * Math.PI * 3)) * (1 - k) * 2.2;
        d.position.set(s.x + (t.x - s.x) * e, TOP_Y + 0.3 + bounce, s.z + (t.z - s.z) * e);
        if (k < 0.75) {
          d.rotation.set(spins[i].x * k, spins[i].y * k, spins[i].z * k);
        } else {
          const from = new THREE.Quaternion().setFromEuler(new THREE.Euler(spins[i].x * 0.75, spins[i].y * 0.75, spins[i].z * 0.75));
          d.quaternion.slerpQuaternions(from, targets[i], ease((k - 0.75) / 0.25));
        }
      });
    });
  }

  // ---------- board state ----------
  sync(state, { tokens = true } = {}) {
    this.ensureTokens(state.players);
    state.players.forEach((p, idx) => {
      const tok = this.tokens.get(p.id);
      tok.mesh.visible = !p.bankrupt;
      tok.active = idx === state.turn && state.phase !== 'over';
      if (tokens && (tok.pos !== p.pos || tok.inJail !== p.inJail)) this.placeToken(p.id, p.pos, p.inJail);
    });
    const colorOf = Object.fromEntries(state.players.map((p) => [p.id, p.color]));
    for (const [k, pr] of Object.entries(state.props)) this.syncProp(Number(k), pr, colorOf[pr.owner]);
    if (tokens) this.highlightTile(state.phase === 'over' ? null : state.players[state.turn]?.pos);
  }

  highlightTile(i) {
    if (i == null) { this.highlight.visible = false; return; }
    const [x, z] = tileCenter(i);
    const corner = i % 10 === 0;
    this.highlight.scale.set(corner ? 2 : 1, corner ? 1 : 2, 1);
    this.highlight.rotation.z = corner ? 0 : [0, Math.PI / 2, 0, Math.PI / 2][sideOf(i)];
    this.highlight.position.set(x, TOP_Y + 0.004, z);
    this.highlight.visible = true;
  }

  syncProp(i, pr, ownerColor) {
    const key = `${pr.owner}|${pr.houses}|${pr.mortgaged}`;
    if (this.markers.get(i)?.key === key) return;
    const old = this.markers.get(i);
    if (old) this.scene.remove(old.group);
    const group = new THREE.Group();
    const s = sideOf(i);
    const [cx, cz] = tileCenter(i);
    const [ix, iz] = INWARD[s], [ax, az] = ALONG[s];
    const rotY = [0, -Math.PI / 2, Math.PI, Math.PI / 2][s];

    if (pr.owner) {
      // owner strip along the outer edge of the tile
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.14),
        new THREE.MeshStandardMaterial({ color: ownerColor, emissive: ownerColor, emissiveIntensity: 0.25 }));
      strip.position.set(cx - ix * 0.88, TOP_Y + 0.025, cz - iz * 0.88);
      strip.rotation.y = rotY;
      group.add(strip);
    }
    if (pr.mortgaged) {
      const shade = new THREE.Mesh(new THREE.PlaneGeometry(1, 2),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
      shade.rotation.x = -Math.PI / 2;
      shade.rotation.z = [0, Math.PI / 2, 0, Math.PI / 2][s];
      shade.position.set(cx, TOP_Y + 0.006, cz);
      group.add(shade);
    }
    const bx = cx + ix * 0.775, bz = cz + iz * 0.775; // center of the color band
    if (pr.houses === 5) {
      const hotel = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.3),
        new THREE.MeshStandardMaterial({ color: 0xd32f2f, roughness: 0.5 }));
      hotel.position.set(bx, TOP_Y + 0.125, bz);
      hotel.rotation.y = rotY;
      hotel.castShadow = true;
      group.add(hotel);
    } else {
      for (let h = 0; h < pr.houses; h++) {
        const off = -0.33 + h * 0.22;
        const house = new THREE.Group();
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.13, 0.16),
          new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.5 }));
        base.position.y = 0.065;
        const roof = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.1, 4),
          new THREE.MeshStandardMaterial({ color: 0x1b5e20, roughness: 0.5 }));
        roof.position.y = 0.18;
        roof.rotation.y = Math.PI / 4;
        base.castShadow = roof.castShadow = true;
        house.add(base, roof);
        house.position.set(bx + ax * off, TOP_Y, bz + az * off);
        house.rotation.y = rotY;
        group.add(house);
      }
    }
    this.scene.add(group);
    this.markers.set(i, { key, group });
  }

  focusTile(i) {
    const [x, z] = tileCenter(i);
    const target = new THREE.Vector3(x * 0.5, 0, z * 0.5);
    const startT = this.controls.target.clone();
    this.tween(500, (k) => this.controls.target.lerpVectors(startT, target, ease(k)));
  }
}
