// The middle of the board: a seven-star sail hotel in the centre of the infield, a Formula 1 street
// circuit (with racing cars, kerbs, grandstand, pit building and start gantry) in one arm, and the golf
// course in the other arm (see golf.js; this module hands it a clearance that keeps it to its side).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { part, toon, createTree } from './models.js';
import { pointInPolygon } from './track.js';

const box = (w, h, d, r = 0.06) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.1, h / 2.1, d / 2.1));
const glow = (c, i = 0.6) => toon(c, { emissive: new THREE.Color(c), emissiveIntensity: i });

/**
 * poly: infield outline (track centreline). clearance(x, z): free distance from the track and landmarks.
 * Returns { group, decor, keepOut, golfClearance }.
 */
export function buildResort(poly, clearance, y = -0.115) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of poly) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const cx = (minX + maxX) / 2;
  const grid = [];
  for (let x = minX; x <= maxX; x += 0.5) for (let z = minZ; z <= maxZ; z += 0.5) {
    if (!pointInPolygon(x, z, poly)) continue;
    const c = clearance(x, z);
    if (c > 0.8) grid.push({ x, z, c });
  }
  const group = new THREE.Group();
  const decor = [];
  const keepOut = [];

  // ---- Hotel: the roomiest spot near the middle of the infield ----
  const hotelSpot = grid.filter((p) => Math.abs(p.x - cx) < 6).sort((a, b) => b.c - a.c || Math.abs(a.x - cx) - Math.abs(b.x - cx))[0];
  let hotel = null;
  if (hotelSpot) {
    const size = Math.min(1.25, (hotelSpot.c - 0.3) / 2.6);
    hotel = createHotel(size);
    hotel.position.set(hotelSpot.x, y, hotelSpot.z);
    group.add(hotel);
    decor.push(hotel);
    keepOut.push({ x: hotelSpot.x, z: hotelSpot.z, r: 3.3 * size });
  }
  const nearHotel = (x, z) => hotelSpot && Math.hypot(x - hotelSpot.x, z - hotelSpot.z) < 3.6 * Math.min(1.25, (hotelSpot.c - 0.3) / 2.6) + 0.8;

  // ---- F1 circuit: fills the left arm, following its shape ----
  const side = grid.filter((p) => p.x < cx - 4 && p.c > 2.4);
  let circuit = null;
  if (side.length > 20) {
    const ccx = side.reduce((a, p) => a + p.x, 0) / side.length, ccz = side.reduce((a, p) => a + p.z, 0) / side.length;
    const ok = (x, z) => pointInPolygon(x, z, poly) && clearance(x, z) > 1.25 && x < cx - 3 && !nearHotel(x, z);
    const N = 72, raw = [];
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
      let r = 0;
      while (r < 30 && ok(ccx + dx * (r + 0.2), ccz + dz * (r + 0.2))) r += 0.2;
      raw.push(r);
    }
    // Smooth the outline, add a chicane wiggle, and keep inside the room found.
    const rs = raw.map((_, k) => {
      let s = 0;
      for (let j = -4; j <= 4; j++) s += raw[(k + j + N) % N];
      const a = (k / N) * Math.PI * 2;
      return Math.max(1.2, Math.min(s / 9 - 0.25, raw[k] - 0.15) * (1 - 0.1 * Math.max(0, Math.sin(a * 3 + 0.8))));
    });
    const pts = rs.map((r, k) => { const a = (k / N) * Math.PI * 2; return new THREE.Vector3(ccx + Math.cos(a) * r, 0, ccz + Math.sin(a) * r); });
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    circuit = buildCircuit(curve, y);
    group.add(circuit.group);
    decor.push(circuit.group);
    for (const p of curve.getSpacedPoints(80)) keepOut.push({ x: p.x, z: p.z, r: 1.1 });
    for (const k of circuit.keepOut) keepOut.push(k);
  }

  // Palms around the hotel
  if (hotelSpot) {
    const s = Math.min(1.25, (hotelSpot.c - 0.3) / 2.6);
    for (const [ox, oz] of [[-3.2, 0.6], [3.2, 0.6], [-2.6, -1.6], [2.6, -1.6], [-1.5, 2], [1.5, 2]]) {
      const x = hotelSpot.x + ox * s, z = hotelSpot.z + oz * s;
      if (clearance(x, z) < 0.6) continue;
      const t = createTree('palm');
      t.position.set(x, y, z);
      t.scale.setScalar(0.75);
      group.add(t);
    }
  }

  // Golf keeps to the other arm.
  const golfClearance = (x, z) => (x < cx + 3 || nearHotel(x, z) ? -1 : clearance(x, z));
  return { group, decor, keepOut, golfClearance, hotelAt: hotelSpot && { x: hotelSpot.x, z: hotelSpot.z }, circuitAt: circuit && side.length ? { x: side.reduce((a, p) => a + p.x, 0) / side.length, z: side.reduce((a, p) => a + p.z, 0) / side.length } : null };
}

// ---------- Circuit ----------
function ribbon(curve, n, off0, off1, y, mat, uvScale = 1) {
  const pos = [], uv = [], idx = [];
  const len = curve.getLength();
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = curve.getPointAt(t % 1), tg = curve.getTangentAt(t % 1);
    const nx = -tg.z, nz = tg.x;
    pos.push(p.x + nx * off0, y, p.z + nz * off0, p.x + nx * off1, y, p.z + nz * off1);
    uv.push((t * len) / uvScale, 0, (t * len) / uvScale, 1);
    if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  m.raycast = () => {};
  return m;
}
function stripeTexture(a, b, cells = 2) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 8;
  const x = c.getContext('2d');
  for (let k = 0; k < cells; k++) { x.fillStyle = k % 2 ? b : a; x.fillRect((k * 64) / cells, 0, 64 / cells, 8); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function checkerTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 16;
  const x = c.getContext('2d');
  for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? '#111' : '#fff'; x.fillRect(i * 4, j * 4, 4, 4); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

function buildCircuit(curve, y) {
  const group = new THREE.Group();
  const keepOut = [];
  const N = 360, HW = 0.62;
  const len = curve.getLength();
  // Run-off: lighter verge, then the asphalt with white edge lines
  group.add(ribbon(curve, N, -HW - 0.45, HW + 0.45, y + 0.012, toon('#b9c0b0')));
  const asphalt = ribbon(curve, N, -HW, HW, y + 0.02, new THREE.MeshLambertMaterial({ color: '#3b3e46' }));
  group.add(asphalt);
  for (const s of [-1, 1]) group.add(ribbon(curve, N, s * (HW - 0.07), s * (HW - 0.02), y + 0.025, new THREE.MeshBasicMaterial({ color: '#f4f4f4' })));
  // Kerbs (red/white) on the outside and inside of every bend
  const kerbMat = new THREE.MeshLambertMaterial({ map: stripeTexture('#e10600', '#ffffff') });
  kerbMat.map.repeat.set(1, 1);
  const bends = [];
  for (let i = 0; i < N; i++) {
    const t0 = curve.getTangentAt(i / N), t1 = curve.getTangentAt(((i + 3) % N) / N);
    if (t0.angleTo(t1) > 0.11) bends.push(i);
  }
  const runs = [];
  for (const i of bends) { const r = runs.at(-1); if (r && i - r[1] <= 2) r[1] = i; else runs.push([i, i]); }
  for (const [a, b] of runs) {
    const sub = new THREE.CatmullRomCurve3(Array.from({ length: Math.max(3, b - a + 4) }, (_, k) => curve.getPointAt(((a - 1 + k) % N + N) % N / N)));
    for (const s of [-1, 1]) {
      const k = ribbon(sub, 24, s * HW, s * (HW + 0.22), y + 0.03, kerbMat, 0.5);
      group.add(k);
    }
  }
  // Start/finish: chequered line, grid slots and a lights gantry over the track
  const startT = 0;
  const sp = curve.getPointAt(startT), st = curve.getTangentAt(startT);
  const heading = Math.atan2(-st.z, st.x);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(0.35, HW * 2), new THREE.MeshBasicMaterial({ map: checkerTexture() }));
  line.rotation.set(-Math.PI / 2, 0, heading);
  line.position.set(sp.x, y + 0.03, sp.z);
  group.add(line);
  for (let k = 1; k <= 6; k++) {
    const p = curve.getPointAt(((-k * 0.012) % 1 + 1) % 1), tg = curve.getTangentAt(((-k * 0.012) % 1 + 1) % 1);
    const slot = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.35), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    slot.rotation.set(-Math.PI / 2, 0, Math.atan2(-tg.z, tg.x));
    slot.position.set(p.x - tg.z * (k % 2 ? 0.25 : -0.25), y + 0.03, p.z + tg.x * (k % 2 ? 0.25 : -0.25));
    group.add(slot);
  }
  const gantry = new THREE.Group();
  for (const s of [-1, 1]) { const post = part(new THREE.BoxGeometry(0.08, 1.3, 0.08), '#2b2b33', { outline: 0.01 }); post.position.set(0, 0.65, s * (HW + 0.3)); gantry.add(post); }
  const beam = part(box(0.22, 0.26, HW * 2 + 0.7), '#1c1c22', { outline: 0.012 });
  beam.position.y = 1.35;
  gantry.add(beam);
  const lights = [];
  for (let k = 0; k < 5; k++) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: '#330000' }));
    l.position.set(0.12, 1.35, -0.4 + k * 0.2);
    gantry.add(l); lights.push(l);
  }
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2 + 0.6, 0.22), new THREE.MeshBasicMaterial({ map: signTexture('GRAND PRIX', '#e10600'), side: THREE.DoubleSide }));
  banner.position.set(0.12, 1.62, 0);
  banner.rotation.y = Math.PI / 2;
  gantry.add(banner);
  gantry.position.set(sp.x, y, sp.z);
  gantry.rotation.y = heading; // local x along the track, so the beam spans it
  group.add(gantry);

  // Grandstand and pit building beside the longest straight, on whichever side has room
  const straight = longestStraight(curve, N);
  const mid = curve.getPointAt(straight.t), mt = curve.getTangentAt(straight.t);
  const nrm = new THREE.Vector3(-mt.z, 0, mt.x);
  const centre = curve.getPoints(60).reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / 61);
  const towardCentre = Math.sign(nrm.clone().dot(centre.clone().sub(mid))) || 1;
  const stand = createGrandstand(Math.min(4.2, straight.len * 0.8));
  stand.position.copy(mid).addScaledVector(nrm, towardCentre * (HW + 1.15)).setY(y);
  stand.rotation.y = Math.atan2(-mt.z, mt.x) + (towardCentre > 0 ? Math.PI : 0); // seats face the track
  group.add(stand);
  keepOut.push({ x: stand.position.x, z: stand.position.z, r: 2.2 });
  const ps = curve.getPointAt((straight.t + 0.5) % 1), pt = curve.getTangentAt((straight.t + 0.5) % 1);
  const pn = new THREE.Vector3(-pt.z, 0, pt.x);
  const tc = Math.sign(pn.clone().dot(centre.clone().sub(ps))) || 1;
  const pits = createPits(2.6);
  pits.position.copy(ps).addScaledVector(pn, tc * (HW + 0.9)).setY(y);
  pits.rotation.y = Math.atan2(-pt.z, pt.x) + (tc > 0 ? Math.PI : 0); // garages open onto the track
  group.add(pits);
  keepOut.push({ x: pits.position.x, z: pits.position.z, r: 1.6 });

  // Tyre walls on the outside of the sharpest bends
  for (const [a, b] of runs.slice(0, 6)) {
    const t = ((a + b) / 2) / N, p = curve.getPointAt(t), tg = curve.getTangentAt(t);
    const t2 = curve.getTangentAt((t + 0.01) % 1);
    const turn = Math.sign(tg.x * t2.z - tg.z * t2.x) || 1;
    const out = new THREE.Vector3(tg.z, 0, -tg.x).multiplyScalar(turn);
    for (let k = -2; k <= 2; k++) {
      const tyre = part(new THREE.TorusGeometry(0.09, 0.05, 6, 10), k % 2 ? '#d01818' : '#1b1b1b', { outline: 0 });
      tyre.rotation.x = Math.PI / 2;
      tyre.position.copy(p).addScaledVector(out, HW + 0.62).addScaledVector(tg, k * 0.2).setY(y + 0.06);
      group.add(tyre);
    }
  }

  // Cars: each laps at its own pace, weaving between lines to overtake
  const LIVERIES = [['#dc0000', '#ffd200'], ['#c6c6cc', '#00d2be'], ['#ff8700', '#1e1e1e'], ['#1e41ff', '#ff1e1e'], ['#006f62', '#cedc00'], ['#f5f5f5', '#e10600']];
  const cars = LIVERIES.map(([body, trim], k) => {
    const car = createF1Car(body, trim);
    group.add(car);
    return { car, u: (1 - k * 0.13) % 1, speed: 0.13 + (k % 3) * 0.006 + k * 0.002, lane: (k % 2 ? 1 : -1) * 0.2, wheels: car.userData.wheels };
  });
  let last = null;
  group.userData.animate = (time) => {
    const dt = last == null ? 0 : Math.min(0.05, time - last);
    last = time;
    // Start lights: count up red, then out — repeats every 20 s while the cars lap.
    const cyc = time % 20;
    lights.forEach((l, k) => l.material.color.set(cyc < 5 && cyc > k * 0.8 ? '#ff2020' : '#330000'));
    for (const [k, c] of cars.entries()) {
      const tg0 = curve.getTangentAt(c.u), tg1 = curve.getTangentAt((c.u + 0.01) % 1);
      const bend = tg0.angleTo(tg1);
      const pace = c.speed * (1 - Math.min(0.45, bend * 3)) * (1 + 0.05 * Math.sin(time * 0.37 + k)); // brake for bends
      c.u = (c.u + (pace * dt * 36) / len) % 1;
      const p = curve.getPointAt(c.u), tg = curve.getTangentAt(c.u);
      const lane = c.lane * Math.sin(time * 0.25 + k * 1.7);
      c.car.position.set(p.x - tg.z * lane, y + 0.03, p.z + tg.x * lane);
      c.car.rotation.y = Math.atan2(-tg.z, tg.x);
      for (const w of c.wheels) w.rotation.z -= pace * dt * 900;
    }
  };
  return { group, keepOut };
}

function longestStraight(curve, N) {
  let best = { t: 0, len: 0 }, startI = 0, run = 0;
  for (let i = 0; i < N * 2; i++) {
    const a = curve.getTangentAt((i % N) / N), b = curve.getTangentAt(((i + 2) % N) / N);
    if (a.angleTo(b) < 0.05) run++;
    else { if (run > best.len) best = { i0: startI, len: run }; run = 0; startI = i + 1; }
  }
  if (run > best.len) best = { i0: startI, len: run };
  const L = curve.getLength();
  return { t: (((best.i0 ?? 0) + best.len / 2) % N) / N, len: (best.len / N) * L };
}

function signTexture(text, bg, fg = '#ffffff') {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, 512, 96);
  x.font = '400 64px "Lilita One", system-ui, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = fg; x.fillText(text, 256, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function crowdTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#3a4250'; x.fillRect(0, 0, 256, 64);
  const cols = ['#e10600', '#ffd200', '#ffffff', '#1e41ff', '#ff8700', '#00d2be', '#ff6fb5'];
  for (let i = 0; i < 700; i++) { x.fillStyle = cols[i % cols.length]; x.fillRect(Math.random() * 256, Math.random() * 64, 3, 4); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function createGrandstand(width) {
  const g = new THREE.Group();
  const crowd = new THREE.MeshLambertMaterial({ map: crowdTexture() });
  for (let k = 0; k < 4; k++) {
    const tier = new THREE.Mesh(new THREE.BoxGeometry(width, 0.22, 0.32), [toon('#d9dde3'), toon('#d9dde3'), crowd, toon('#d9dde3'), crowd, toon('#d9dde3')]);
    tier.position.set(0, 0.11 + k * 0.22, -k * 0.3);
    tier.castShadow = true;
    g.add(tier);
  }
  const roof = part(box(width + 0.2, 0.05, 0.45, 0.02), '#f2f2f2', { outline: 0.012 }); // canopy over the back rows only
  roof.position.set(0, 1.25, -1.0);
  roof.rotation.x = -0.15;
  g.add(roof);
  for (const s of [-1, 1]) { const post = part(new THREE.BoxGeometry(0.06, 1.3, 0.06), '#9aa3ad', { outline: 0 }); post.position.set(s * width / 2, 0.65, -1.15); g.add(post); }
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.8, 0.22), new THREE.MeshBasicMaterial({ map: signTexture('PODIUM  ·  F1', '#15151e') }));
  sign.position.set(0, 1.5, -0.1);
  g.add(sign);
  // Seats face local +z
  const holder = new THREE.Group();
  g.position.z = 0.45;
  holder.add(g);
  return holder;
}

function createPits(len) {
  const g = new THREE.Group();
  const bldg = part(box(len, 0.55, 0.8), '#eef1f4', { outline: 0.02 });
  bldg.position.y = 0.28;
  g.add(bldg);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(len * 0.95, 0.14, 0.82), glow('#2a6fdb', 0.35));
  glass.position.y = 0.44;
  g.add(glass);
  for (let k = 0; k < 6; k++) {
    const door = new THREE.Mesh(new THREE.PlaneGeometry(len / 7.5, 0.26), toon(k % 2 ? '#e10600' : '#2b2b33'));
    door.position.set(-len / 2 + (k + 0.5) * (len / 6), 0.15, 0.405);
    g.add(door);
  }
  const roofSign = new THREE.Mesh(new THREE.PlaneGeometry(len * 0.6, 0.2), new THREE.MeshBasicMaterial({ map: signTexture('PIT LANE', '#e10600') }));
  roofSign.position.set(0, 0.68, 0.2);
  roofSign.rotation.x = -0.6;
  g.add(roofSign);
  return g;
}

function createF1Car(body, trim) {
  const car = new THREE.Group();
  const s = 0.42; // scale: about 1.1 units long
  const add = (geo, color, x, y, z, ol = 0.012) => { const m = part(geo, color, { outline: ol }); m.position.set(x * s, y * s, z * s); car.add(m); return m; };
  add(box(1.6, 0.22, 0.42, 0.08), body, 0, 0.32, 0); // monocoque
  add(new THREE.ConeGeometry(0.13, 0.9, 8), body, 1.15, 0.28, 0).rotation.z = -Math.PI / 2; // nose
  add(box(0.5, 0.2, 0.95, 0.06), body, -0.15, 0.3, 0); // sidepods
  add(box(0.6, 0.18, 0.3, 0.06), trim, -0.45, 0.46, 0); // engine cover
  add(new THREE.SphereGeometry(0.12, 10, 8), '#ffd200', 0.25, 0.5, 0); // helmet
  add(box(0.08, 0.04, 1.15, 0.02), trim, 1.55, 0.18, 0); // front wing
  add(box(0.22, 0.06, 0.95, 0.02), trim, -1.0, 0.75, 0); // rear wing
  for (const zz of [-0.3, 0.3]) add(new THREE.BoxGeometry(0.06, 0.4, 0.04), '#1b1b1b', -0.98, 0.55, zz, 0);
  const wheels = [];
  for (const [xx, zz] of [[0.95, 0.52], [0.95, -0.52], [-0.85, 0.55], [-0.85, -0.55]]) {
    const w = add(new THREE.CylinderGeometry(0.2, 0.2, 0.2, 14), '#151515', xx, 0.2, zz, 0.01);
    w.rotation.x = Math.PI / 2;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.21, 8), toon('#c9c9c9'));
    w.add(hub);
    const holder = new THREE.Group(); // spin about the axle
    holder.position.copy(w.position);
    car.remove(w);
    w.position.set(0, 0, 0);
    holder.add(w);
    car.add(holder);
    wheels.push(holder);
  }
  car.userData.wheels = wheels;
  return car;
}

// ---------- Hotel ----------
function createHotel(size) {
  const root = new THREE.Group();
  const g = new THREE.Group();
  g.scale.setScalar(size);
  root.add(g);
  // Podium: a curved low-rise wing hugging the pool, glass bands lit warm
  const arc = new THREE.Shape();
  const R0 = 2.0, R1 = 2.9, a0 = Math.PI * 0.12, a1 = Math.PI * 0.88;
  arc.absarc(0, 0, R1, a0, a1, false);
  arc.absarc(0, 0, R0, a1, a0, true);
  const wing = part(new THREE.ExtrudeGeometry(arc, { depth: 0.9, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2 }), '#f7f3ea', { outline: 0.02 });
  wing.rotation.x = -Math.PI / 2;
  wing.position.set(0, 0, 0.9);
  g.add(wing);
  for (let k = 0; k < 3; k++) {
    const band = new THREE.Shape();
    band.absarc(0, 0, R1 + 0.02, a0 + 0.02, a1 - 0.02, false);
    band.absarc(0, 0, R1 - 0.05, a1 - 0.02, a0 + 0.02, true);
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(band, { depth: 0.1, bevelEnabled: false }), glow('#ffcf7a', 0.5));
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, 0.18 + k * 0.26, 0.9);
    g.add(m);
  }
  // Infinity pool and deck in the curve, with sun loungers
  const deck = part(box(3.6, 0.08, 1.9, 0.04), '#d7b98a', { outline: 0.012 });
  deck.position.set(0, 0.04, 0.25);
  g.add(deck);
  const poolMat = toon('#22c3e6', { emissive: new THREE.Color('#0aa5c8'), emissiveIntensity: 0.25 });
  const pool = new THREE.Mesh(box(2.6, 0.06, 1.0, 0.03), poolMat.clone());
  pool.position.set(0, 0.07, 0.35);
  g.add(pool);
  for (let k = 0; k < 6; k++) {
    const lounger = part(box(0.14, 0.05, 0.36, 0.02), '#ffffff', { outline: 0.006 });
    lounger.position.set(-1.25 + k * 0.5, 0.11, 1.05);
    g.add(lounger);
    if (k % 2 === 0) {
      const umb = part(new THREE.ConeGeometry(0.17, 0.08, 10), k % 4 ? '#ffffff' : '#0a7ea4', { outline: 0.006 });
      umb.position.set(-1.0 + k * 0.5, 0.52, 1.0);
      g.add(umb);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.45, 5), toon('#dddddd'));
      pole.position.set(-1.0 + k * 0.5, 0.3, 1.0);
      g.add(pole);
    }
  }
  // The sail tower behind the pool: white sail, steel spine, gold crown, cantilevered helipad.
  // Built in the sail's own frame (x along the silhouette, y up, z through its thickness), turned to face the camera.
  const TH = 3.0; // tower height before scaling
  const sail = new THREE.Shape();
  sail.moveTo(-0.5, 0);
  sail.lineTo(0.7, 0);
  sail.quadraticCurveTo(0.95, TH * 0.5, 0.05, TH);
  sail.lineTo(-0.5, TH * 0.93);
  sail.closePath();
  const towerG = new THREE.Group();
  towerG.position.set(0, 0, -0.75);
  towerG.rotation.y = 0.3;
  g.add(towerG);
  towerG.add(part(new THREE.ExtrudeGeometry(sail, { depth: 0.8, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 3 }), '#fbfbff', { outline: 0.025 }));
  const glassFace = new THREE.Mesh(new THREE.ShapeGeometry(sail), glow('#8cc4ee', 0.3));
  glassFace.scale.set(0.8, 0.9, 1);
  glassFace.position.set(0.04, 0.12, 0.87);
  towerG.add(glassFace);
  for (let k = 1; k < 9; k++) { // floor lines across the glass
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.9 - k * 0.07, 0.025), toon('#ffffff'));
    fl.position.set(0.12 - k * 0.02, k * (TH * 0.1), 0.88);
    towerG.add(fl);
  }
  for (const zz of [0.05, 0.75]) {
    const spine = part(new THREE.CylinderGeometry(0.05, 0.08, TH * 1.08, 6), '#cfd6de', { outline: 0.012 });
    spine.position.set(-0.62, TH * 0.54, zz);
    spine.rotation.z = -0.05;
    towerG.add(spine);
  }
  const crown = part(new THREE.ConeGeometry(0.1, 0.5, 8), '#ffcf33', { outline: 0.01 });
  crown.position.set(-0.6, TH * 1.1, 0.4);
  towerG.add(crown);
  const padY = TH * 0.8;
  const helipad = part(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 24), '#2c2f36', { outline: 0.012 });
  helipad.position.set(0.85, padY, 0.4);
  towerG.add(helipad);
  const hMark = new THREE.Mesh(new THREE.CircleGeometry(0.38, 24), new THREE.MeshBasicMaterial({ map: helipadTexture() }));
  hMark.rotation.x = -Math.PI / 2;
  hMark.position.set(0.85, padY + 0.03, 0.4);
  towerG.add(hMark);
  const strut = part(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 5), '#cfd6de', { outline: 0 });
  strut.position.set(0.55, padY - 0.25, 0.4);
  strut.rotation.z = 0.9;
  towerG.add(strut);
  const heli = createHelicopter();
  heli.position.set(0.85, padY + 0.03, 0.4);
  heli.scale.setScalar(0.8);
  towerG.add(heli);
  // Fountain on the forecourt
  const basin = part(new THREE.CylinderGeometry(0.42, 0.46, 0.12, 20), '#e8e2d4', { outline: 0.01 });
  basin.position.set(0, 0.06, 2.35);
  g.add(basin);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.02, 20), toon('#3fd0f0', { emissive: new THREE.Color('#1aa8d0'), emissiveIntensity: 0.3 }));
  water.position.set(0, 0.12, 2.35);
  g.add(water);
  const jets = [];
  for (let k = 0; k < 5; k++) {
    const jet = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.6, 6), new THREE.MeshBasicMaterial({ color: '#d8f6ff', transparent: true, opacity: 0.8 }));
    const a = (k / 5) * Math.PI * 2;
    jet.position.set(k ? Math.cos(a) * 0.2 : 0, 0.42, 2.35 + (k ? Math.sin(a) * 0.2 : 0));
    g.add(jet); jets.push(jet);
  }
  // Seven-star sign
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.42), new THREE.MeshBasicMaterial({ map: hotelSignTexture(), transparent: true }));
  sign.position.set(0, 0.42, 2.85);
  sign.rotation.x = -0.5;
  g.add(sign);
  const plinth = part(box(2.5, 0.25, 0.2, 0.04), '#1a2a4a', { outline: 0.01 });
  plinth.position.set(0, 0.12, 2.8);
  g.add(plinth);

  root.userData.animate = (t) => {
    heli.userData.rotor.rotation.y = t * 18;
    heli.userData.tail.rotation.x = t * 30;
    jets.forEach((j, k) => { const s = 0.75 + 0.25 * Math.sin(t * 6 + k); j.scale.set(1, s, 1); j.position.y = 0.12 + 0.3 * s; });
    pool.material.emissiveIntensity = 0.22 + 0.08 * Math.sin(t * 2);
  };
  return root;
}

function createHelicopter() {
  const h = new THREE.Group();
  const body = part(new THREE.SphereGeometry(0.16, 12, 10), '#111827', { outline: 0.008 });
  body.scale.set(1.5, 0.9, 1);
  body.position.y = 0.16;
  h.add(body);
  const tailBoom = part(new THREE.CylinderGeometry(0.025, 0.04, 0.5, 6), '#111827', { outline: 0.006 });
  tailBoom.rotation.z = Math.PI / 2;
  tailBoom.position.set(-0.4, 0.2, 0);
  h.add(tailBoom);
  const rotor = new THREE.Group();
  for (const r of [0, Math.PI / 2]) { const blade = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.01, 0.04), toon('#cfd6de')); blade.rotation.y = r; rotor.add(blade); }
  rotor.position.y = 0.32;
  h.add(rotor);
  const tail = new THREE.Group();
  const tb = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.22, 0.03), toon('#cfd6de'));
  tail.add(tb);
  tail.position.set(-0.64, 0.22, 0.03);
  h.add(tail);
  for (const s of [-1, 1]) { const skid = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.02, 0.02), toon('#9aa3ad')); skid.position.set(0, 0.01, s * 0.1); h.add(skid); }
  h.userData.rotor = rotor;
  h.userData.tail = tail;
  return h;
}

function helipadTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#2c2f36'; x.beginPath(); x.arc(64, 64, 64, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#ffd200'; x.lineWidth = 6; x.beginPath(); x.arc(64, 64, 52, 0, Math.PI * 2); x.stroke();
  x.fillStyle = '#ffffff'; x.font = '900 64px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('H', 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function hotelSignTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const x = c.getContext('2d');
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '400 44px "Lilita One", system-ui, sans-serif';
  x.lineWidth = 8; x.strokeStyle = '#1a2a4a'; x.strokeText('LE GRAND AZUR', 256, 34);
  x.fillStyle = '#ffd96a'; x.fillText('LE GRAND AZUR', 256, 34);
  x.font = '28px system-ui, sans-serif';
  x.fillStyle = '#ffd200'; x.fillText('★ ★ ★ ★ ★ ★ ★', 256, 76);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
