// City landmarks and utility scenes: chunky low-poly dioramas placed just outside each board tile,
// and rendered to thumbnails for the property card.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { part, toon, createTree } from './models.js';

// ---------- tiny builders ----------
const at = (o, x = 0, y = 0, z = 0) => { o.position.set(x, y, z); return o; };
const rot = (o, x = 0, y = 0, z = 0) => { o.rotation.set(x, y, z); return o; };
const RB = (w, h, d, r = 0.05) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.1, h / 2.1, d / 2.1));
const glow = (c, i = 0.8) => toon(c, { emissive: new THREE.Color(c), emissiveIntensity: i });

function kit(g) {
  const add = (o) => { g.add(o); return o; };
  return {
    add,
    box: (w, h, d, c, x = 0, y = 0, z = 0, r = 0.05, ol = 0.025) => add(at(part(RB(w, h, d, r), c, { outline: ol }), x, y + h / 2, z)),
    cyl: (rt, rb, h, c, x = 0, y = 0, z = 0, s = 16, ol = 0.025) => add(at(part(new THREE.CylinderGeometry(rt, rb, h, s), c, { outline: ol }), x, y + h / 2, z)),
    cone: (r, h, c, x = 0, y = 0, z = 0, s = 16, ol = 0.025) => add(at(part(new THREE.ConeGeometry(r, h, s), c, { outline: ol }), x, y + h / 2, z)),
    sph: (r, c, x = 0, y = 0, z = 0, ol = 0.025) => add(at(part(new THREE.SphereGeometry(r, 16, 12), c, { outline: ol }), x, y, z)),
    dome: (r, c, x = 0, y = 0, z = 0, ol = 0.025) => add(at(part(new THREE.SphereGeometry(r, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), c, { outline: ol }), x, y, z)),
    torus: (r, t, c, x = 0, y = 0, z = 0, arc = Math.PI * 2, ol = 0.02) => add(at(part(new THREE.TorusGeometry(r, t, 8, 24, arc), c, { outline: ol }), x, y, z)),
    raw: (geo, mat, x = 0, y = 0, z = 0) => add(at(new THREE.Mesh(geo, typeof mat === 'string' ? toon(mat) : mat), x, y, z)),
  };
}
function windowsOn(g, w, h, d, y0, color, rows, cols = 2) {
  const mat = glow(color, 0.45);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry((w / cols) * 0.45, (h / rows) * 0.45, 0.02), mat);
    m.position.set((c - (cols - 1) / 2) * (w / cols), y0 + (r + 0.5) * (h / rows), d / 2 + 0.012);
    g.add(m);
  }
}
function signTexture(text, bg = null, fg = '#ffffff', stroke = '#1d1530') {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const x = c.getContext('2d');
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, 512, 128); }
  x.font = '400 92px "Lilita One", system-ui, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 16; x.lineJoin = 'round'; x.strokeStyle = stroke; x.strokeText(text, 256, 68);
  x.fillStyle = fg; x.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- reusable landmark shapes ----------
const L = {
  obelisk(g, { color = '#f4efe6', tip = null, h = 2.2 } = {}) {
    const k = kit(g);
    k.box(0.5, 0.18, 0.5, '#d9cdb4');
    k.cyl(0.11, 0.19, h, color, 0, 0.18, 0, 4);
    g.children.at(-1).rotation.y = Math.PI / 4;
    if (tip) k.cone(0.16, 0.3, tip, 0, h + 0.18, 0, 8); else k.cone(0.12, 0.22, color, 0, h + 0.18, 0, 4);
  },
  skyline(g, { colors = ['#8fd3ff', '#5b7fa6', '#b9c6d6'], hs = [1.6, 2.2, 1.2] } = {}) {
    const k = kit(g);
    hs.forEach((h, i) => {
      const x = (i - 1) * 0.42;
      k.box(0.36, h, 0.36, colors[i % colors.length], x, 0, (i % 2) * 0.15 - 0.07);
      windowsOn(g.children.at(-1), 0.36, h * 0.85, 0, -h / 2 + 0.08, '#fff3c4', Math.round(h * 3), 2);
    });
  },
  church(g, { wall = '#f3e2c2', roof = '#c9583d', towers = 2, domes = false } = {}) {
    const k = kit(g);
    k.box(0.75, 0.6, 0.6, wall);
    k.cone(0.55, 0.35, roof, 0, 0.6, 0, 4);
    g.children.at(-1).rotation.y = Math.PI / 4;
    const xs = towers === 2 ? [-0.32, 0.32] : [0];
    for (const x of xs) {
      k.box(0.24, 1.2, 0.24, wall, x, 0, 0.32);
      if (domes) { k.sph(0.15, roof, x, 1.32, 0.32); k.cone(0.04, 0.2, '#ffd23f', x, 1.42, 0.32, 6); } else k.cone(0.18, 0.45, roof, x, 1.2, 0.32, 4);
    }
    k.box(0.16, 0.3, 0.04, '#7a4a2a', 0, 0, 0.31, 0.03, 0.012);
  },
  stadium(g, { color = '#e63946', seats = '#cfd6e0', arch = false } = {}) {
    const k = kit(g);
    const bowl = k.add(at(part(new THREE.CylinderGeometry(0.75, 0.62, 0.45, 28, 1, true), color, { outline: 0.03 }), 0, 0.225, 0));
    bowl.material = toon(color, { side: THREE.DoubleSide });
    bowl.scale.set(1, 1, 0.75);
    k.raw(new THREE.CylinderGeometry(0.6, 0.6, 0.06, 28), '#5fdc5a', 0, 0.08, 0).scale.set(1, 1, 0.75);
    k.raw(new THREE.BoxGeometry(0.5, 0.01, 0.28), toon('#ffffff'), 0, 0.12, 0);
    k.torus(0.72, 0.04, seats, 0, 0.45, 0).rotation.x = Math.PI / 2;
    g.children.at(-1).scale.set(1, 0.75, 1);
    if (arch) { const a = k.torus(0.75, 0.05, '#f5f5f5', 0, 0.2, 0, Math.PI); a.scale.set(1, 1.6, 1); }
  },
  mountain(g, { color = '#7c8b9e', snow = '#ffffff', flat = false, h = 1.4 } = {}) {
    const k = kit(g);
    if (flat) {
      k.cyl(0.55, 0.85, h * 0.8, color, 0, 0, 0, 7);
      k.cyl(0.56, 0.56, 0.06, '#d8dfe8', 0, h * 0.8, 0, 7);
      [[-0.2, 0.15], [0.25, 0.05], [0, -0.15]].forEach(([x, z]) => k.sph(0.22, '#ffffff', x, h * 0.8 + 0.2, z, 0.015));
    } else {
      k.cone(0.85, h, color, 0, 0, 0, 7);
      k.cone(0.36, h * 0.42, snow, 0, h * 0.58 + 0.01, 0, 7);
      k.cone(0.55, h * 0.75, color, 0.55, 0, -0.2, 7);
    }
  },
  stupa(g, { color = '#f2e9d8', gold = '#ffcf33', h = 2.0 } = {}) {
    const k = kit(g);
    let y = 0;
    for (let i = 0; i < 5; i++) { const w = 1.0 - i * 0.16; k.box(w, 0.16, w, i % 2 ? gold : color, 0, y, 0, 0.03); y += 0.16; }
    k.cone(0.34, h - y, color, 0, y, 0, 12);
    for (const s of [-1, 1]) for (const t of [-1, 1]) k.cone(0.09, 0.7, gold, s * 0.42, 0.32, t * 0.42, 8);
  },
  mosque(g, { wall = '#fbf7ef', dome = '#ffffff', gold = '#ffcf33', minarets = 4 } = {}) {
    const k = kit(g);
    k.box(1.0, 0.4, 0.8, wall);
    k.dome(0.32, dome, 0, 0.4, 0);
    k.cone(0.03, 0.18, gold, 0, 0.72, 0, 6, 0.01);
    for (const [x, z] of [[-0.18, 0.28], [0.18, 0.28]]) k.dome(0.13, dome, x, 0.4, z);
    const ms = minarets === 4 ? [[-0.55, -0.45], [0.55, -0.45], [-0.55, 0.45], [0.55, 0.45]] : [[-0.55, 0.3], [0.55, 0.3]];
    for (const [x, z] of ms) { k.cyl(0.06, 0.07, 1.3, wall, x, 0, z, 10); k.cone(0.07, 0.16, gold, x, 1.3, z, 8, 0.012); }
  },
  statue(g, { color = '#6fc2a5', pedestal = '#c9b48f', arms = 'torch', h = 1.4 } = {}) {
    const k = kit(g);
    k.box(0.55, 0.45, 0.55, pedestal);
    k.cone(0.24, h * 0.7, color, 0, 0.45, 0, 10);
    k.sph(0.13, color, 0, 0.45 + h * 0.7 + 0.08);
    if (arms === 'torch') {
      k.add(rot(at(part(new THREE.CylinderGeometry(0.04, 0.05, 0.55, 8), color, { outline: 0.015 }), 0.15, 0.45 + h * 0.7, 0), 0, 0, -0.3));
      k.raw(new THREE.ConeGeometry(0.07, 0.16, 8), glow('#ffb703', 1), 0.24, 0.45 + h * 0.7 + 0.35, 0);
      for (let i = 0; i < 5; i++) k.cone(0.025, 0.12, color, Math.cos(i * 0.6 - 1.2) * 0.12, 0.45 + h * 0.7 + 0.17, Math.sin(i * 0.6 - 1.2) * 0.12, 4, 0.01);
    } else {
      k.box(1.0, 0.1, 0.12, color, 0, 0.45 + h * 0.62, 0, 0.04); // open arms
    }
  },
  gate(g, { color = '#e9dcc0', cols = 6, quadriga = true } = {}) {
    const k = kit(g);
    k.box(1.5, 0.12, 0.5, color);
    for (let i = 0; i < cols; i++) k.cyl(0.06, 0.06, 0.8, color, -0.65 + i * (1.3 / (cols - 1)), 0.12, 0, 10, 0.015);
    k.box(1.55, 0.22, 0.52, color, 0, 0.92);
    k.box(0.6, 0.18, 0.4, color, 0, 1.14);
    if (quadriga) { k.box(0.3, 0.2, 0.16, '#3f8f6b', 0, 1.32, 0, 0.03); k.sph(0.07, '#3f8f6b', 0, 1.58); }
  },
  clockTower(g, { wall = '#d9b86c', roof = '#3f5d3f', h = 1.8 } = {}) {
    const k = kit(g);
    k.box(0.42, h, 0.42, wall);
    for (let r = 0; r < 4; r++) k.raw(new THREE.BoxGeometry(0.06, h * 0.7, 0.01), toon('#a8894a'), -0.1 + (r % 2) * 0.2, h * 0.4, 0.215);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.15, 20), toon('#fffbe8'));
    at(face, 0, h - 0.25, 0.215); g.add(face);
    k.raw(new THREE.BoxGeometry(0.02, 0.11, 0.01), toon('#222'), 0, h - 0.21, 0.222);
    k.raw(new THREE.BoxGeometry(0.08, 0.02, 0.01), toon('#222'), 0.03, h - 0.25, 0.222);
    k.cone(0.34, 0.6, roof, 0, h, 0, 4);
    g.children.at(-1).rotation.y = Math.PI / 4;
    k.cone(0.03, 0.2, '#ffd23f', 0, h + 0.55, 0, 6, 0.01);
  },
  needle(g, { pod = '#d9d9d9', h = 2.5, color = '#ecebe6', podY = 0.72 } = {}) {
    const k = kit(g);
    k.cyl(0.08, 0.2, h, color, 0, 0, 0, 10);
    k.cyl(0.26, 0.2, 0.22, pod, 0, h * podY, 0, 16);
    k.raw(new THREE.CylinderGeometry(0.265, 0.265, 0.05, 16), glow('#7fd0ff', 0.4), 0, h * podY + 0.14, 0);
    k.cyl(0.015, 0.03, 0.55, '#d9d9d9', 0, h, 0, 6, 0.01);
    k.raw(new THREE.SphereGeometry(0.04, 8, 6), glow('#ff4d4d', 1), 0, h + 0.56, 0);
  },
};

const LANDMARKS = {
  // North America
  'New York': (g) => L.statue(g),
  'Los Angeles': (g) => {
    const k = kit(g);
    k.cone(0.95, 0.75, '#c9a15a', 0, 0, -0.1, 8);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.45), new THREE.MeshBasicMaterial({ map: signTexture('HOLLYWOOD', null, '#ffffff'), transparent: true }));
    at(sign, 0, 0.6, 0.5); sign.rotation.x = -0.35; g.add(sign);
    const palm = createTree('palm'); palm.position.set(-0.7, 0, 0.45); g.add(palm);
  },
  Chicago: (g) => {
    const k = kit(g);
    [[0, 0, 2.3], [-0.2, 0.18, 1.6], [0.2, 0.18, 1.9], [0, -0.2, 1.3]].forEach(([x, z, h]) => k.box(0.24, h, 0.24, '#2d2d34', x, 0, z, 0.03));
    for (const x of [-0.06, 0.06]) k.cyl(0.015, 0.02, 0.5, '#dddddd', x, 2.3, 0, 6, 0.01);
    windowsOn(g, 0.24, 2.2, 0.24, 0.05, '#ffd76b', 8, 1);
  },
  Vancouver: (g) => {
    const k = kit(g);
    ['#c0392b', '#2d3436', '#2a9d8f', '#f4a261'].forEach((c, i) => k.cyl(0.18, 0.2, 0.42, c, 0, i * 0.42, 0, 10));
    k.box(1.1, 0.12, 0.18, '#c0392b', 0, 1.25, 0, 0.05);
    eyesOn(g, 0.21, 0.98);
    const pine = createTree('pine'); pine.position.set(0.6, 0, -0.2); pine.scale.setScalar(1.3); g.add(pine);
  },
  'Mexico City': (g) => {
    const k = kit(g);
    k.box(0.6, 0.3, 0.6, '#d9cdb4');
    k.cyl(0.1, 0.13, 1.8, '#e9e2d0', 0, 0.3, 0, 12);
    k.cyl(0.16, 0.12, 0.12, '#e9e2d0', 0, 2.1, 0, 12);
    k.sph(0.12, '#ffcf33', 0, 2.35);
    k.box(0.5, 0.06, 0.1, '#ffcf33', 0, 2.3, 0, 0.03, 0.012);
  },
  // South America
  'São Paulo': (g) => L.skyline(g, { colors: ['#b9c6d6', '#e9e2d0', '#8fd3ff'], hs: [1.5, 2.1, 1.7] }),
  'Rio de Janeiro': (g) => {
    const k = kit(g);
    k.cone(0.85, 1.1, '#4f9a3c', 0, 0, 0, 7);
    const s = new THREE.Group(); s.position.y = 1.0; s.scale.setScalar(0.95); g.add(s);
    L.statue(s, { color: '#f4efe6', pedestal: '#cfc6b4', arms: 'open', h: 1.3 });
  },
  'Buenos Aires': (g) => L.obelisk(g, { h: 2.4 }),
  // Europe
  Berlin: (g) => L.gate(g),
  Munich: (g) => L.church(g, { wall: '#c9583d', roof: '#3f8f6b', domes: true }),
  Paris: (g) => {
    const k = kit(g);
    const c = '#9b7653';
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const leg = k.add(at(part(new THREE.CylinderGeometry(0.04, 0.07, 1.0, 6), c, { outline: 0.015 }), x * 0.3, 0.5, z * 0.3));
      leg.rotation.set(-z * 0.32, 0, x * 0.32);
    }
    k.box(0.55, 0.06, 0.55, c, 0, 0.95);
    k.cyl(0.07, 0.17, 1.0, c, 0, 1.0, 0, 4);
    k.box(0.26, 0.05, 0.26, c, 0, 1.6);
    k.cyl(0.02, 0.07, 0.75, c, 0, 2.0, 0, 4);
    k.torus(0.2, 0.04, c, 0, 0.62, 0.3, Math.PI).rotation.z = 0;
  },
  Rome: (g) => {
    const k = kit(g);
    const wall = k.add(at(part(new THREE.CylinderGeometry(0.75, 0.75, 0.75, 28, 1, true, 0, Math.PI * 1.55), '#d9b98a', { outline: 0.03 }), 0, 0.375, 0));
    wall.material = toon('#d9b98a', { side: THREE.DoubleSide });
    wall.rotation.y = Math.PI * 0.72;
    wall.scale.set(1, 1, 0.8);
    for (let r = 0; r < 3; r++) for (let i = 0; i < 10; i++) {
      const a = Math.PI * 0.72 + (i / 10) * Math.PI * 1.55 + 0.08;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.02), toon('#7a5a36'));
      m.position.set(Math.sin(a) * 0.76, 0.13 + r * 0.23, Math.cos(a) * 0.76 * 0.8);
      m.rotation.y = a;
      g.add(m);
    }
    k.cyl(0.66, 0.66, 0.05, '#c9a777', 0, 0, 0, 24).scale.set(1, 1, 0.8);
  },
  // UKI
  London: (g) => L.clockTower(g, { h: 1.9 }),
  Manchester: (g) => L.stadium(g, { color: '#c8102e' }),
  Birmingham: (g) => {
    const k = kit(g);
    const blob = k.sph(0.6, '#2f5fd0', 0, 0.45, 0);
    blob.scale.set(1.2, 0.75, 0.9);
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2 * 3, y = 0.15 + (i / 40) * 0.6;
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 10), toon('#e8eef8'));
      const rr = Math.sqrt(Math.max(0, 1 - ((y - 0.45) / 0.45) ** 2));
      d.position.set(Math.cos(a) * 0.7 * rr, y, Math.sin(a) * 0.53 * rr);
      d.lookAt(d.position.clone().multiplyScalar(2).setY(y));
      d.rotateX(Math.PI / 2);
      if (d.position.z > -0.1) g.add(d);
    }
  },
  // Middle East
  Dubai: (g) => {
    const k = kit(g);
    [0.5, 0.42, 0.34, 0.27, 0.2, 0.14, 0.09].forEach((w, i) => k.box(w, 0.44, w, '#c9d6e3', i * 0.025, i * 0.42, -i * 0.02, 0.04));
    k.cyl(0.01, 0.04, 0.6, '#c9d6e3', 0.18, 2.94, -0.14, 6, 0.01);
  },
  'Abu Dhabi': (g) => L.mosque(g),
  Riyadh: (g) => {
    const k = kit(g);
    const sh = new THREE.Shape();
    sh.moveTo(-0.35, 0); sh.lineTo(-0.35, 1.4); sh.quadraticCurveTo(-0.3, 2.3, 0, 2.5); sh.quadraticCurveTo(0.3, 2.3, 0.35, 1.4); sh.lineTo(0.35, 0); sh.closePath();
    const hole = new THREE.Path(); hole.moveTo(-0.24, 1.7); hole.quadraticCurveTo(0, 2.55, 0.24, 1.7); hole.quadraticCurveTo(0, 2.0, -0.24, 1.7); sh.holes.push(hole);
    k.add(at(part(new THREE.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03 }), '#9fb8c9'), 0, 0, -0.15));
    windowsOn(g, 0.6, 1.3, 0.36, 0.05, '#e9f7ff', 6, 3);
  },
  Doha: (g) => {
    const k = kit(g);
    [[0.9, 0.35], [0.7, 0.3], [0.5, 0.3], [0.32, 0.28]].reduce((y, [w, h]) => { k.box(w, h, w, '#f1ebdf', 0, y, 0, 0.03); return y + h; }, 0);
    k.raw(new THREE.BoxGeometry(0.18, 0.12, 0.01), toon('#8a6a4a'), 0, 1.0, 0.161);
  },
  // Africa
  Johannesburg: (g) => {
    const k = kit(g);
    k.cyl(0.32, 0.32, 2.0, '#d9d4cb', 0, 0, 0, 20);
    windowsOn(g, 0.5, 1.8, 0.62, 0.1, '#ffe08a', 9, 3);
    const sign = new THREE.Mesh(new THREE.CylinderGeometry(0.335, 0.335, 0.24, 20, 1, true), new THREE.MeshBasicMaterial({ color: '#d33', side: THREE.DoubleSide }));
    at(sign, 0, 1.85, 0); g.add(sign);
  },
  'Cape Town': (g) => L.mountain(g, { color: '#6f7b5c', flat: true, h: 1.3 }),
  Lagos: (g) => {
    const k = kit(g);
    k.cyl(0.75, 0.85, 0.35, '#e9e2d0', 0, 0, 0, 16);
    const hat = k.dome(0.7, '#a7b0b8', 0, 0.35, 0); hat.scale.set(1, 0.55, 1);
    k.cyl(0.3, 0.3, 0.1, '#008751', 0, 0.72, 0, 16);
    const city = at(new THREE.Group(), 0, 0, -0.75);
    L.skyline(city, { hs: [0.8, 1.1, 0.7] });
    g.add(city);
  },
  Abuja: (g) => {
    const k = kit(g);
    const rock = k.sph(0.75, '#7b6a5a', 0, 0.2, -0.2); rock.scale.set(1.2, 1.05, 0.8);
    k.dome(0.3, '#e9c25a', 0.45, 0.25, 0.45);
    k.box(0.6, 0.25, 0.5, '#f3ede0', 0.45, 0, 0.45);
    k.cyl(0.04, 0.05, 0.9, '#f3ede0', 0.85, 0, 0.6, 8);
  },
  Nairobi: (g) => {
    const k = kit(g);
    k.cyl(0.25, 0.3, 1.8, '#c8805a', 0, 0, 0, 16);
    windowsOn(g, 0.4, 1.6, 0.56, 0.1, '#ffe08a', 7, 2);
    k.cyl(0.45, 0.25, 0.18, '#a35f3d', 0, 1.8, 0, 16);
    k.cone(0.05, 0.3, '#ffcf33', 0, 1.98, 0, 6, 0.01);
    k.cone(0.7, 0.5, '#7b6248', -0.4, 0, 0.3, 6).scale.set(1, 0.6, 1);
  },
  // SEA
  Jakarta: (g) => {
    const k = kit(g);
    k.box(1.0, 0.18, 1.0, '#e9e2d0');
    k.box(0.7, 0.12, 0.7, '#d9cfbb', 0, 0.18);
    k.cyl(0.1, 0.18, 1.9, '#f4efe6', 0, 0.3, 0, 4);
    k.cyl(0.2, 0.1, 0.12, '#f4efe6', 0, 2.2, 0, 8);
    const flame = k.raw(new THREE.ConeGeometry(0.12, 0.35, 8), glow('#ffcf33', 0.9), 0, 2.5, 0);
    g.userData.animate = (t) => { flame.scale.set(1, 1 + Math.sin(t * 8) * 0.08, 1); };
  },
  Bangkok: (g) => L.stupa(g, { color: '#f2e9d8', gold: '#e9a93a', h: 2.2 }),
  Phuket: (g) => {
    const k = kit(g);
    k.cone(0.9, 0.55, '#4f9a3c', 0, 0, 0, 8);
    k.box(0.7, 0.25, 0.45, '#f4efe6', 0, 0.5);
    const body = k.sph(0.38, '#f4efe6', 0, 1.05, 0); body.scale.set(1, 1.1, 0.8);
    k.sph(0.2, '#f4efe6', 0, 1.6, 0);
    k.cone(0.08, 0.2, '#f4efe6', 0, 1.75, 0, 8);
  },
  'Kuala Lumpur': (g) => {
    const k = kit(g);
    for (const x of [-0.3, 0.3]) {
      [0.2, 0.18, 0.15, 0.12, 0.08].reduce((y, r, i) => { k.cyl(r, r + 0.02, i === 0 ? 1.3 : 0.32, '#c5ced8', x, y, 0, 8); return y + (i === 0 ? 1.3 : 0.32); }, 0);
      k.cyl(0.01, 0.03, 0.5, '#c5ced8', x, 2.58, 0, 6, 0.01);
    }
    k.box(0.45, 0.08, 0.1, '#9aa7b5', 0, 0.95);
  },
  // ANZ
  Sydney: (g) => {
    const k = kit(g);
    k.box(1.4, 0.2, 0.8, '#d8b48c');
    [[-0.4, 0.55, 0.35], [-0.05, 0.75, 0.3], [0.3, 0.6, 0.25], [0.55, 0.42, 0.2]].forEach(([x, h, w]) => {
      const sh = k.add(at(part(new THREE.SphereGeometry(w + 0.12, 12, 8, 0, Math.PI, 0, Math.PI / 2), '#fbfaf5', { outline: 0.02 }), x, 0.2, 0));
      sh.scale.set(1, h / (w + 0.12), 1.3);
      sh.rotation.y = -Math.PI / 2;
    });
  },
  Melbourne: (g) => {
    const k = kit(g);
    k.box(1.4, 0.5, 0.5, '#f0b45a');
    k.dome(0.3, '#3f8f6b', 0, 0.5, 0);
    k.box(0.3, 0.9, 0.3, '#f0b45a', 0.55, 0, 0.1);
    k.raw(new THREE.CircleGeometry(0.09, 16), toon('#fffbe8'), 0.55, 0.72, 0.252);
    for (let i = 0; i < 5; i++) k.raw(new THREE.BoxGeometry(0.14, 0.2, 0.01), toon('#7a3e2a'), -0.55 + i * 0.22, 0.2, 0.252);
  },
  Auckland: (g) => L.needle(g, { h: 2.6, podY: 0.75, color: '#e9eef2' }),
  // Europe (new)
  Budapest: (g) => {
    // Hungarian Parliament on the Danube: long gothic front, red central dome, rows of spires.
    const k = kit(g);
    k.raw(new THREE.BoxGeometry(1.9, 0.04, 0.45), toon('#4fb3ff'), 0, 0.02, 0.55);
    k.box(1.6, 0.5, 0.55, '#efe6d2', 0, 0, -0.05);
    windowsOn(g, 1.6, 0.4, 0.45, 0.05, '#c9a777', 2, 8);
    k.cyl(0.24, 0.26, 0.35, '#efe6d2', 0, 0.5, -0.05, 12);
    k.dome(0.25, '#b5523b', 0, 0.85, -0.05);
    k.cone(0.05, 0.45, '#b5523b', 0, 1.05, -0.05, 8, 0.012);
    for (const x of [-0.7, -0.45, 0.45, 0.7]) k.cone(0.05, 0.38, '#efe6d2', x, 0.5, 0.18, 6, 0.012);
    for (const x of [-0.78, 0.78]) { k.box(0.16, 0.75, 0.16, '#efe6d2', x, 0, -0.05); k.cone(0.1, 0.3, '#b5523b', x, 0.75, -0.05, 4, 0.012); }
  },
  // India
  Delhi: (g) => {
    // India Gate: sandstone war-memorial arch with a shallow bowl on top.
    const k = kit(g);
    k.box(1.15, 0.12, 0.6, '#cdb08a');
    k.add(at(part(archBlock(1.0, 1.55, 0.42, 0.68), '#d9a066'), 0, 0.12, -0.21));
    k.box(1.06, 0.12, 0.48, '#c98f55', 0, 1.67);
    k.cyl(0.22, 0.16, 0.18, '#c98f55', 0, 1.79, 0, 14);
    k.raw(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 12), glow('#ffb703', 0.9), 0, 1.98, 0);
  },
  Mumbai: (g) => {
    // Gateway of India on the waterfront: central arch block with four domed turrets.
    const k = kit(g);
    k.raw(new THREE.BoxGeometry(1.9, 0.04, 0.5), toon('#4fb3ff'), 0, 0.02, 0.6);
    k.add(at(part(archBlock(0.9, 1.15, 0.5, 0.42), '#d8b878'), 0, 0, -0.25));
    k.box(0.92, 0.14, 0.52, '#c9a463', 0, 1.15);
    for (const x of [-0.38, 0.38]) for (const z of [-0.18, 0.18]) {
      k.cyl(0.08, 0.09, 0.4, '#d8b878', x, 1.29, z, 8);
      k.dome(0.09, '#c9a463', x, 1.69, z);
    }
    k.dome(0.2, '#c9a463', 0, 1.29, 0);
    for (const x of [-0.72, 0.72]) k.box(0.36, 0.7, 0.4, '#d8b878', x, 0, -0.05);
  },
  Bangalore: (g) => {
    // Vidhana Soudha: granite assembly hall with a colonnade and a central dome, in the Garden City.
    const k = kit(g);
    k.box(1.55, 0.55, 0.6, '#e6e0d2');
    for (let i = 0; i < 6; i++) k.cyl(0.035, 0.035, 0.45, '#f7f4ec', -0.4 + i * 0.16, 0.05, 0.32, 8, 0.01);
    k.box(0.95, 0.1, 0.18, '#d6cfbd', 0, 0.5, 0.3);
    k.cyl(0.24, 0.26, 0.25, '#e6e0d2', 0, 0.55, -0.05, 14);
    k.dome(0.26, '#d6cfbd', 0, 0.8, -0.05);
    k.cone(0.05, 0.18, '#ffcf33', 0, 1.06, -0.05, 6, 0.01);
    for (const x of [-0.7, 0.7]) { const t = createTree('round'); t.position.set(x, 0, 0.5); t.scale.setScalar(0.8); g.add(t); }
  },
  Hyderabad: (g) => {
    // Charminar: square arched pavilion with four tall minarets.
    const k = kit(g);
    k.add(at(part(archBlock(0.9, 0.85, 0.9, 0.42), '#e3c9a0'), 0, 0, -0.45));
    k.box(0.92, 0.12, 0.92, '#d4b685', 0, 0.85);
    k.box(0.6, 0.22, 0.6, '#e3c9a0', 0, 0.97);
    k.dome(0.16, '#d4b685', 0, 1.19, 0);
    for (const x of [-0.43, 0.43]) for (const z of [-0.43, 0.43]) {
      k.cyl(0.08, 0.1, 1.75, '#e3c9a0', x, 0, z, 10);
      for (const y of [0.85, 1.3]) k.cyl(0.12, 0.12, 0.05, '#d4b685', x, y, z, 10, 0.01);
      k.dome(0.09, '#d4b685', x, 1.75, z);
      k.cone(0.02, 0.12, '#ffcf33', x, 1.84, z, 6, 0.008);
    }
  },
};

// A block with a round-topped arch cut through it (front faces +z), depth along z.
function archBlock(w, h, d, archW) {
  const sh = new THREE.Shape();
  sh.moveTo(-w / 2, 0); sh.lineTo(w / 2, 0); sh.lineTo(w / 2, h); sh.lineTo(-w / 2, h); sh.closePath();
  const r = archW / 2, top = h * 0.72;
  const hole = new THREE.Path();
  hole.moveTo(-r, 0.001); hole.lineTo(r, 0.001); hole.lineTo(r, top - r); hole.absarc(0, top - r, r, 0, Math.PI, false); hole.lineTo(-r, 0.001);
  sh.holes.push(hole);
  return new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: false });
}
function eyesOn(g, y, z) {
  for (const x of [-0.08, 0.08]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), toon('#ffffff'));
    e.position.set(x, z, y); g.add(e);
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), toon('#111'));
    p.position.set(x, z, y + 0.035); g.add(p);
  }
}

/** Landmark for a city on a small diorama base. */
export function createLandmark(cityName, ground = '#8fd16a', accent = '#5a62d8') {
  const root = new THREE.Group();
  // Plinth: country-coloured ring under a patch of regional ground ties the landmark to its set.
  const rim = part(new THREE.CylinderGeometry(1.0, 1.06, 0.14, 28), accent, { outline: 0.035 });
  rim.position.y = 0.07;
  const base = part(new THREE.CylinderGeometry(0.88, 0.9, 0.08, 28), ground, { outline: 0 });
  base.position.y = 0.18;
  root.add(rim, base);
  const g = new THREE.Group();
  g.position.y = 0.22;
  (LANDMARKS[cityName] || ((x) => L.skyline(x)))(g);
  root.add(g);
  root.userData.animate = g.userData.animate;
  return root;
}

// ---------- Utility scenes ----------
export function createUtilityScene(model) {
  const root = new THREE.Group();
  const k = kit(root);
  switch (model) {
    case 'airport': {
      k.box(2.2, 0.06, 0.55, '#4a4f5c', 0, 0, 0, 0.02, 0.02);
      for (let i = 0; i < 6; i++) k.raw(new THREE.BoxGeometry(0.18, 0.01, 0.04), toon('#ffffff'), -0.9 + i * 0.36, 0.065, 0);
      k.cyl(0.07, 0.1, 0.95, '#e8e8e8', -0.85, 0, -0.55, 10);
      k.cyl(0.18, 0.14, 0.18, '#63c7ff', -0.85, 0.95, -0.55, 10);
      const plane = at(new THREE.Group(), 0, 0.25, 0);
      plane.add(rot(part(new THREE.CapsuleGeometry(0.12, 0.85, 6, 12), '#ffffff'), 0, 0, Math.PI / 2));
      plane.add(at(part(RB(0.26, 0.04, 1.1, 0.02), '#ff6b4a'), 0.05, 0, 0));
      plane.add(at(part(RB(0.14, 0.28, 0.04, 0.02), '#ff6b4a'), -0.48, 0.15, 0));
      plane.add(at(part(RB(0.12, 0.03, 0.4, 0.01), '#ff6b4a'), -0.48, 0.03, 0));
      plane.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.01), toon('#2a6fdb')), 0.05, 0.05, 0.121));
      root.add(plane);
      root.userData.animate = (t) => {
        const c = (t * 0.22) % 1; // taxi, take off, fly away, reset
        const x = -0.9 + c * 3.6;
        plane.position.set(x, 0.25 + Math.max(0, c - 0.35) * 3.2, 0);
        plane.rotation.z = c > 0.35 ? 0.28 : 0;
        plane.visible = c < 0.8;
      };
      break;
    }
    case 'dam': {
      const wall = k.add(at(part(new THREE.CylinderGeometry(0.9, 0.9, 0.8, 24, 1, false, -0.6, 1.2), '#b9b9b9', { outline: 0.03 }), 0, 0.4, 0.7));
      wall.rotation.y = Math.PI;
      k.raw(new THREE.BoxGeometry(1.7, 0.6, 0.9), toon('#3aa0ff', { transparent: true, opacity: 0.85 }), 0, 0.3, -0.6);
      k.cone(0.7, 1.0, '#6f7b5c', -1.0, 0, -0.4, 7);
      k.cone(0.6, 0.9, '#6f7b5c', 1.0, 0, -0.4, 7);
      const spill = k.raw(new THREE.BoxGeometry(0.4, 0.75, 0.05), toon('#bfe6ff', { transparent: true, opacity: 0.8 }), 0, 0.38, -0.1);
      root.userData.animate = (t) => { spill.material.opacity = 0.65 + Math.sin(t * 6) * 0.15; };
      break;
    }
    case 'rail': {
      k.box(2.2, 0.05, 0.6, '#9a8f80', 0, 0, 0, 0.02, 0.02);
      for (let i = 0; i < 9; i++) k.raw(new THREE.BoxGeometry(0.08, 0.03, 0.5), toon('#6b4a2a'), -1.0 + i * 0.25, 0.065, 0);
      for (const z of [-0.14, 0.14]) k.raw(new THREE.BoxGeometry(2.2, 0.04, 0.03), toon('#777'), 0, 0.09, z);
      const train = at(new THREE.Group(), 0, 0.3, 0);
      const nose = rot(part(new THREE.CapsuleGeometry(0.2, 0.9, 6, 12), '#ffffff'), 0, 0, Math.PI / 2);
      nose.scale.set(1, 1, 0.9);
      train.add(nose);
      train.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.37), toon('#e63946')), 0, -0.04, 0));
      train.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.08, 0.36), toon('#2b3a55')), 0, 0.08, 0));
      root.add(train);
      root.userData.animate = (t) => { train.position.x = Math.sin(t * 0.8) * 0.45; };
      break;
    }
    case 'underground': {
      k.box(1.3, 0.25, 0.9, '#8a8f99', 0, 0, 0, 0.04);
      k.box(0.8, 0.27, 0.5, '#2b2b33', 0, 0.0, 0.1, 0.03, 0);
      for (let i = 0; i < 4; i++) k.raw(new THREE.BoxGeometry(0.7, 0.04, 0.1), toon('#bfc4cc'), 0, 0.22 - i * 0.05, -0.05 + i * 0.1);
      k.cyl(0.04, 0.04, 1.1, '#444', -0.75, 0, 0.2, 8);
      const roundel = k.torus(0.26, 0.07, '#dc241f', -0.75, 1.25, 0.2);
      void roundel;
      k.box(0.72, 0.15, 0.06, '#0019a8', -0.75, 1.18, 0.21);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.14), new THREE.MeshBasicMaterial({ map: signTexture('UNDERGROUND', null, '#ffffff', '#0019a8'), transparent: true }));
      at(sign, -0.75, 1.25, 0.25); root.add(sign);
      break;
    }
    case 'refinery': {
      k.cyl(0.3, 0.3, 0.55, '#f2f2f2', -0.55, 0, 0.1, 18);
      k.cyl(0.25, 0.25, 0.45, '#ffcc33', 0.05, 0, 0.35, 18);
      k.cyl(0.22, 0.22, 0.4, '#f2f2f2', 0.55, 0, 0.05, 18);
      k.cyl(0.06, 0.09, 1.5, '#9a9a9a', 0.15, 0, -0.45, 10);
      for (let i = 0; i < 3; i++) k.raw(new THREE.CylinderGeometry(0.095, 0.095, 0.08, 10), toon('#e63946'), 0.15, 0.4 + i * 0.4, -0.45);
      const flame = k.raw(new THREE.ConeGeometry(0.12, 0.38, 8), glow('#ff7b1c', 1), 0.15, 1.7, -0.45);
      k.box(1.2, 0.05, 0.05, '#777', 0, 0.3, -0.1, 0.01, 0.01);
      root.userData.animate = (t) => { flame.scale.set(1 + Math.sin(t * 13) * 0.15, 1 + Math.sin(t * 9) * 0.25, 1); };
      break;
    }
    case 'solar': {
      for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
        const x = -0.75 + c * 0.5, z = -0.3 + r * 0.55;
        k.cyl(0.025, 0.025, 0.25, '#888', x, 0, z, 6, 0.01);
        const p = k.add(rot(at(part(RB(0.44, 0.04, 0.4, 0.02), '#22378a', { outline: 0.015 }), x, 0.3, z), -0.55, 0, 0));
        p.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.005, 0.01), toon('#9fb6ff')), 0, 0.025, 0));
      }
      k.cyl(0.04, 0.06, 1.6, '#f4f4f4', 1.05, 0, 0.1, 8);
      const rotor = at(new THREE.Group(), 1.05, 1.6, 0.18);
      for (let i = 0; i < 3; i++) rotor.add(rot(at(part(RB(0.08, 0.6, 0.03, 0.02), '#ffffff', { outline: 0.012 }), 0, 0, 0), 0, 0, (i * Math.PI * 2) / 3).translateY(0.3));
      root.add(rotor);
      root.userData.animate = (t) => { rotor.rotation.z = t * 2.2; };
      break;
    }
    case 'seaport': {
      k.box(1.0, 0.25, 0.9, '#9aa3ad', -0.55, 0, 0, 0.04);
      k.box(0.1, 1.4, 0.1, '#ffb703', -0.7, 0.25, -0.2, 0.03);
      k.box(1.3, 0.1, 0.12, '#ffb703', -0.2, 1.6, -0.2, 0.03);
      const ship = shipModel('#1d3557', ['#e63946', '#2a9d8f', '#f4a261', '#457b9d', '#ffd166']);
      ship.position.set(0.6, -0.15, 0.1);
      root.add(ship);
      root.userData.animate = (t) => { ship.position.y = -0.15 + Math.sin(t * 1.6) * 0.04; ship.rotation.z = Math.sin(t * 1.2) * 0.03; };
      break;
    }
    case 'ferry': {
      k.box(0.7, 0.25, 0.5, '#8a6a4a', -0.75, 0, 0, 0.03);
      for (const x of [-1.0, -0.5]) k.cyl(0.05, 0.05, 0.4, '#5a4030', x, -0.15, 0.25, 6, 0.012);
      const ferry = at(new THREE.Group(), 0.4, -0.1, 0);
      ferry.add(at(part(RB(1.2, 0.3, 0.55, 0.14), '#ffffff'), 0, 0.15, 0));
      ferry.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.08, 0.56), toon('#1d70b8')), 0, 0.05, 0));
      ferry.add(at(part(RB(0.7, 0.25, 0.42, 0.06), '#ffd166'), -0.1, 0.42, 0));
      windowsOn(ferry, 0.7, 0.12, 0.42, 0.4, '#2a6fdb', 1, 4);
      ferry.add(at(part(new THREE.CylinderGeometry(0.07, 0.08, 0.3, 10), '#e63946'), 0.2, 0.66, 0));
      root.add(ferry);
      root.userData.animate = (t) => { ferry.position.y = -0.1 + Math.sin(t * 1.8) * 0.04; ferry.position.x = 0.4 + Math.sin(t * 0.4) * 0.12; };
      break;
    }
  }
  return root;
}

function shipModel(hull, containers) {
  const g = new THREE.Group();
  g.add(at(part(RB(1.4, 0.3, 0.55, 0.12), hull), 0, 0.15, 0));
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.06, 0.56), toon('#c0392b')), 0, 0.03, 0));
  containers.forEach((c, i) => g.add(at(part(RB(0.22, 0.16, 0.42, 0.02), c, { outline: 0.012 }), -0.45 + i * 0.23, 0.38, 0)));
  g.add(at(part(RB(0.22, 0.4, 0.42, 0.04), '#ffffff'), 0.55, 0.5, 0));
  return g;
}

// Utilities whose scene sits in the water rather than on the beach.
export const WATER_UTILITIES = new Set(['seaport', 'ferry']);


