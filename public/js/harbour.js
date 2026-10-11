// Monaco-in-race-week harbour around the island: stone quays reaching into the water with superyachts
// moored stern-to, more yachts riding at anchor or cruising past with a wake, bunting on the quays and
// gulls wheeling overhead. Everything stays inside the strip of sea the camera shows.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { part, toon } from './models.js';

const SEA_Y = -0.6;
const box = (w, h, d, r = 0.05) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.1, h / 2.1, d / 2.1));

/**
 * island: from buildIsland (isLand, coast). view: the box the camera can show (yachts stay inside it).
 * Returns { group, decor } — decor items have userData.animate(t).
 */
export function buildHarbour(island, view) {
  const group = new THREE.Group();
  const decor = [];
  let seed = 31;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const inView = (x, z, m = 0.8) => x > view.minX + m && x < view.maxX - m && z > view.minZ + m && z < view.maxZ - m;
  const wet = (x, z) => !island.isLand(x, z);
  const clearWater = (x, z, r) => wet(x, z) && wet(x + r, z) && wet(x - r, z) && wet(x, z + r) && wet(x, z - r) && inView(x, z, r);
  const used = [];
  const free = (x, z, r) => used.every((u) => Math.hypot(u.x - x, u.z - z) > u.r + r);

  // ---- Quays with moored yachts ----
  const quays = [];
  for (const c of [...island.coast].sort(() => rnd() - 0.5)) {
    if (quays.length >= 9) break;
    if (quays.some((q) => Math.hypot(q.x - c.x, q.z - c.z) < 6)) continue;
    if (!island.isLand(c.x - c.nx * 3, c.z - c.nz * 3) || !island.isLand(c.x - c.nx * 5, c.z - c.nz * 5)) continue; // main shore only, not a landmark's islet
    const L = 3.2;
    let ok = true;
    for (let s = 0.8; s <= L + 1.6; s += 0.4) if (!clearWater(c.x + c.nx * s, c.z + c.nz * s, 0.4)) { ok = false; break; }
    if (!ok) continue;
    quays.push({ ...c, L });
  }
  for (const q of quays) {
    const ang = Math.atan2(-q.nz, q.nx);
    const pier = new THREE.Group();
    pier.position.set(q.x, SEA_Y, q.z);
    pier.rotation.y = ang;
    group.add(pier);
    const deck = part(box(q.L + 0.6, 0.5, 0.7, 0.04), '#d9d2c3', { outline: 0.015 });
    deck.position.set(q.L / 2 + 0.2, 0.3, 0);
    pier.add(deck);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(q.L + 0.6, 0.04, 0.74), toon('#bfb6a3'));
    edge.position.set(q.L / 2 + 0.2, 0.56, 0);
    pier.add(edge);
    for (let k = 0; k < 3; k++) { // bollards and lamps
      const b = part(new THREE.CylinderGeometry(0.04, 0.05, 0.12, 8), '#2b2b33', { outline: 0 });
      b.position.set(0.8 + k * 1.1, 0.62, 0.3);
      pier.add(b);
    }
    for (const sx of [0.6, q.L]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 5), toon('#1f2937'));
      pole.position.set(sx, 0.96, -0.28);
      pier.add(pole);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), toon('#fff4c2', { emissive: new THREE.Color('#ffe08a'), emissiveIntensity: 0.6 }));
      lamp.position.set(sx, 1.38, -0.28);
      pier.add(lamp);
    }
    // Race-week bunting along the quay
    const bunting = createBunting(q.L);
    bunting.position.set(0.6, 1.28, -0.28);
    pier.add(bunting);
    decor.push(bunting);
    used.push({ x: q.x + q.nx * q.L / 2, z: q.z + q.nz * q.L / 2, r: q.L / 2 + 0.6 });
    // Yachts moored alongside, bows out to sea
    for (const side of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        const len = 1.9 + rnd() * 1.2;
        const sx = 0.9 + k * 1.5 + len * 0.15, sz = side * (0.35 + len * 0.17 + 0.05);
        const wx = q.x + q.nx * sx - q.nz * sz, wz = q.z + q.nz * sx + q.nx * sz; // pier frame: x out to sea, z along the quay
        if (!clearWater(wx, wz, len * 0.3)) continue;
        const y = createYacht(len, rnd);
        y.position.set(wx, SEA_Y, wz);
        y.rotation.y = ang;
        group.add(y);
        decor.push(bobber(y, rnd() * 6, 0.6));
      }
    }
  }

  // ---- Yachts at anchor in open water ----
  let anchored = 0;
  for (let tries = 0; tries < 400 && anchored < 10; tries++) {
    const c = island.coast[Math.floor(rnd() * island.coast.length)];
    if (!c) break;
    const d = 2.2 + rnd() * 3.5, len = 2 + rnd() * 1.8;
    const x = c.x + c.nx * d + (rnd() - 0.5) * 2, z = c.z + c.nz * d + (rnd() - 0.5) * 2;
    if (!clearWater(x, z, len * 0.55) || !free(x, z, len * 0.6)) continue;
    const y = createYacht(len, rnd);
    y.position.set(x, SEA_Y, z);
    y.rotation.y = rnd() * Math.PI * 2;
    group.add(y);
    decor.push(bobber(y, rnd() * 6, 1));
    used.push({ x, z, r: len * 0.6 });
    anchored++;
  }

  // ---- Yachts cruising past along the edge of the view, leaving a wake ----
  const lanes = [
    { z: view.maxZ - 1.6, x0: view.minX - 4, x1: view.maxX + 4 },
    { z: view.minZ + 1.6, x0: view.maxX + 4, x1: view.minX - 4 },
  ];
  lanes.forEach((lane, k) => {
    if (island.isLand((lane.x0 + lane.x1) / 2, lane.z)) return;
    const len = 2.6 + k * 0.6;
    const y = createYacht(len, rnd);
    group.add(y);
    const wake = createWake();
    group.add(wake);
    const dir = Math.sign(lane.x1 - lane.x0);
    const span = Math.abs(lane.x1 - lane.x0), speed = 1.1 + k * 0.3;
    const animate = (t) => {
      const u = ((t * speed + k * span * 0.5) % span) / span;
      const x = lane.x0 + (lane.x1 - lane.x0) * u;
      // stay off the land if the lane crosses it: hide while over the island
      y.visible = wake.visible = !island.isLand(x, lane.z) && !island.isLand(x + dir * len * 0.5, lane.z);
      y.position.set(x, SEA_Y + Math.sin(t * 2 + k) * 0.03, lane.z);
      y.rotation.set(Math.sin(t * 1.3 + k) * 0.02, dir > 0 ? 0 : Math.PI, 0);
      wake.position.set(x - dir * len * 0.45, SEA_Y + 0.02, lane.z);
      wake.rotation.y = dir > 0 ? 0 : Math.PI;
      wake.userData.animate(t);
    };
    decor.push({ userData: { animate } });
  });

  // ---- Gulls ----
  for (let k = 0; k < 7; k++) {
    const gull = createGull();
    const cx = view.minX + rnd() * (view.maxX - view.minX), cz = view.minZ + rnd() * (view.maxZ - view.minZ);
    const r = 2 + rnd() * 4, h = 4 + rnd() * 2.5, sp = (0.25 + rnd() * 0.25) * (rnd() < 0.5 ? -1 : 1), ph = rnd() * 6;
    group.add(gull);
    decor.push({ userData: { animate: (t) => {
      const a = t * sp + ph;
      gull.position.set(cx + Math.cos(a) * r, h + Math.sin(t * 0.8 + ph) * 0.3, cz + Math.sin(a) * r * 0.7);
      gull.rotation.y = -a + (sp > 0 ? -Math.PI / 2 : Math.PI / 2);
      gull.userData.flap(t + ph);
    } } });
  }
  return { group, decor };
}

function bobber(obj, ph, amp) {
  const y0 = obj.position.y, ry = obj.rotation.y;
  return { userData: { animate: (t) => {
    obj.position.y = y0 + Math.sin(t * 1.4 + ph) * 0.035 * amp;
    obj.rotation.set(Math.sin(t * 1.1 + ph) * 0.025 * amp, ry + Math.sin(t * 0.3 + ph) * 0.04 * amp, Math.sin(t * 0.9 + ph) * 0.015 * amp);
  } } };
}

/** Superyacht pointing along +x: sleek white hull, dark boot stripe, stacked decks, mast and flag. */
export function createYacht(len, rnd = Math.random) {
  const g = new THREE.Group();
  const w = len * 0.26;
  const hull = new THREE.Shape();
  hull.moveTo(-len / 2, -w / 2);
  hull.lineTo(len * 0.18, -w / 2);
  hull.quadraticCurveTo(len * 0.45, -w * 0.35, len / 2, 0);
  hull.quadraticCurveTo(len * 0.45, w * 0.35, len * 0.18, w / 2);
  hull.lineTo(-len / 2, w / 2);
  hull.closePath();
  const hullGeo = new THREE.ExtrudeGeometry(hull, { depth: len * 0.13, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 });
  hullGeo.rotateX(-Math.PI / 2);
  const hullMesh = part(hullGeo, '#fdfdfd', { outline: 0.014 });
  hullMesh.position.y = 0.02;
  g.add(hullMesh);
  const bootGeo = new THREE.ExtrudeGeometry(hull, { depth: len * 0.03, bevelEnabled: false });
  bootGeo.rotateX(-Math.PI / 2);
  const accent = ['#0b2545', '#1f2937', '#7a1f2b', '#0b5a6e'][Math.floor(rnd() * 4)];
  const boot = new THREE.Mesh(bootGeo, toon(accent));
  boot.scale.set(1.01, 1, 1.01);
  boot.position.y = -0.01;
  g.add(boot);
  // Teak deck aft
  const deck = new THREE.Mesh(new THREE.BoxGeometry(len * 0.32, 0.01, w * 0.8), toon('#c8955a'));
  deck.position.set(-len * 0.3, len * 0.13 + 0.05, 0);
  g.add(deck);
  // Superstructure tiers with dark window bands
  const tiers = len > 2.6 ? 3 : 2;
  for (let k = 0; k < tiers; k++) {
    const tl = len * (0.55 - k * 0.12), th = len * 0.075;
    const tier = part(box(tl, th, w * (0.78 - k * 0.1), 0.05), '#ffffff', { outline: 0.01 });
    tier.position.set(-len * 0.02 + k * len * 0.02, len * 0.13 + 0.05 + th / 2 + k * th, 0);
    g.add(tier);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(tl * 0.92, th * 0.42, w * (0.78 - k * 0.1) + 0.012), toon('#1b2a3a', { emissive: new THREE.Color('#284b6b'), emissiveIntensity: 0.2 }));
    glass.position.copy(tier.position);
    g.add(glass);
  }
  const top = len * 0.13 + 0.05 + tiers * len * 0.075;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, len * 0.18, 6), toon('#d7dde5'));
  mast.position.set(len * 0.02, top + len * 0.09, 0);
  g.add(mast);
  const radar = new THREE.Mesh(new THREE.BoxGeometry(len * 0.12, 0.015, 0.03), toon('#ffffff'));
  radar.position.set(len * 0.02, top + len * 0.15, 0);
  g.add(radar);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.1), toon(rnd() < 0.5 ? '#e10600' : '#ffffff', { side: THREE.DoubleSide }));
  flag.position.set(-len / 2 + 0.1, len * 0.13 + 0.3, 0);
  g.add(flag);
  if (len > 2.8) { // tender on the aft deck
    const tender = part(box(len * 0.18, 0.08, w * 0.35, 0.03), '#3c4a5c', { outline: 0.008 });
    tender.position.set(-len * 0.34, len * 0.13 + 0.1, 0);
    g.add(tender);
  }
  g.traverse((o) => { if (o.isMesh) o.raycast = () => {}; });
  return g;
}

function createWake() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  const grd = x.createLinearGradient(0, 0, 256, 0);
  grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(1, 'rgba(255,255,255,0.85)');
  x.fillStyle = grd;
  x.beginPath(); x.moveTo(256, 26); x.lineTo(0, 0); x.lineTo(0, 64); x.lineTo(256, 38); x.closePath(); x.fill();
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.geometry.translate(-2, 0, 0);
  m.geometry.rotateX(-Math.PI / 2);
  m.userData.animate = (t) => { m.material.opacity = 0.75 + 0.2 * Math.sin(t * 5); m.scale.z = 1 + 0.08 * Math.sin(t * 3); };
  return m;
}

function createBunting(len) {
  const g = new THREE.Group();
  const flags = [];
  const n = Math.max(4, Math.round(len * 3));
  const colors = ['#e10600', '#ffffff', '#e10600', '#ffffff', '#111111', '#ffffff'];
  for (let k = 0; k < n; k++) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 3), toon(colors[k % colors.length]));
    f.rotation.x = Math.PI;
    f.position.set((k / (n - 1)) * (len - 0.6), -Math.sin((k / (n - 1)) * Math.PI) * 0.12, 0);
    g.add(f); flags.push(f);
  }
  g.userData.animate = (t) => flags.forEach((f, k) => { f.rotation.z = Math.sin(t * 4 + k * 0.7) * 0.25; });
  return g;
}

function createGull() {
  const g = new THREE.Group();
  const mat = toon('#ffffff', { side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.16, 3, 6), mat);
  body.rotation.z = Math.PI / 2;
  g.add(body);
  const wings = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    const wing = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.34), mat);
    wing.rotation.x = -Math.PI / 2;
    wing.position.z = s * 0.17;
    pivot.add(wing);
    const tip = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.1), toon('#2b2b33', { side: THREE.DoubleSide }));
    tip.rotation.x = -Math.PI / 2;
    tip.position.z = s * 0.32;
    pivot.add(tip);
    g.add(pivot);
    wings.push({ pivot, s });
  }
  g.userData.flap = (t) => wings.forEach(({ pivot, s }) => { pivot.rotation.x = s * Math.sin(t * 7) * 0.5; });
  return g;
}
