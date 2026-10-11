// 2.5D board renderer: circuit-shaped board, fixed-angle camera with pinch/pan, token animations.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createBuilding, createTree, part, toon } from './models.js';
import { drawCard, drawCornerPad } from './cards.js';
import { cardModel, landmarkUrl, CORNER_PADS, INK } from '/shared/cards.js';
import { createToken } from './characters.js';
import { buildGolfCourse } from './golf.js';
import { buildIsland, SAND_Y } from './island.js';
import { buildResort } from './resort.js';
import { buildHarbour } from './harbour.js';
import { buildTrack, placeLandmarks, pointInPolygon, convexHull, distToPolyline, TILE_W, TILE_D, CORNER_LEN } from './track.js';
import { REGIONS } from '/shared/content.js';

const W = TILE_W; // tile length along the track
const D = TILE_D; // tile depth across the track
const ISLAND_MARGIN = 5.2; // first guess at the board box; setup() replaces it with the island plus SEA_RING
const CORNER_R = CORNER_LEN * 0.5; // corner pad radius
const BEACH_Y = SAND_Y; // top of the sand around the board
const SEA_RING = 4; // strip of sea the camera shows around the island (the harbour)
const PITCH = 0.98; // fixed camera tilt (radians from horizontal)
const FOV = 38;
const MAX_ZOOM_MS = 1500; // FR-183
const HOP_MS = 400; // every hop from one space to the next takes the same time, so moves are easy to follow

// Phones held upright show the whole app turned a quarter turn clockwise (style.css), so screen points
// are mapped back into the app's own frame: its x runs down the screen and its y runs right to left.
const TURNED = typeof matchMedia === 'function' ? matchMedia('(orientation: portrait) and (max-width: 500px)') : { matches: false };
const appPoint = (e) => (TURNED.matches ? { x: e.clientY, y: -e.clientX } : { x: e.clientX, y: e.clientY });

const regionOf = (id) => REGIONS.find((r) => r.id === id);
const fmt = (n) => n.toLocaleString('en-IN');
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

// Landmark beside a tile: the same art as the card's art panel, standing as a camera-facing cut-out
// (like the characters) so the figure by the tile always matches the card.
const LM_ART_W = 260, LM_ART_H = 232, LM_FOOT_Y = 223; // card art size and the bottom of its paving pad
const LM_WIDTH = 6.5; // board units at full landmark scale (about 2.2 cards wide)
const LM_LIFT = 0.12; // fraction of the height lifted so the leaning cut-out clears the sand
const lmTextures = new Map();
function landmarkCutout(lm, width) {
  let tex = lmTextures.get(lm);
  if (!tex) {
    const canvas = document.createElement('canvas');
    canvas.width = LM_ART_W * 2;
    canvas.height = LM_ART_H * 2;
    tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const img = new Image();
    img.onload = () => { canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height); tex.needsUpdate = true; };
    img.src = landmarkUrl(lm);
    lmTextures.set(lm, tex);
  }
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.08 }));
  sprite.scale.set(width, (width * LM_ART_H) / LM_ART_W, 1);
  sprite.center.set(0.5, 1 - LM_FOOT_Y / LM_ART_H);
  sprite.position.y = sprite.scale.y * LM_LIFT;
  const g = new THREE.Group(); // scaled as a whole when the landmark rises
  g.add(sprite);
  return g;
}

export class Board {
  constructor(container, { onTileTap } = {}) {
    this.container = container;
    this.onTileTap = onTileTap;
    // Camera: a close "play" view that follows the pawns, or the whole board. Players can always pinch/drag.
    this.inOverview = true;
    this.userPlayDist = null; // zoom the player last chose while playing
    this.hasFocused = false;
    this.follow = null; // when set, only this player's pawn is followed (null: whoever moves)
    this.onViewChange = null;
    this.tweens = [];
    this.skipping = false;
    this.tokens = new Map();
    this.tiles = [];
    this.layoutKey = null;

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#5fd0f5');
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 400);
    this.cam = { target: new THREE.Vector3(), dist: 40 };

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8fb6d9, 1.5));
    const sun = (this.sun = new THREE.DirectionalLight(0xfff4e0, 2.3));
    sun.position.set(-18, 40, 22);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun, sun.target);

    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.overlay = document.createElement('div');
    this.overlay.className = 'board-overlay';
    container.appendChild(this.overlay);

    this.raycaster = new THREE.Raycaster();
    this.clock = new THREE.Clock();
    this.bindInput();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
    r.setAnimationLoop(() => this.frame());
  }

  // ---------- Layout ----------
  layout(kinds) {
    const track = buildTrack(kinds);
    const lms = placeLandmarks(track, { width: LM_WIDTH, height: (LM_WIDTH * LM_FOOT_Y) / LM_ART_W, pitch: PITCH });
    const spots = track.spots.map((s, i) => {
      const u = new THREE.Vector3(s.ux, 0, s.uz);
      const inward = new THREE.Vector3(s.nx, 0, s.nz);
      return { kind: s.kind, pos: new THREE.Vector3(s.x, 0, s.z), rotY: Math.atan2(-u.z, u.x), u, inward, landmark: lms[i] };
    });
    const { minX, maxX, minZ, maxZ } = track.bbox;
    const m = ISLAND_MARGIN;
    const bounds = { minX: minX - m, maxX: maxX + m, minZ: minZ - m, maxZ: maxZ + m };
    for (const l of lms) { // sand under and behind every landmark
      if (!l) continue;
      bounds.minX = Math.min(bounds.minX, l.rect.x0 - 1); bounds.maxX = Math.max(bounds.maxX, l.rect.x1 + 1);
      bounds.minZ = Math.min(bounds.minZ, l.rect.z0 - 1); bounds.maxZ = Math.max(bounds.maxZ, l.rect.z1 + 1.5);
    }
    bounds.cx = (bounds.minX + bounds.maxX) / 2;
    bounds.cz = (bounds.minZ + bounds.maxZ) / 2;
    bounds.hw = (bounds.maxX - bounds.minX) / 2;
    bounds.hd = (bounds.maxZ - bounds.minZ) / 2;
    return { spots, track, bounds };
  }

  setup(state) {
    const key = state.spaces.map((s) => `${s.region}:${s.corner || s.kind}`).join('|');
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    this.world.clear();
    this.tokens.clear();
    this.tiles = [];
    this.decor = [];
    const { spots, track, bounds } = (this.geo = this.layout(state.spaces.map((sp) => (sp.kind === 'corner' ? 'corner' : 'tile'))));
    this.bounds = bounds;
    const S = track.samples;
    const shapeOf = (pts) => new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));

    // Island shaped like the map, with the animated sea around it. The land fills the board's outline
    // (its convex hull), so the gap between the track's arms is solid ground too. The camera shows the
    // island plus one strip of sea: the harbour.
    const hull = convexHull(S);
    const onGrass = (x, z) => pointInPolygon(x, z, hull);
    const island = buildIsland({ samples: S, land: hull, trackHalf: TILE_D / 2, landmarks: spots.map((sp) => sp.landmark) });
    this.world.add(island.group);
    this.island = island;
    const ib = island.bounds;
    Object.assign(bounds, { minX: ib.minX - SEA_RING, maxX: ib.maxX + SEA_RING, minZ: ib.minZ - SEA_RING, maxZ: ib.maxZ + SEA_RING });
    bounds.cx = (bounds.minX + bounds.maxX) / 2;
    bounds.cz = (bounds.minZ + bounds.maxZ) / 2;
    bounds.hw = (bounds.maxX - bounds.minX) / 2;
    bounds.hd = (bounds.maxZ - bounds.minZ) / 2;
    const harbour = buildHarbour(island, bounds);
    this.world.add(harbour.group);
    this.decor.push(...harbour.decor);

    // Grass over the whole land: inside the circuit and across the gap between its arms
    const infield = new THREE.Mesh(new THREE.ExtrudeGeometry(shapeOf(hull), { depth: 0.12, bevelEnabled: false }), toon('#8fd16a'));
    infield.rotation.x = -Math.PI / 2;
    infield.position.y = -0.24;
    infield.receiveShadow = true;
    this.world.add(infield);

    // Keep-out zones for scenery: the track itself and every landmark.
    const lmPoints = spots.filter((s) => s.landmark).map((s) => s.landmark);
    const clearance = (x, z) => {
      let d = distToPolyline(x, z, S, 2) - TILE_D / 2;
      for (const l of lmPoints) d = Math.min(d, Math.hypot(l.x - x, l.z - z) - l.r);
      return d;
    };
    const taken = [];
    const free = (x, z, r) => clearance(x, z) > r && taken.every((t) => Math.hypot(t.x - x, t.z - z) > t.r + r);

    // Middle of the board: seven-star hotel, F1 circuit in one arm, golf course in the other.
    const resort = buildResort(S, clearance);
    this.resort = resort;
    this.world.add(resort.group);
    this.decor.push(...resort.decor);
    taken.push(...resort.keepOut);
    const golf = buildGolfCourse(S, resort.golfClearance);
    this.world.add(golf.group);
    this.decor.push(...golf.decor);
    taken.push(...golf.keepOut);

    let seed = 17;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

    // Gardens in the gap between the track's arms (Monaco casino-square style): round flower beds,
    // clipped topiary and palms, laid out on a loose grid.
    const inBay = (x, z) => onGrass(x, z) && !pointInPolygon(x, z, S);
    const FLOWERS = ['#ff5c8a', '#ffd23f', '#ff8c42', '#c77dff', '#ffffff', '#ef233c'];
    let k = 0;
    for (let x = bounds.minX; x <= bounds.maxX; x += 2.4) for (let z = bounds.minZ; z <= bounds.maxZ; z += 2.4) {
      const px = x + (rand() - 0.5) * 0.6, pz = z + (rand() - 0.5) * 0.6;
      if (!inBay(px, pz) || !free(px, pz, 0.8)) continue;
      const g = new THREE.Group();
      g.position.set(px, -0.12, pz);
      const kind = k++ % 3;
      if (kind === 0) { // flower bed: a low hedge ring around soil packed with blooms
        const r = 0.85;
        g.add(part(new THREE.CylinderGeometry(r, r, 0.2, 20), '#3f8f3a', { outline: 0.02 }));
        const soil = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.82, r * 0.82, 0.22, 20), toon('#6b4226'));
        g.add(soil);
        const c1 = FLOWERS[Math.floor(rand() * FLOWERS.length)], c2 = FLOWERS[Math.floor(rand() * FLOWERS.length)];
        for (let f = 0; f < 16; f++) {
          const a = f * 2.4, d = Math.sqrt((f + 0.5) / 16) * r * 0.72;
          const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 5), toon(d < r * 0.4 ? c1 : c2));
          bloom.position.set(Math.cos(a) * d, 0.16, Math.sin(a) * d);
          g.add(bloom);
        }
      } else if (kind === 1) { // topiary: clipped cone and ball on a planter
        g.add(part(new RoundedBoxGeometry(0.6, 0.35, 0.6, 2, 0.06), '#e8e1d3', { outline: 0.02 }));
        const cone = part(new THREE.ConeGeometry(0.35, 1.1, 10), '#2f7d32', { outline: 0.02 });
        cone.position.y = 0.72;
        g.add(cone);
        const ball = part(new THREE.SphereGeometry(0.22, 10, 8), '#3a9440', { outline: 0.02 });
        ball.position.y = 1.4;
        g.add(ball);
      } else {
        const t = createTree('palm');
        t.scale.setScalar(1 + rand() * 0.4);
        g.add(t);
      }
      this.world.add(g);
      taken.push({ x: px, z: pz, r: 0.9 });
    }

    // Trees: infield trees match the nearest region; palms dot the beach.
    const nearestRegion = (x, z) => {
      let bestS = spots[0], bd = Infinity;
      for (const sp of spots) { const d = Math.hypot(sp.pos.x - x, sp.pos.z - z); if (d < bd) { bd = d; bestS = sp; } }
      return state.spaces[spots.indexOf(bestS)].region;
    };
    let trees = 0;
    for (let x = bounds.minX + 0.8; x <= bounds.maxX - 0.8; x += 2.3) for (let z = bounds.minZ + 0.8; z <= bounds.maxZ - 0.8; z += 2.3) {
      if (trees > 95) break;
      const px = x + (rand() - 0.5) * 1.6, pz = z + (rand() - 0.5) * 1.6;
      const inside = onGrass(px, pz);
      if (!inside && (rand() > 0.35 || !island.isLand(px, pz) || !island.isLand(px + 0.8, pz) || !island.isLand(px - 0.8, pz))) continue;
      if (!free(px, pz, inside ? 0.9 : 0.7)) continue;
      const rid = nearestRegion(px, pz);
      const kind = !inside ? 'palm' : ['SEA', 'ANZ', 'SA'].includes(rid) ? 'palm' : ['EU', 'NA', 'UKI'].includes(rid) ? 'pine' : 'round';
      const t = createTree(kind);
      t.position.set(px, inside ? -0.12 : BEACH_Y, pz);
      t.scale.setScalar(0.9 + rand() * 0.5);
      this.world.add(t);
      taken.push({ x: px, z: pz, r: 0.6 });
      trees++;
    }

    // Spaces
    state.spaces.forEach((sp, i) => {
      const spot = spots[i];
      const g = new THREE.Group();
      g.position.copy(spot.pos);
      g.rotation.y = spot.rotY;
      this.world.add(g);
      const entry = { i, group: g, spot, steps: 0, owner: null, buildingObj: null };
      // Region-coloured ribbon under the track groups each region's nine spaces.
      const ribbonColor = regionOf(sp.region).ground;
      const ribbon = sp.kind === 'corner'
        ? new THREE.Mesh(new THREE.CylinderGeometry(CORNER_R + 0.6, CORNER_R + 0.6, 0.1, 32), toon(ribbonColor))
        : new THREE.Mesh(new THREE.BoxGeometry(W + 0.02, 0.1, D + 0.7), toon(ribbonColor));
      ribbon.position.y = -0.04;
      ribbon.receiveShadow = true;
      g.add(ribbon);
      if (sp.kind === 'corner') {
        // Corner pad from the card design: a thick round token with the icon and name on top.
        const look = CORNER_PADS[sp.corner];
        const r = CORNER_R;
        const pad = part(new THREE.CylinderGeometry(r, r * 1.03, 0.45, 40), look.rim, { outline: 0.06 });
        pad.position.y = 0.22;
        pad.userData.space = i;
        g.add(pad);
        entry.top = pad;
        const face = new THREE.Mesh(new THREE.CircleGeometry(r * 0.99, 48), new THREE.MeshBasicMaterial({ map: canvasTexture(drawCornerPad(sp.corner, { size: 256 })), transparent: true }));
        face.rotation.x = -Math.PI / 2; // world-aligned so the icon and label read upright
        face.position.copy(spot.pos).setY(0.46);
        face.userData.space = i;
        this.world.add(face);
      } else {
        const x = state.props[i];
        // Card slab: a dark base the size of the card, with the card face on top.
        const base = part(new RoundedBoxGeometry(W - 0.1, 0.3, D - 0.1, 3, 0.12), INK, { outline: 0 });
        base.position.y = 0.15;
        g.add(base);
        const canvas = document.createElement('canvas');
        const tex = canvasTexture(canvas);
        const card = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.14, D - 0.14), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
        // Face the card's top towards the top of the screen (outward unless the tile's inward side is higher on screen).
        card.rotation.set(-Math.PI / 2, 0, spot.inward.z < 0 ? Math.PI : 0);
        card.position.y = 0.31;
        card.userData.space = i;
        g.add(card);
        entry.top = card;
        entry.card = { canvas, tex, key: null };
        // Landmark or utility scene on the beach just outside the tile's outer edge. Hidden until the
        // property is bought, then it rises out of the ground.
        const at = spot.landmark; // resolved so landmarks never sit on the track or on each other
        const inside = onGrass(at.x, at.z);
        const site = new THREE.Group();
        site.position.set(at.x, inside ? -0.12 : BEACH_Y, at.z);
        site.visible = false;
        this.world.add(site); // world space: it may sit on either side of the track
        site.add(landmarkCutout(cardModel(state, i).lm, at.w));
        entry.landmark = site;
        // Owner flag at the tile's outer corner (the card also shows an "Owned" tag)
        const flag = new THREE.Group();
        const pole = part(new THREE.CylinderGeometry(0.04, 0.04, 1.3, 6), '#eeeeee', { outline: 0.015 });
        pole.position.y = 0.65;
        flag.add(pole);
        const flagCloth = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.04), toon('#ffffff').clone());
        flagCloth.position.set(0.32, 1.1, 0);
        flagCloth.castShadow = true;
        flag.add(flagCloth);
        flag.position.set(-W / 2 + 0.3, 0.3, -D / 2 + 0.3);
        flag.visible = false;
        g.add(flag);
        entry.flag = flag;
        entry.flagCloth = flagCloth;
      }
      this.tiles.push(entry);
    });
    this.freshTiles = true; // first sync shows owned landmarks without the rise animation

    const ext = Math.max(bounds.hw, bounds.hd) + 4;
    this.sun.position.set(bounds.cx - 18, 40, bounds.cz + 22);
    this.sun.target.position.set(bounds.cx, 0, bounds.cz);
    this.sun.shadow.camera.left = this.sun.shadow.camera.bottom = -ext;
    this.sun.shadow.camera.right = this.sun.shadow.camera.top = ext;
    this.sun.shadow.camera.far = 120;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.overview(true);
  }

  // ---------- Sync with game state ----------
  sync(state, { animatingTokens = new Set() } = {}) {
    if (!state.spaces.length) return;
    this.setup(state);
    this.state = state;
    for (const t of this.tiles) {
      const x = state.props[t.i];
      if (!x) continue;
      const owner = x.owner != null ? state.players[x.owner] : null;
      if (t.owner !== (owner?.id ?? null)) {
        t.owner = owner?.id ?? null;
        t.flag.visible = !!owner;
        if (owner) { t.flagCloth.material.color.set(owner.color); this.pop(t.flag); }
        // Bought: the landmark rises (instantly when loading a game in progress). Released: it goes.
        if (owner && !t.landmark.visible) this.raiseLandmark(t, this.freshTiles);
        else if (!owner) t.landmark.visible = false;
      }
      // Redraw the card face when what it shows changes (owner tag, mortgage stamp).
      const key = `${x.owner ?? ''}|${x.mortgaged ? 1 : 0}`;
      if (t.card.key !== key) {
        t.card.key = key;
        const model = cardModel(state, t.i);
        const draw = () => { drawCard(model, { scale: 1, canvas: t.card.canvas, onUpdate: draw }); t.card.tex.needsUpdate = true; };
        draw();
      }
      if (x.kind === 'city' && x.steps !== t.steps) {
        if (t.buildingObj) t.group.remove(t.buildingObj);
        t.buildingObj = null;
        if (x.steps) {
          const b = createBuilding(x.steps, regionOf(x.region).style);
          b.position.set(W / 2 - 0.7, 0.3, 0); // on the card, beside the tokens
          b.rotation.y = -t.spot.rotY;
          b.scale.setScalar(1.15);
          t.group.add(b);
          t.buildingObj = b;
          this.pop(b);
        }
        t.steps = x.steps;
      }
    }
    // Tokens
    for (const p of state.players) {
      if (!p.token) continue;
      let tk = this.tokens.get(p.id);
      if (!tk) {
        const obj = createToken(p.token, p.color, { tilt: PITCH });
        obj.scale.setScalar(0.85);
        this.world.add(obj);
        tk = { obj, pos: p.pos, base: new THREE.Vector3(), mood: null, moodT: 0 };
        this.tokens.set(p.id, tk);
      }
      tk.obj.visible = !p.bankrupt;
      tk.jailed = p.jailed;
      if (!animatingTokens.has(p.id)) { tk.pos = p.pos; }
    }
    this.freshTiles = false;
    this.layoutTokens(animatingTokens);
    this.active = state.phase === 'turn' ? state.turn.active : null;
  }

  spotCenter(i) {
    const s = this.geo.spots[i];
    // Tokens stand on the inner half of a tile so the name label on the outer half stays readable.
    return s.kind === 'corner' ? s.pos.clone() : s.pos.clone().add(s.inward.clone().multiplyScalar(0.6)).add(s.u.clone().multiplyScalar(-0.35));
  }

  layoutTokens(skip = new Set()) {
    const groups = new Map();
    for (const [id, tk] of this.tokens) {
      if (!tk.obj.visible || skip.has(id)) continue;
      (groups.get(tk.pos) || groups.set(tk.pos, []).get(tk.pos)).push(id);
    }
    for (const [pos, ids] of groups) {
      const c = this.spotCenter(pos);
      ids.forEach((id, k) => {
        const tk = this.tokens.get(id);
        const rad = this.geo.spots[pos].kind === 'corner' ? 1.6 : 1.0; // characters are big: spread them out
        const off = ids.length === 1 ? new THREE.Vector3() : new THREE.Vector3(Math.cos((k / ids.length) * Math.PI * 2) * rad, 0, Math.sin((k / ids.length) * Math.PI * 2) * rad * 0.8);
        tk.base.copy(c).add(off).setY(0.3);
        tk.obj.position.copy(tk.base);
      });
    }
  }

  // ---------- Animations ----------
  tween(ms, fn) {
    return new Promise((resolve) => {
      if (this.skipping || ms <= 0 || document.hidden) { fn(1); resolve(); return; }
      const tw = { t0: performance.now(), ms, fn, resolve };
      // Safety net: finish even if animation frames are paused (background tab).
      tw.timer = setTimeout(() => {
        if (!this.tweens.includes(tw)) return;
        this.tweens = this.tweens.filter((x) => x !== tw);
        fn(1); resolve();
      }, ms + 300);
      this.tweens.push(tw);
    });
  }
  skip() {
    this.skipping = true;
    for (const tw of this.tweens) { tw.fn(1); tw.resolve(); }
    this.tweens = [];
  }
  endSkip() { this.skipping = false; }

  pop(obj) {
    const s = obj.scale.x || 1;
    this.tween(380, (t) => {
      const k = t < 1 ? 1 + Math.sin(t * Math.PI) * 0.35 - (1 - t) * 0.6 : 1;
      obj.scale.setScalar(Math.max(0.01, s * k));
    });
  }

  // Close-up distance: about 18 board units (9 tiles) across the screen, so a player's
  // surroundings are easy to read on a phone. Never wider than 60% of the whole-board view.
  playDist() {
    if (this.userPlayDist) return this.userPlayDist;
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    return Math.min(Math.max(9 / (tan * this.camera.aspect), 6 / tan), this.overviewDist() * 0.6);
  }

  setOverview(on) {
    if (this.inOverview === on) return;
    this.inOverview = on;
    this.onViewChange?.(on);
  }

  /** Centre the camera on a token. `zoom` brings it in to the play distance if it is further out. */
  async focusToken(pid, { zoom = false, ms = 380 } = {}) {
    const tk = this.tokens.get(pid);
    if (!tk) return;
    if (!zoom && this.inOverview) return; // keep the whole board in view until the next roll
    this.userMoved = false; // following resumes
    const dist = zoom && (this.inOverview || this.cam.dist > this.playDist() * 1.1) ? this.playDist() : this.cam.dist;
    this.hasFocused = true;
    this.setOverview(false);
    await this.moveCamera(tk.obj.position.clone(), dist, ms);
  }

  toggleOverview(activePid) {
    if (this.inOverview && activePid != null) return this.focusToken(activePid, { zoom: true });
    return this.overview(false, 420);
  }

  async animateMove(pid, path) {
    const tk = this.tokens.get(pid);
    if (!tk || !path.length) return;
    const ud = tk.obj.userData;
    const lift = ud.style?.hop ?? 0.7; // each character hops (or drives, glides, flies) its own way
    tk.moving = true;
    for (const i of path) {
      const from = tk.obj.position.clone();
      const to = this.spotCenter(i).setY(0.3);
      const dir = to.clone().sub(from);
      // Camera has no yaw, so world x is screen x: face left or right along the hop.
      if (Math.abs(dir.x) > 0.05) tk.obj.userData.setFacing?.(Math.sign(dir.x));
      await this.tween(HOP_MS, (t) => {
        tk.obj.position.lerpVectors(from, to, t);
        tk.obj.position.y = 0.3 + Math.sin(t * Math.PI) * lift;
        tk.hopT = t;
        if (!this.inOverview && !this.userMoved && (this.follow == null || this.follow === pid)) this.cam.target.lerp(tk.obj.position.clone().setY(0), 0.25); // follow the pawn
      });
      tk.pos = i;
    }
    tk.moving = false;
    this.layoutTokens();
  }

  async moveCamera(target, dist, ms) {
    if (this.userMoved) return;
    const t0 = this.cam.target.clone(), d0 = this.cam.dist;
    const t1 = target.clone().setY(0);
    await this.tween(Math.min(ms, MAX_ZOOM_MS), (t) => {
      const e = easeInOut(t);
      this.cam.target.lerpVectors(t0, t1, e);
      this.cam.dist = d0 + (dist - d0) * e;
    });
  }

  /**
   * How much ground the fixed-pitch camera shows, per unit of camera distance: from the target up the
   * screen to the top edge (top), down to the bottom edge (bottom), and half the width at the target.
   */
  viewSpan() {
    const f = THREE.MathUtils.degToRad(FOV / 2);
    const sp = Math.sin(PITCH), cp = Math.cos(PITCH);
    return { top: sp / Math.tan(PITCH - f) - cp, bottom: cp - sp / Math.tan(PITCH + f), half: Math.tan(f) * this.camera.aspect };
  }

  // Furthest zoom: the island and its strip of harbour just fill the screen.
  overviewDist() {
    const b = this.bounds || { hw: 20, hd: 12 };
    const v = this.viewSpan();
    return Math.max((b.hd * 2) / (v.top + v.bottom), b.hw / v.half);
  }

  // Keep the view on the island and its harbour: the screen never shows past the edge of the board's
  // box (when the screen is wider or taller than the box, the view centres on it instead).
  clampView() {
    const b = this.bounds;
    if (!b) return;
    const v = this.viewSpan(), d = this.cam.dist, t = this.cam.target;
    const fit = (x, lo, hi, a, c) => (hi - lo <= a + c ? (lo + hi) / 2 + (a - c) / 2 : THREE.MathUtils.clamp(x, lo + a, hi - c));
    t.x = fit(t.x, b.minX, b.maxX, v.half * d, v.half * d);
    t.z = fit(t.z, b.minZ, b.maxZ, v.top * d, v.bottom * d);
  }

  async overview(instant = false, ms = 450) {
    this.userMoved = false;
    this.setOverview(true);
    const b = this.bounds || { cx: 0, cz: 0 };
    const target = new THREE.Vector3(b.cx, 0, b.cz);
    if (instant) { this.cam.target.copy(target); this.cam.dist = this.overviewDist(); return; }
    await this.moveCamera(target, this.overviewDist(), ms);
  }

  raiseLandmark(t, instant = false) {
    const site = t.landmark;
    site.visible = true;
    const k = site.children;
    if (instant) return;
    // Pop up out of the ground with an overshoot, a little shake and a burst of confetti.
    this.tween(900, (p) => {
      const e = p < 1 ? 1 + 2.2 * (p - 1) ** 3 + 1.2 * (p - 1) ** 2 : 1; // ease out back
      for (const c of k) {
        c.userData.baseScale ??= c.scale.x;
        c.scale.setScalar(Math.max(0.01, c.userData.baseScale * e));
      }
      site.position.y = (site.userData.baseY ??= site.position.y) - (1 - Math.min(1, p * 1.6)) * 1.2;
      site.rotation.y = p < 1 ? Math.sin(p * Math.PI * 4) * 0.12 * (1 - p) : 0;
    });
    this.burst(site.position.clone().setY(0.8));
  }

  setMood(pid, mood) {
    const tk = this.tokens.get(pid);
    if (tk) { tk.mood = mood; tk.moodT = performance.now(); }
  }

  floatText(spaceOrPid, text, kind = 'gain', isPlayer = true) {
    let pos;
    if (isPlayer) pos = this.tokens.get(spaceOrPid)?.obj.position.clone();
    else pos = this.spotCenter(spaceOrPid);
    if (!pos) return;
    const el = document.createElement('div');
    el.className = `float-text ${kind}`;
    el.textContent = text;
    this.overlay.appendChild(el);
    const start = performance.now();
    const p = pos.clone().setY(pos.y + (isPlayer ? 3.6 : 1.6)); // above the characters
    const step = () => {
      const t = (performance.now() - start) / 1300;
      if (t >= 1) { el.remove(); return; }
      const v = p.clone().setY(p.y + t * 1.2).project(this.camera);
      el.style.transform = `translate(-50%,-50%) translate(${((v.x + 1) / 2) * this.w}px, ${((1 - v.y) / 2) * this.h}px) scale(${1 + Math.sin(Math.min(t * 4, 1) * Math.PI) * 0.25})`;
      el.style.opacity = String(t > 0.7 ? (1 - t) / 0.3 : 1);
      requestAnimationFrame(step);
    };
    step();
  }

  sparkle(space) { this.burst(this.spotCenter(space).setY(0.6)); }

  burst(at) {
    const g = new THREE.Group();
    g.position.copy(at);
    const colors = ['#ffd23f', '#ff5d8f', '#3ec1d3', '#7bd389'];
    for (let k = 0; k < 14; k++) {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), new THREE.MeshBasicMaterial({ color: colors[k % 4] }));
      m.userData.v = new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3);
      g.add(m);
    }
    this.world.add(g);
    const start = performance.now();
    const step = () => {
      const t = (performance.now() - start) / 900;
      if (t >= 1) { this.world.remove(g); return; }
      for (const m of g.children) {
        m.position.copy(m.userData.v).multiplyScalar(t);
        m.position.y -= 3 * t * t;
        m.rotation.y += 0.2;
        m.scale.setScalar(1 - t);
      }
      requestAnimationFrame(step);
    };
    step();
  }

  highlight(spaces = []) {
    this.highlighted = new Set(spaces);
    for (const t of this.tiles) {
      const mat = t.top.material;
      if (mat.emissive) mat.emissive.set(0x000000);
      if (t.card) { mat.color.set(0xffffff); t.top.position.y = 0.31; }
    }
  }

  // ---------- Input: tap, pinch, pan, wheel (FR-184) ----------
  bindInput() {
    const el = this.renderer.domElement;
    const pointers = new Map();
    let pinchStart = 0, distStart = 0, moved = 0, last = null;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, appPoint(e));
      moved = 0;
      last = appPoint(e);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
        distStart = this.cam.dist;
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, appPoint(e));
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.cam.dist = THREE.MathUtils.clamp(distStart * (pinchStart / d), 7, this.overviewDist());
        this.userZoomed();
        moved += 10;
        return;
      }
      const p = appPoint(e);
      const dx = p.x - last.x, dy = p.y - last.y;
      last = p;
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved < 6) return;
      const k = (this.cam.dist / this.h) * 1.0;
      this.cam.target.x -= dx * k;
      this.cam.target.z -= (dy * k) / Math.sin(PITCH);
      this.clampView();
      this.userMoved = true;
    });
    const up = (e) => {
      const wasTap = pointers.size === 1 && moved < 6;
      pointers.delete(e.pointerId);
      if (wasTap) this.tap(e);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', (e) => pointers.delete(e.pointerId));
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cam.dist = THREE.MathUtils.clamp(this.cam.dist * (1 + Math.sign(e.deltaY) * 0.1), 7, this.overviewDist());
      this.userZoomed();
    }, { passive: false });
  }

  // Manual zoom: remember a close zoom as the play zoom; zooming right out counts as the whole-board view.
  userZoomed() {
    this.userMoved = true;
    const far = this.cam.dist >= this.overviewDist() * 0.85;
    if (!far) this.userPlayDist = this.cam.dist;
    this.setOverview(far);
  }

  tap(e) {
    const rect = this.renderer.domElement.getBoundingClientRect(); // on screen, so turned with the app
    const [u, w] = TURNED.matches
      ? [(e.clientY - rect.top) / rect.height, (rect.right - e.clientX) / rect.width]
      : [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height];
    const v = new THREE.Vector2(u * 2 - 1, -w * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    const hits = this.raycaster.intersectObjects(this.tiles.map((t) => t.top), false);
    if (hits.length) this.onTileTap?.(hits[0].object.userData.space);
    else this.onTileTap?.(null);
  }

  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.w = w; this.h = h;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.inOverview && !this.userMoved && this.geo && !this.tweens.length) this.cam.dist = this.overviewDist();
  }

  frame() {
    const now = performance.now();
    const time = this.clock.getElapsedTime();
    // tweens
    if (this.tweens.length) {
      const done = [];
      for (const tw of this.tweens) {
        const t = Math.min(1, (now - tw.t0) / tw.ms);
        tw.fn(t);
        if (t >= 1) done.push(tw);
      }
      if (done.length) {
        this.tweens = this.tweens.filter((x) => !done.includes(x));
        for (const d of done) d.resolve();
      }
    }
    // camera
    this.clampView();
    const { target, dist } = this.cam;
    this.camera.position.set(target.x, Math.sin(PITCH) * dist, target.z + Math.cos(PITCH) * dist);
    this.camera.lookAt(target);
    // idle animations
    // Selectable spaces pulse: cards glow warm and lift a little; corner pads glow.
    for (const t of this.tiles) {
      if (!this.highlighted?.has(t.i)) continue;
      const k = 0.5 + Math.sin(time * 6) * 0.5;
      if (t.card) {
        t.top.material.color.setRGB(1, 1 - 0.12 * k, 1 - 0.4 * k);
        t.top.position.y = 0.31 + 0.12 * k;
      } else if (t.top.material.emissive) {
        if (!t.top.material.userData.own) { t.top.material = t.top.material.clone(); t.top.material.userData.own = true; }
        t.top.material.emissive.setRGB(0.45, 0.35, 0).multiplyScalar(k);
      }
    }
    this.island?.update(time);
    for (const d of this.decor || []) d.userData.animate(time);
    for (const [id, tk] of this.tokens) {
      const ud = tk.obj.userData;
      const age = (now - tk.moodT) / 1000;
      let expr = tk.jailed ? 'sad' : 'confident';
      // Each character idles and moves in its own style; the active player's is livelier.
      ud.animate?.(time, { active: id === this.active, moving: tk.moving, hop: tk.hopT });
      if (tk.mood === 'celebrate' && age < 1.4) {
        ud.moodPose?.('celebrate', age); // happy jump
        expr = 'happy';
      } else if ((tk.mood === 'shocked' || tk.mood === 'angry') && age < 1.1) {
        // Wince while paying: shocked when paying a player, angry when paying the bank
        ud.moodPose?.(tk.mood, age);
        expr = tk.mood;
      } else if (tk.mood) tk.mood = null;
      ud.setExpression?.(expr);
    }
    this.renderer.render(this.scene, this.camera);
  }
}

function canvasTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

