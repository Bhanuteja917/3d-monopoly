// Procedural cartoon models (toon shading + ink outlines) for the 2.5D look.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const gradientMap = (() => {
  const t = new THREE.DataTexture(new Uint8Array([110, 110, 110, 255, 190, 190, 190, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();

const matCache = new Map();
export function toon(color, extra = {}) {
  const key = `${color}|${JSON.stringify(extra)}`;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshToonMaterial({ color, gradientMap, ...extra }));
  return matCache.get(key);
}

const outlineCache = new Map();
function outlineMat(th) {
  const key = th.toFixed(3);
  if (!outlineCache.has(key)) {
    const m = new THREE.MeshBasicMaterial({ color: 0x1d1530, side: THREE.BackSide });
    m.onBeforeCompile = (s) => {
      s.vertexShader = s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed += normalize(normal) * ${key};`);
    };
    m.customProgramCacheKey = () => `outline${key}`;
    outlineCache.set(key, m);
  }
  return outlineCache.get(key);
}

/** Mesh with toon material and an inverted-hull outline. */
export function part(geo, color, { outline = 0.035, extra } = {}) {
  const m = new THREE.Mesh(geo, typeof color === 'object' ? color : toon(color, extra));
  m.castShadow = true;
  m.receiveShadow = true;
  if (outline) {
    const o = new THREE.Mesh(geo, outlineMat(outline));
    o.raycast = () => {};
    m.add(o);
  }
  return m;
}
const at = (obj, x, y, z) => { obj.position.set(x, y, z); return obj; };
const rot = (obj, x, y, z) => { obj.rotation.set(x, y, z); return obj; };
const sc = (obj, x, y = x, z = x) => { obj.scale.set(x, y, z); return obj; };

const G = {
  sphere: (r, w = 20, h = 14) => new THREE.SphereGeometry(r, w, h),
  box: (x, y, z, r = 0.06) => new RoundedBoxGeometry(x, y, z, 3, Math.min(r, x / 2.1, y / 2.1, z / 2.1)),
  cyl: (rt, rb, h, s = 16) => new THREE.CylinderGeometry(rt, rb, h, s),
  cone: (r, h, s = 16) => new THREE.ConeGeometry(r, h, s),
  torus: (r, t, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, 10, 24, arc),
  capsule: (r, l) => new THREE.CapsuleGeometry(r, l, 6, 14),
};

// ---------- Buildings ----------
const STYLES = {
  modern: { wall: '#dfe8f2', roof: '#5b7fa6', accent: '#7fd0ff', roofShape: 'flat' },
  colonial: { wall: '#fff3dc', roof: '#e86f3a', accent: '#ffd36b', roofShape: 'pyramid' },
  classic: { wall: '#f5e6c8', roof: '#6d7b8f', accent: '#ffe08a', roofShape: 'pyramid' },
  brick: { wall: '#c9583d', roof: '#4a4f5c', accent: '#ffe6a6', roofShape: 'pyramid' },
  desert: { wall: '#f3dca8', roof: '#f4f0e6', accent: '#36c2d9', roofShape: 'dome' },
  savanna: { wall: '#d99a5b', roof: '#c9a44a', accent: '#ffcf5c', roofShape: 'cone' },
  tropical: { wall: '#ffe2b8', roof: '#3fae6b', accent: '#ff7a59', roofShape: 'cone' },
  coastal: { wall: '#e9f7ff', roof: '#3d8fd6', accent: '#ffd36b', roofShape: 'pyramid' },
  indian: { wall: '#f6dcb3', roof: '#f08a24', accent: '#2ec4b6', roofShape: 'dome' },
};

function roof(style, w, y) {
  const s = STYLES[style];
  if (s.roofShape === 'flat') return at(part(G.box(w * 1.05, 0.08, w * 1.05, 0.03), s.roof), 0, y + 0.04, 0);
  if (s.roofShape === 'dome') return at(part(new THREE.SphereGeometry(w * 0.5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), s.roof), 0, y, 0);
  if (s.roofShape === 'cone') return at(part(G.cone(w * 0.78, w * 0.7, 12), s.roof), 0, y + w * 0.35, 0);
  return rot(at(part(G.cone(w * 0.8, w * 0.55, 4), s.roof), 0, y + w * 0.27, 0), 0, Math.PI / 4, 0);
}
function windows(g, w, h, y0, color, rows, cols = 2) {
  const mat = toon(color, { emissive: new THREE.Color(color), emissiveIntensity: 0.35 });
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = (c - (cols - 1) / 2) * (w / cols) * 0.9;
    const y = y0 + (r + 0.5) * (h / rows);
    g.add(at(new THREE.Mesh(new THREE.BoxGeometry(w * 0.22, h / rows * 0.45, 0.02), mat), x, y, w / 2 + 0.01));
  }
}

/** steps: 1 house, 2 building, 3 tower. */
export function createBuilding(steps, style) {
  const s = STYLES[style] || STYLES.classic;
  const g = new THREE.Group();
  if (steps === 1) {
    const w = 0.55, h = 0.42;
    g.add(at(part(G.box(w, h, w), s.wall), 0, h / 2, 0));
    g.add(roof(style, w, h));
    g.add(at(part(G.box(0.14, 0.22, 0.04, 0.02), '#7a4a2a', { outline: 0.015 }), 0, 0.11, w / 2));
  } else if (steps === 2) {
    const w = 0.62, h = 1.0;
    g.add(at(part(G.box(w, h, w), s.wall), 0, h / 2, 0));
    windows(g, w, h - 0.15, 0.1, s.accent, 3);
    g.add(roof(style, w * 0.9, h));
  } else {
    const w = 0.6, h = 1.9;
    g.add(at(part(G.box(w + 0.12, 0.25, w + 0.12), s.roof), 0, 0.125, 0));
    g.add(at(part(G.box(w, h, w, 0.08), s.accent === '#7fd0ff' ? '#9fdcff' : s.wall), 0, h / 2 + 0.2, 0));
    windows(g, w, h - 0.2, 0.3, style === 'modern' ? '#2f6fb3' : s.accent, 6);
    g.add(at(part(G.box(w * 0.7, 0.3, w * 0.7), s.roof), 0, h + 0.35, 0));
    g.add(at(part(G.cyl(0.02, 0.05, 0.6, 8), '#d9d9d9', { outline: 0.012 }), 0, h + 0.8, 0));
    g.add(at(new THREE.Mesh(G.sphere(0.06, 8, 6), toon('#ff4d4d', { emissive: new THREE.Color('#ff4d4d'), emissiveIntensity: 0.8 })), 0, h + 1.12, 0));
  }
  return g;
}

// ---------- Scenery ----------
export function createTree(kind = 'round') {
  const g = new THREE.Group();
  if (kind === 'palm') {
    g.add(rot(at(part(G.cyl(0.05, 0.08, 0.9, 8), '#9b6b3d', { outline: 0.015 }), 0, 0.45, 0), 0, 0, 0.15));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      g.add(rot(sc(at(part(G.sphere(0.2, 10, 6), '#3fae4a', { outline: 0.015 }), 0.07 + Math.cos(a) * 0.22, 0.9, Math.sin(a) * 0.22), 1.4, 0.3, 0.6), 0, -a, 0));
    }
  } else if (kind === 'pine') {
    g.add(at(part(G.cyl(0.05, 0.06, 0.3, 6), '#7a5230', { outline: 0.015 }), 0, 0.15, 0));
    g.add(at(part(G.cone(0.3, 0.55, 8), '#2f8f4e'), 0, 0.5, 0));
    g.add(at(part(G.cone(0.22, 0.45, 8), '#37a35a'), 0, 0.78, 0));
  } else {
    g.add(at(part(G.cyl(0.05, 0.07, 0.4, 6), '#7a5230', { outline: 0.015 }), 0, 0.2, 0));
    g.add(at(part(G.sphere(0.3, 12, 8), '#4cbb4a'), 0, 0.55, 0));
  }
  return g;
}
