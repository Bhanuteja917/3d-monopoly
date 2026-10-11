// Golf course in the middle of the circuit: mown grass, fairways, greens with flags, bunkers and a pond.
// The flat parts are painted on one canvas laid over the infield; flags, balls, tee markers and a cart are 3D.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { part, toon } from './models.js';
import { pointInPolygon } from './track.js';

const PX = 36; // canvas pixels per board unit

/**
 * poly: the circuit's centre line (infield outline) as [x, z] points.
 * clearance(x, z): free distance from the track and landmark spots.
 * Returns { group, decor, keepOut } — keepOut circles stop trees landing on the course.
 */
export function buildGolfCourse(poly, clearance, y = -0.115) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of poly) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const w = maxX - minX, d = maxZ - minZ;
  const scale = Math.min(PX, 2048 / Math.max(w, d));

  // Free spots inside the circuit.
  const grid = [];
  for (let x = minX; x <= maxX; x += 0.6) for (let z = minZ; z <= maxZ; z += 0.6) {
    if (!pointInPolygon(x, z, poly)) continue;
    const c = clearance(x, z);
    if (c > 1.2) grid.push({ x, z, c });
  }
  const clearAlong = (a, b) => {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5);
    let m = Infinity;
    for (let k = 0; k <= n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n, z = a.z + ((b.z - a.z) * k) / n;
      if (!pointInPolygon(x, z, poly)) return 0;
      m = Math.min(m, clearance(x, z));
    }
    return m;
  };

  // Greens in the roomiest spots, each with the longest clear fairway back to a tee.
  const holes = [];
  const near = (p, r) => holes.some((h) => Math.hypot(h.green.x - p.x, h.green.z - p.z) < r
    || (h.tee && segDist(p, h.tee, h.green) < r * 0.45));
  for (const g of [...grid].sort((a, b) => b.c - a.c)) {
    if (holes.length >= 6) break;
    if (g.c < 2.1 || near(g, 7)) continue;
    let tee = null, fw = 0;
    for (const t of grid) {
      const len = Math.hypot(t.x - g.x, t.z - g.z);
      if (len < 6 || len > 16 || t.c < 1.4 || near(t, 3.5)) continue;
      const c = clearAlong(g, t);
      if (c < 1.2) continue;
      if (!tee || len > Math.hypot(tee.x - g.x, tee.z - g.z)) { tee = t; fw = c; }
    }
    holes.push({ green: g, tee, half: Math.min(1.5, fw - 0.25), r: Math.min(1.35, g.c - 0.7) });
  }
  // Pond in the biggest spot left over.
  const pond = grid.filter((p) => p.c > 2.3 && !near(p, 4.2)).sort((a, b) => b.c - a.c)[0];
  const pondR = pond ? Math.min(2.6, pond.c - 0.9) : 0;

  // ---- Paint ----
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * scale);
  canvas.height = Math.ceil(d * scale);
  const g = canvas.getContext('2d');
  const P = (x, z) => [(x - minX) * scale, (z - minZ) * scale];
  const rnd = rng(poly.length * 7919 + Math.round(w * 13));
  for (const h of holes) {
    if (!h.tee) continue;
    const len = Math.hypot(h.green.x - h.tee.x, h.green.z - h.tee.z);
    h.dir = { x: (h.green.x - h.tee.x) / len, z: (h.green.z - h.tee.z) / len };
  }
  g.save();
  g.beginPath();
  poly.forEach(([x, z], k) => g[k ? 'lineTo' : 'moveTo'](...P(x, z)));
  g.closePath();
  g.clip();

  // Rough: deep green with soft patches, faint mowing passes and grass texture
  g.fillStyle = '#5c9a3a';
  g.fillRect(0, 0, canvas.width, canvas.height);
  for (let k = 0; k < (w * d) / 6; k++) {
    const x = rnd() * canvas.width, y = rnd() * canvas.height, r = (1 + rnd() * 3) * scale;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const c = rnd() < 0.5 ? '40,90,25' : '150,200,90';
    grd.addColorStop(0, `rgba(${c},0.16)`); grd.addColorStop(1, `rgba(${c},0)`);
    g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  stripes(g, canvas.width, canvas.height, 0.6, 2.2 * scale, 'rgba(255,255,255,0.045)');
  grassTexture(g, canvas.width, canvas.height, scale, rnd, ['#4f8a30', '#6aa847', '#79b552', '#467f2a'], 0.35);

  // Cart paths: a winding concrete path from each green to the next tee
  const tees = holes.filter((h) => h.tee);
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (let k = 0; k + 1 < tees.length; k++) {
    const a = P(tees[k].green.x, tees[k].green.z), b = P(tees[k + 1].tee.x, tees[k + 1].tee.z);
    const mx = (a[0] + b[0]) / 2 + (b[1] - a[1]) * 0.18, my = (a[1] + b[1]) / 2 - (b[0] - a[0]) * 0.18;
    for (const [lw, col] of [[0.62, '#8e8a7d'], [0.5, '#d6d0c0']]) {
      g.strokeStyle = col; g.lineWidth = lw * scale;
      g.beginPath(); g.moveTo(...a); g.quadraticCurveTo(mx, my, ...b); g.stroke();
    }
  }

  for (const h of holes) {
    if (!h.tee) continue;
    const a = P(h.tee.x, h.tee.z), b = P(h.green.x, h.green.z);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
    // Fairway: organic outline that swells and narrows, with a first-cut collar around it
    const ph = rnd() * 6, ph2 = rnd() * 6;
    const outline = (grow) => {
      const half = (f) => (h.half * (0.82 + 0.18 * Math.sin(f * Math.PI * 2.2 + ph) + 0.08 * Math.sin(f * 9 + ph2)) + grow) * scale;
      const pts = [], n = 28;
      for (let k = 0; k <= n; k++) { const f = k / n; pts.push([a[0] + ux * len * f - uy * half(f), a[1] + uy * len * f + ux * half(f)]); }
      for (let k = n; k >= 0; k--) { const f = k / n; pts.push([a[0] + ux * len * f + uy * half(f), a[1] + uy * len * f - ux * half(f)]); }
      g.beginPath();
      pts.forEach((pt, k) => g[k ? 'lineTo' : 'moveTo'](...pt));
      g.closePath();
    };
    g.fillStyle = '#6bab45';
    outline(0.35);
    g.fill();
    // Fairway with alternating light/dark mowing bands across it and a faint crosscut along it
    outline(0);
    g.save();
    g.clip();
    g.fillStyle = '#86c65a'; g.fillRect(0, 0, canvas.width, canvas.height);
    g.translate(...a); g.rotate(Math.atan2(uy, ux));
    const bandW = 1.3 * scale;
    for (let s0 = -bandW, k = 0; s0 < len + bandW; s0 += bandW, k++) {
      g.fillStyle = k % 2 ? 'rgba(255,255,255,0.09)' : 'rgba(0,40,0,0.06)';
      g.fillRect(s0, -h.half * 2 * scale, bandW, h.half * 4 * scale);
    }
    g.fillStyle = 'rgba(255,255,255,0.035)';
    for (let k = -4; k <= 4; k += 2) g.fillRect(-bandW, k * 0.35 * scale, len + 2 * bandW, 0.35 * scale);
    g.restore();
    // Tee box: short, neat grass with a darker edge
    g.save();
    g.translate(...a);
    g.rotate(Math.atan2(uy, ux));
    g.fillStyle = '#4f8f34';
    roundRect(g, -0.85 * scale, -0.65 * scale, 1.7 * scale, 1.3 * scale, 0.2 * scale); g.fill();
    g.fillStyle = '#9ad46a';
    roundRect(g, -0.75 * scale, -0.55 * scale, 1.5 * scale, 1.1 * scale, 0.15 * scale); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.08)';
    for (let k = 0; k < 3; k++) g.fillRect((-0.75 + k * 0.5) * scale, -0.55 * scale, 0.25 * scale, 1.1 * scale);
    g.restore();
  }
  for (const h of holes) {
    const [cx, cy] = P(h.green.x, h.green.z);
    const dir = h.dir || { x: 1, z: 0 };
    // Sand traps: kidney shapes with a dark lip, shading towards the far edge and rake lines
    for (const side of [1, -1]) {
      const bx = h.green.x - dir.x * 0.5 * h.r + -dir.z * side * (h.r + 0.6);
      const bz = h.green.z - dir.z * 0.5 * h.r + dir.x * side * (h.r + 0.6);
      if (clearance(bx, bz) < 0.8) continue;
      const [px, py] = P(bx, bz);
      g.save();
      g.translate(px, py);
      g.rotate(Math.atan2(dir.z, dir.x) + side * 0.5);
      const shape = blobPath(0.8 * scale, 0.48 * scale, rnd() * 6, 0.18);
      g.fillStyle = '#4d7f2e'; g.save(); g.translate(0, -0.06 * scale); g.fill(shape(1.12)); g.restore(); // grass lip shadow
      const grd = g.createLinearGradient(0, -0.5 * scale, 0, 0.5 * scale);
      grd.addColorStop(0, '#c9ae6c'); grd.addColorStop(0.35, '#ecd9a2'); grd.addColorStop(1, '#f6e8bf');
      g.fillStyle = grd; g.fill(shape(1));
      g.save(); g.clip(shape(1));
      g.strokeStyle = 'rgba(150,120,60,0.22)'; g.lineWidth = 0.035 * scale;
      for (let k = -6; k <= 6; k++) { g.beginPath(); g.moveTo(-scale, k * 0.09 * scale); g.quadraticCurveTo(0, k * 0.09 * scale + 0.08 * scale, scale, k * 0.09 * scale); g.stroke(); }
      g.restore();
      g.restore();
    }
    // Fringe (collar), the putting surface with fine stripes, and the cup
    g.save();
    g.translate(cx, cy);
    const green = blobPath(h.r * scale, h.r * 0.85 * scale, rnd() * 6, 0.1);
    g.fillStyle = '#6fb447'; g.fill(green(1.22));
    const grd = g.createRadialGradient(-h.r * 0.3 * scale, -h.r * 0.3 * scale, 0, 0, 0, h.r * 1.2 * scale);
    grd.addColorStop(0, '#b6ec86'); grd.addColorStop(1, '#93d564');
    g.fillStyle = grd; g.fill(green(1));
    g.save(); g.clip(green(1));
    g.rotate(Math.atan2(dir.z, dir.x));
    for (let k = -8; k <= 8; k++) { g.fillStyle = k % 2 ? 'rgba(255,255,255,0.07)' : 'rgba(0,50,0,0.04)'; g.fillRect(k * 0.3 * scale, -2 * h.r * scale, 0.3 * scale, 4 * h.r * scale); }
    g.restore();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(0, 0, 0.13 * scale, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1d1a14'; g.beginPath(); g.arc(0, 0, 0.1 * scale, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  if (pond) {
    // Water hazard: grassy bank, deep water darkening towards the middle, glints and lily pads
    g.save();
    g.translate(...P(pond.x, pond.z));
    const water = blobPath(pondR * 1.25 * scale, pondR * 0.85 * scale, 1, 0.12);
    g.fillStyle = '#4c7f2c'; g.fill(water(1.12));
    g.fillStyle = '#8c7a4c'; g.fill(water(1.04));
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, pondR * 1.25 * scale);
    grd.addColorStop(0, '#16607e'); grd.addColorStop(0.7, '#2386a8'); grd.addColorStop(1, '#4fb0c8');
    g.fillStyle = grd; g.fill(water(1));
    g.save(); g.clip(water(1));
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 0.05 * scale; g.lineCap = 'round';
    for (let k = 0; k < 9; k++) {
      const x = (rnd() - 0.5) * pondR * 1.8 * scale, y = (rnd() - 0.5) * pondR * 1.1 * scale, l = (0.2 + rnd() * 0.5) * scale;
      g.beginPath(); g.moveTo(x - l, y); g.lineTo(x + l, y); g.stroke();
    }
    for (let k = 0; k < 6; k++) {
      const an = rnd() * Math.PI * 2, rr = pondR * (0.6 + rnd() * 0.3);
      const x = Math.cos(an) * rr * 1.25 * scale, y = Math.sin(an) * rr * 0.85 * scale, r = (0.12 + rnd() * 0.1) * scale;
      g.fillStyle = '#3f8f3a'; g.beginPath(); g.moveTo(x, y); g.arc(x, y, r, an + 0.3, an + Math.PI * 2 - 0.3); g.closePath(); g.fill();
      if (k % 2) { g.fillStyle = '#f4b6d2'; g.beginPath(); g.arc(x, y, r * 0.3, 0, Math.PI * 2); g.fill(); }
    }
    g.restore();
    g.restore();
  }
  g.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const group = new THREE.Group();
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ map: tex, transparent: true }));
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.set(minX + w / 2, y, minZ + d / 2);
  lawn.receiveShadow = true;
  lawn.raycast = () => {};
  group.add(lawn);

  // ---- 3D bits ----
  const decor = [];
  const keepOut = [];
  holes.forEach((h, n) => {
    const flag = createFlag(n + 1);
    flag.position.set(h.green.x, y, h.green.z);
    group.add(flag);
    decor.push(flag);
    keepOut.push({ x: h.green.x, z: h.green.z, r: h.r + 0.9 });
    // A ball sitting on the green
    const ball = part(new THREE.SphereGeometry(0.11, 14, 10), '#ffffff', { outline: 0.02 });
    ball.position.set(h.green.x + h.r * 0.45, y + 0.11, h.green.z + h.r * 0.3);
    group.add(ball);
    if (!h.tee) return;
    for (const side of [1, -1]) {
      const m = part(new THREE.SphereGeometry(0.13, 12, 8), side > 0 ? '#ff5d5d' : '#ffffff', { outline: 0.02 });
      m.position.set(h.tee.x - h.dir.z * side * 0.5, y + 0.12, h.tee.z + h.dir.x * side * 0.5);
      group.add(m);
    }
    const len = Math.hypot(h.green.x - h.tee.x, h.green.z - h.tee.z);
    for (let s = 0; s <= len; s += 1) keepOut.push({ x: h.tee.x + h.dir.x * s, z: h.tee.z + h.dir.z * s, r: h.half + 0.2 });
    // Ball washer and a bench beside the tee
    const sx = -h.dir.z, sz = h.dir.x;
    const wx = h.tee.x - sx * 1.25 - h.dir.x * 0.3, wz = h.tee.z - sz * 1.25 - h.dir.z * 0.3;
    if (clearance(wx, wz) > 0.7) {
      const washer = createBallWasher();
      washer.position.set(wx, y, wz);
      group.add(washer);
    }
    const bx = h.tee.x - sx * 1.5 - h.dir.x * 1.3, bz = h.tee.z - sz * 1.5 - h.dir.z * 1.3;
    if (n % 2 === 0 && clearance(bx, bz) > 0.9) {
      const bench = createBench();
      bench.position.set(bx, y, bz);
      bench.rotation.y = Math.atan2(-h.dir.z, h.dir.x);
      group.add(bench);
      keepOut.push({ x: bx, z: bz, r: 0.8 });
    }
  });
  if (pond) {
    keepOut.push({ x: pond.x, z: pond.z, r: pondR * 1.25 + 0.4 });
    // Reeds and cattails in clumps along the bank
    const rr = rng(Math.round(pond.x * 31 + pond.z * 17));
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + rr() * 0.4;
      const x = pond.x + Math.cos(a) * pondR * 1.25 * 1.02, z = pond.z + Math.sin(a) * pondR * 0.85 * 1.02;
      if (rr() < 0.35) continue;
      const clump = createReeds(rr);
      clump.position.set(x, y, z);
      group.add(clump);
      decor.push(clump);
    }
  }
  // A golf cart parked beside the first tee
  const first = holes.find((h) => h.tee);
  if (first) {
    const cart = createCart();
    const sx = -first.dir.z, sz = first.dir.x;
    const cx = first.tee.x + sx * 1.6 - first.dir.x * 0.4, cz = first.tee.z + sz * 1.6 - first.dir.z * 0.4;
    if (clearance(cx, cz) > 0.9) {
      cart.position.set(cx, y, cz);
      cart.rotation.y = Math.atan2(-first.dir.z, first.dir.x);
      group.add(cart);
      keepOut.push({ x: cx, z: cz, r: 1.1 });
    }
  }
  return { group, decor, keepOut };
}

// Small seeded random generator, so the course looks the same every time it is drawn.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Diagonal mowing passes over the whole canvas.
function stripes(g, W, H, angle, band, color) {
  g.save();
  g.translate(W / 2, H / 2);
  g.rotate(angle);
  g.fillStyle = color;
  const R = Math.hypot(W, H);
  for (let x = -R; x < R; x += band * 2) g.fillRect(x, -R, band, R * 2);
  g.restore();
}

// Grass blades: short strokes in a few greens.
function grassTexture(g, W, H, scale, rnd, colors, alpha) {
  g.save();
  g.globalAlpha = alpha;
  g.lineWidth = Math.max(1, scale * 0.04);
  g.lineCap = 'round';
  const n = Math.min(60000, Math.round((W * H) / (scale * scale) * 30));
  for (let k = 0; k < n; k++) {
    const x = rnd() * W, y = rnd() * H, l = scale * (0.08 + rnd() * 0.1);
    g.strokeStyle = colors[k % colors.length];
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * l * 0.6, y - l); g.stroke();
  }
  g.restore();
}

// Irregular rounded blob around the origin (rx x ry), returned as a function of a grow factor.
function blobPath(rx, ry, phase, wobble) {
  return (k) => {
    const p = new Path2D();
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const r = k * (1 + Math.sin(a * 3 + phase) * wobble + Math.cos(a * 2 + phase * 0.7) * wobble * 0.6);
      p[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rx * r, Math.sin(a) * ry * r);
    }
    p.closePath();
    return p;
  };
}

function segDist(p, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Pin: thin white flagstick with a rectangular numbered flag that waves in the wind.
function createFlag(num) {
  const root = new THREE.Group();
  const pole = part(new THREE.CylinderGeometry(0.025, 0.025, 2.1, 8), '#ffffff', { outline: 0.012 });
  pole.position.y = 1.05;
  root.add(pole);
  for (let k = 0; k < 4; k++) { // red bands near the top, like a real pin
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.1, 8), toon('#e23b3b'));
    band.position.y = 1.0 + k * 0.2;
    root.add(band);
  }
  const c = document.createElement('canvas');
  c.width = 128; c.height = 88;
  const x = c.getContext('2d');
  x.fillStyle = '#ffd23f';
  x.fillRect(0, 0, 128, 88);
  x.fillStyle = 'rgba(0,0,0,0.08)';
  x.fillRect(0, 70, 128, 18);
  x.fillStyle = '#1d1530';
  x.font = '400 54px "Lilita One", system-ui, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(String(num), 64, 44);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.52, 10, 4), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
  cloth.geometry.translate(0.375, 0, 0);
  cloth.position.y = 1.82;
  cloth.castShadow = true;
  root.add(cloth);
  const base = cloth.geometry.attributes.position.array.slice();
  const phase = num * 1.7;
  root.userData.animate = (t) => {
    const pos = cloth.geometry.attributes.position;
    const gust = 0.75 + 0.25 * Math.sin(t * 0.6 + phase);
    for (let k = 0; k < pos.count; k++) {
      const px = base[k * 3], py = base[k * 3 + 1];
      pos.array[k * 3 + 2] = Math.sin(t * 6 * gust - px * 7 + phase) * 0.07 * px * 1.6;
      pos.array[k * 3 + 1] = py - px * px * 0.12 * (1 - gust); // droops when the wind drops
    }
    pos.needsUpdate = true;
    cloth.geometry.computeVertexNormals();
  };
  return root;
}

function createBallWasher() {
  const root = new THREE.Group();
  const post = part(new THREE.CylinderGeometry(0.04, 0.05, 0.75, 8), '#2f6b3a', { outline: 0.012 });
  post.position.y = 0.375;
  const head = part(new RoundedBoxGeometry(0.22, 0.3, 0.18, 2, 0.04), '#2f6b3a', { outline: 0.015 });
  head.position.y = 0.85;
  const knob = part(new THREE.SphereGeometry(0.05, 8, 6), '#ffd23f', { outline: 0.01 });
  knob.position.y = 1.03;
  root.add(post, head, knob);
  return root;
}

function createBench() {
  const root = new THREE.Group();
  const wood = '#a8723f';
  for (const zz of [-0.12, 0, 0.12]) {
    const slat = part(new RoundedBoxGeometry(1.1, 0.04, 0.1, 2, 0.015), wood, { outline: 0.01 });
    slat.position.set(0, 0.42, zz);
    root.add(slat);
  }
  for (const yy of [0.62, 0.76]) {
    const back = part(new RoundedBoxGeometry(1.1, 0.09, 0.04, 2, 0.015), wood, { outline: 0.01 });
    back.position.set(0, yy, -0.2);
    root.add(back);
  }
  for (const xx of [-0.48, 0.48]) {
    const leg = part(new THREE.BoxGeometry(0.06, 0.8, 0.42), '#3a3a3a', { outline: 0.01 });
    leg.position.set(xx, 0.4, -0.04);
    root.add(leg);
  }
  return root;
}

// A clump of reeds with a couple of cattails; sways gently.
function createReeds(rnd) {
  const root = new THREE.Group();
  const blades = [];
  for (let k = 0; k < 7; k++) {
    const h = 0.6 + rnd() * 0.6;
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.035, h, 4), toon(rnd() < 0.5 ? '#4f8a30' : '#6aa847'));
    blade.geometry.translate(0, h / 2, 0);
    blade.position.set((rnd() - 0.5) * 0.4, 0, (rnd() - 0.5) * 0.3);
    blade.rotation.set((rnd() - 0.5) * 0.4, 0, (rnd() - 0.5) * 0.5);
    root.add(blade);
    blades.push({ m: blade, rz: blade.rotation.z, ph: rnd() * 6 });
    if (k < 2) {
      const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.16, 3, 6), toon('#6b4226'));
      tail.position.y = h * 0.85;
      blade.add(tail);
    }
  }
  root.userData.animate = (t) => { for (const b of blades) b.m.rotation.z = b.rz + Math.sin(t * 1.6 + b.ph) * 0.06; };
  return root;
}

function createCart() {
  const root = new THREE.Group();
  const box = (x, y, z) => new RoundedBoxGeometry(x, y, z, 3, Math.min(0.08, x / 2.1, y / 2.1, z / 2.1));
  const body = part(box(1.3, 0.35, 0.75), '#ffffff', { outline: 0.03 });
  body.position.y = 0.38;
  root.add(body);
  const seat = part(box(0.45, 0.3, 0.7), '#2fae5a', { outline: 0.02 });
  seat.position.set(-0.1, 0.65, 0);
  root.add(seat);
  const roof = part(box(1.1, 0.08, 0.85), '#2fae5a', { outline: 0.02 });
  roof.position.set(0.05, 1.35, 0);
  root.add(roof);
  for (const [px, pz] of [[0.5, 0.3], [0.5, -0.3], [-0.4, 0.3], [-0.4, -0.3]]) {
    const post = part(new THREE.CylinderGeometry(0.03, 0.03, 0.75, 6), '#dddddd', { outline: 0 });
    post.position.set(px, 0.95, pz);
    root.add(post);
  }
  const bag = part(new THREE.CylinderGeometry(0.13, 0.13, 0.55, 10), '#ff5d5d', { outline: 0.02 });
  bag.position.set(-0.55, 0.75, 0);
  bag.rotation.z = 0.35;
  root.add(bag);
  for (const [px, pz] of [[0.42, 0.38], [0.42, -0.38], [-0.42, 0.38], [-0.42, -0.38]]) {
    const wheel = part(new THREE.CylinderGeometry(0.17, 0.17, 0.12, 14), toon('#222222'), { outline: 0.02 });
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(px, 0.17, pz);
    root.add(wheel);
  }
  return root;
}
