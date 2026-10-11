// Circuit-shaped board layout: a smooth closed track whose bays reach into the middle of the island.
// Pure geometry (no Three.js) so it can be checked in Node.

export const TILE_W = 3.0; // tile length along the track (property cards, 2:3)
export const TILE_D = 4.5; // tile depth across the track
export const CORNER_LEN = 5.4; // track length reserved for a corner pad

// Control points (x right, z towards the viewer), travelled clockwise on screen from the bottom-right.
// Each bay is a hairpin that dips into the centre; more players get more bays.
const TEMPLATES = {
  // 4-5 players: one wide bay from the top
  one: [
    [9, 5.8], [0, 6.2], [-9, 5.8], [-11.5, 3], [-11.5, -3], [-9.5, -6], [-6.8, -6.2],
    [-5, -4.2], [-4.4, -0.6], [-2, 1.6], [2, 1.6], [4.4, -0.6], [5, -4.2],
    [6.8, -6.2], [9.5, -6], [11.5, -3], [11.5, 3],
  ],
  // 6-8 players: an S-circuit with a bay from the top-left and one from the bottom-right
  two: [
    [14, 6.8], [12, 7.1],
    [10.6, 5.2], [10.2, 1.2], [8.2, -1.2], [3.8, -1.2], [1.8, 1.2], [1.4, 5.2], // bottom bay
    [0, 7.1], [-13, 6.8], [-16, 3.5], [-16, -3.5], [-14, -6.8], [-12, -7.1],
    [-10.6, -5.2], [-10.2, -1.2], [-8.2, 1.2], [-3.8, 1.2], [-1.8, -1.2], [-1.4, -5.2], // top bay
    [0, -7.1], [13, -6.8], [16, -3.5], [16, 3.5],
  ],
};

// Closed centripetal-ish Catmull-Rom sampled densely.
function sampleClosed(pts, perSeg = 40) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let k = 0; k < perSeg; k++) {
      const t = k / perSeg, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return out;
}

function arcTable(samples) {
  const cum = [0];
  for (let i = 1; i <= samples.length; i++) {
    const a = samples[i - 1], b = samples[i % samples.length];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return cum;
}

function pointAt(samples, cum, s) {
  const L = cum[cum.length - 1];
  s = ((s % L) + L) % L;
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
  const a = samples[lo % samples.length], b = samples[(lo + 1) % samples.length];
  const t = (s - cum[lo]) / (cum[lo + 1] - cum[lo] || 1);
  const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
  let ux = b[0] - a[0], uz = b[1] - a[1];
  const len = Math.hypot(ux, uz) || 1;
  ux /= len; uz /= len;
  return { x, z, ux, uz };
}

// Footprint of a space as an oriented rectangle: half length along the track, half depth across it.
const GAP = 0.08; // breathing room between neighbouring cards
function footprint(kind, p) {
  const hl = (kind === 'corner' ? CORNER_LEN : TILE_W) / 2 + GAP / 2;
  const hd = (kind === 'corner' ? CORNER_LEN : TILE_D) / 2;
  return { x: p.x, z: p.z, ux: p.ux, uz: p.uz, hl, hd };
}
// Separating-axis test for two oriented rectangles.
function overlaps(a, b) {
  for (const [ax, az] of [[a.ux, a.uz], [-a.uz, a.ux], [b.ux, b.uz], [-b.uz, b.ux]]) {
    const ra = Math.abs(a.hl * (a.ux * ax + a.uz * az)) + Math.abs(a.hd * (-a.uz * ax + a.ux * az));
    const rb = Math.abs(b.hl * (b.ux * ax + b.uz * az)) + Math.abs(b.hd * (-b.uz * ax + b.ux * az));
    if (Math.abs((b.x - a.x) * ax + (b.z - a.z) * az) > ra + rb) return false;
  }
  return true;
}

// Place every space as early as it fits without touching any space already placed (on bends the inner
// edges would otherwise overlap). Returns the arc positions, or null if they do not fit in one lap.
function packSpaces(kinds, lens, samples, cum) {
  const L = cum.at(-1);
  const pos = [], rects = [];
  let s = lens[0] / 2;
  for (let i = 0; i < kinds.length; i++) {
    if (i) s = pos[i - 1] + (lens[i - 1] + lens[i]) / 2;
    for (;;) {
      if (s + lens[i] / 2 > L) return null;
      const r = footprint(kinds[i], pointAt(samples, cum, s));
      if (!rects.some((q) => overlaps(q, r))) { rects.push(r); break; }
      s += 0.05;
    }
    pos.push(s);
  }
  return pos;
}

/**
 * Lay out the board's spaces along the circuit. `kinds` lists each space as 'corner' or 'tile'.
 * Cards never overlap: spacing opens up on bends, and the circuit is enlarged until every space fits.
 * Returns spots (centre, tangent u, inward normal) plus the centreline for drawing.
 */
export function buildTrack(kinds) {
  const lens = kinds.map((k) => (k === 'corner' ? CORNER_LEN : TILE_W));
  const total = lens.reduce((a, b) => a + b, 0);
  // The S-circuit's corridors only fit when the track is long compared with how deep the tiles are;
  // otherwise use the roomier one-bay circuit. Taller templates suit tablets.
  const [tpl, zStretch] = total / TILE_D < 40 ? [TEMPLATES.one, 1.2] : [TEMPLATES.two, 1.35];
  const raw = sampleClosed(tpl.map(([x, z]) => [x, z * zStretch]), 60);
  const rawLen = arcTable(raw).at(-1);
  const at = (k) => {
    const samples = raw.map(([x, z]) => [x * k, z * k]);
    const cum = arcTable(samples);
    return { samples, cum, pos: packSpaces(kinds, lens, samples, cum) };
  };
  // Smallest scale that fits (binary search from the tight-packed length upwards).
  let lo = total / rawLen, hi = lo;
  let best = at(lo);
  if (!best.pos) {
    do { hi *= 1.15; best = at(hi); } while (!best.pos && hi < lo * 4);
    for (let it = 0; it < 14; it++) {
      const mid = (lo + hi) / 2, r = at(mid);
      if (r.pos) { hi = mid; best = r; } else lo = mid;
    }
  }
  const { samples, cum } = best;
  // Share the leftover track evenly between the gaps, if that keeps every space clear.
  const slack = cum.at(-1) - (best.pos.at(-1) + lens.at(-1) / 2);
  let pos = best.pos.map((s, i) => s + (slack * i) / kinds.length);
  const rects = pos.map((s, i) => footprint(kinds[i], pointAt(samples, cum, s)));
  if (rects.some((a, i) => rects.some((b, j) => j > i && overlaps(a, b)))) pos = best.pos;
  const spots = pos.map((s, i) => {
    const { x, z, ux, uz } = pointAt(samples, cum, s);
    // Clockwise travel: the interior is to the right of the direction of travel.
    return { kind: kinds[i], s, x, z, ux, uz, nx: -uz, nz: ux };
  });
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of samples) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  return { spots, samples, length: cum.at(-1), bbox: { minX, maxX, minZ, maxZ } };
}

export { footprint as spaceFootprint, overlaps as rectsOverlap };

export function pointInPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Convex hull of [x, z] points (monotone chain), counter-clockwise. */
export function convexHull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const h = [];
    for (const q of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  return [...half(p), ...half(p.reverse())];
}

export function distToPolyline(x, z, pts, step = 1) {
  let best = Infinity;
  for (let i = 0; i < pts.length; i += step) best = Math.min(best, Math.hypot(pts[i][0] - x, pts[i][1] - z));
  return best;
}

// Landmarks stand on the beach outside the track, each at its own distance: far enough that the tall
// cut-out (which rises up the screen from its base) never covers a card.
const TRACK_CLEAR = TILE_D / 2 + 0.8; // keep the art this far from the track centreline (covers corner pads too)

/**
 * Pick a base point for each tile's landmark on the outer side of the track.
 * opts: width (art width), height (art height above its base), pitch (camera tilt above horizontal).
 * The ground area a cut-out hides is a box from its base back (up the screen) by height / sin(pitch).
 * distance scales the clear distance found (0.5 = half way, so landmarks may tuck behind the cards' outer
 * edge); stagger pushes every other landmark further out, so neighbours stand at different depths.
 * Returns per space { x, z, r, scale, w, h, rect } (null for corners); `rect` is that hidden ground box.
 */
export function placeLandmarks(track, { width = 6.5, height = 5.6, pitch = 0.98, distance = 0.5, stagger = 1.4 } = {}) {
  const S = track.samples;
  const boxFor = (x, z, w, h) => ({ x0: x - w / 2, x1: x + w / 2, z0: z - h / Math.sin(pitch), z1: z + 0.8 });
  const clearOfTrack = (b) => {
    for (let i = 0; i < S.length; i += 2) {
      const [px, pz] = S[i];
      const dx = Math.max(b.x0 - px, 0, px - b.x1), dz = Math.max(b.z0 - pz, 0, pz - b.z1);
      if (Math.hypot(dx, dz) < TRACK_CLEAR) return false;
    }
    return true;
  };
  let alt = 0;
  return track.spots.map((sp) => {
    if (sp.kind !== 'tile') return null;
    alt += 1;
    for (const scale of [1, 0.85, 0.7, 0.55]) {
      const w = width * scale, h = height * scale;
      for (let gap = 1.2; gap < 16; gap += 0.25) {
        if (pointInPolygon(sp.x - sp.nx * (TILE_D / 2 + gap), sp.z - sp.nz * (TILE_D / 2 + gap), S)) continue; // beach is outside
        if (!clearOfTrack(boxFor(sp.x - sp.nx * (TILE_D / 2 + gap), sp.z - sp.nz * (TILE_D / 2 + gap), w, h))) continue;
        // Bring it in by `distance`, then alternate neighbours nearer and further (up and down the beach).
        const g = Math.max(0.9, gap * distance) + (alt % 2) * stagger;
        const o = TILE_D / 2 + g;
        let x = sp.x - sp.nx * o, z = sp.z - sp.nz * o;
        if (pointInPolygon(x, z, S)) { x = sp.x - sp.nx * (TILE_D / 2 + gap); z = sp.z - sp.nz * (TILE_D / 2 + gap); }
        return { x, z, r: w * 0.4, scale, w, h, rect: boxFor(x, z, w, h), gap: g };
      }
    }
    const o = TILE_D / 2 + 1.2, x = sp.x - sp.nx * o, z = sp.z - sp.nz * o;
    return { x, z, r: width * 0.2, scale: 0.4, w: width * 0.4, h: height * 0.4, rect: boxFor(x, z, width * 0.4, height * 0.4), forced: true };
  });
}
