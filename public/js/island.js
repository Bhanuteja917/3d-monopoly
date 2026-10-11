// The island and the sea around it. The sand follows the map: a blurred-and-thresholded union of the
// track (plus a strip of beach) and every landmark's base, so bays become sea inlets and there is no
// spare beach beyond the board. The sea is an animated shader: turquoise shallows along the coast, deep
// blue further out, moving ripples and glints.
import * as THREE from 'three';
import { pointInPolygon } from './track.js';

const PPU = 16; // canvas pixels per board unit
const BEACH = 2.0; // sand beyond the cards' outer edge
const SEA_Y = -0.6;
export const SAND_Y = -0.25;

/**
 * samples: track centreline; land: the grass area's outline (defaults to the centreline); trackHalf: half
 * the track depth; landmarks: placed landmark bases.
 * Returns { group, update(t), isLand(x, z), coast: [{x, z, nx, nz}], bounds } where bounds is the sand's box.
 */
export function buildIsland({ samples, land = samples, trackHalf, landmarks }) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const grow = (x, z, r) => { minX = Math.min(minX, x - r); maxX = Math.max(maxX, x + r); minZ = Math.min(minZ, z - r); maxZ = Math.max(maxZ, z + r); };
  const discs = [];
  for (let i = 0; i < samples.length; i += 2) discs.push([samples[i][0], samples[i][1], trackHalf + BEACH]);
  for (const l of landmarks) if (l) discs.push([l.x, l.z - l.w * 0.08, l.w * 0.45 + 0.6]);
  for (const [x, z, r] of discs) grow(x, z, r);
  const M = 14; // room for the shallows and the canvas edge
  minX -= M; maxX += M; minZ -= M; maxZ += M;
  const W = Math.ceil((maxX - minX) * PPU), H = Math.ceil((maxZ - minZ) * PPU);
  const P = (x, z) => [(x - minX) * PPU, (z - minZ) * PPU];

  // Land mask: discs + the whole land (the infield and any bay between the track's arms, with a strip
  // of beach along its edge), blurred so the coast comes out smooth after the threshold.
  const mask = document.createElement('canvas');
  mask.width = W; mask.height = H;
  const m = mask.getContext('2d');
  m.filter = `blur(${Math.round(PPU * 0.9)}px)`;
  m.fillStyle = m.strokeStyle = '#fff';
  m.lineJoin = 'round';
  m.lineWidth = 2 * (trackHalf + BEACH) * PPU;
  m.beginPath();
  land.forEach(([x, z], k) => m[k ? 'lineTo' : 'moveTo'](...P(x, z)));
  m.closePath();
  m.fill();
  m.stroke();
  for (const [x, z, r] of discs) { m.beginPath(); m.arc(...P(x, z), r * PPU, 0, Math.PI * 2); m.fill(); }
  const a = m.getImageData(0, 0, W, H).data;
  const at = (x, z) => {
    const px = Math.floor((x - minX) * PPU), pz = Math.floor((z - minZ) * PPU);
    if (px < 0 || pz < 0 || px >= W || pz >= H) return 0;
    return a[(pz * W + px) * 4 + 3] / 255;
  };
  const isLand = (x, z) => at(x, z) > 0.5;

  // Sand: dry sand, a darker wet band at the waterline, ripples of foam just offshore; grain speckle.
  const sand = document.createElement('canvas');
  sand.width = W; sand.height = H;
  const g = sand.getContext('2d');
  const img = g.createImageData(W, H);
  const d = img.data;
  let seed = 9;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let sx0 = Infinity, sx1 = -Infinity, sz0 = Infinity, sz1 = -Infinity;
  for (let i = 0; i < W * H; i++) {
    const v = a[i * 4 + 3] / 255;
    let r = 0, gg = 0, b = 0, al = 0;
    if (v > 0.5) {
      const n = (rnd() - 0.5) * 18;
      const dry = Math.min(1, (v - 0.5) / 0.12); // wet near the waterline, dry further up
      r = 222 + 23 * dry + n; gg = 190 + 30 * dry + n; b = 128 + 26 * dry + n; al = 255;
      const x = i % W, z = (i / W) | 0;
      if (x < sx0) sx0 = x; if (x > sx1) sx1 = x; if (z < sz0) sz0 = z; if (z > sz1) sz1 = z;
    } else if (v > 0.38) { r = 255; gg = 255; b = 255; al = 150 * ((v - 0.38) / 0.12); } // foam line
    d[i * 4] = r; d[i * 4 + 1] = gg; d[i * 4 + 2] = b; d[i * 4 + 3] = al;
  }
  g.putImageData(img, 0, 0);
  const sandTex = new THREE.CanvasTexture(sand);
  sandTex.colorSpace = THREE.SRGBColorSpace;
  sandTex.anisotropy = 8;
  const group = new THREE.Group();
  const top = new THREE.Mesh(new THREE.PlaneGeometry(maxX - minX, maxZ - minZ), new THREE.MeshLambertMaterial({ map: sandTex, transparent: true, alphaTest: 0.02 }));
  top.rotation.x = -Math.PI / 2;
  top.position.set((minX + maxX) / 2, SAND_Y, (minZ + maxZ) / 2);
  top.receiveShadow = true;
  top.raycast = () => {};
  group.add(top);

  // Shallows map for the sea shader: the land mask blurred far out (1 at the coast, 0 in deep water).
  const depth = document.createElement('canvas');
  depth.width = Math.ceil(W / 4); depth.height = Math.ceil(H / 4);
  const dg = depth.getContext('2d');
  dg.filter = `blur(${Math.round(PPU * 1.2)}px)`;
  dg.drawImage(mask, 0, 0, depth.width, depth.height);
  dg.filter = 'none';
  dg.globalCompositeOperation = 'source-over';
  dg.drawImage(mask, 0, 0, depth.width, depth.height);
  const depthTex = new THREE.CanvasTexture(depth);

  const uniforms = {
    uTime: { value: 0 },
    uDepth: { value: depthTex },
    uMin: { value: new THREE.Vector2(minX, minZ) },
    uSize: { value: new THREE.Vector2(maxX - minX, maxZ - minZ) },
  };
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(600, 600, 1, 1), new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `varying vec2 vW;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime; uniform sampler2D uDepth; uniform vec2 uMin, uSize; varying vec2 vW;
      float wave(vec2 p, vec2 d, float f, float s) { return sin(dot(p, d) * f + uTime * s); }
      void main() {
        vec2 uv = (vW - uMin) / uSize;
        float sh = (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? 0.0 : texture2D(uDepth, vec2(uv.x, 1.0 - uv.y)).a; // canvas row 0 is minZ and canvas textures are flipped
        vec3 deep = vec3(0.03, 0.33, 0.62), mid = vec3(0.06, 0.55, 0.80), shallow = vec3(0.30, 0.86, 0.88);
        vec3 c = mix(deep, mid, smoothstep(0.0, 0.25, sh));
        c = mix(c, shallow, smoothstep(0.25, 0.75, sh));
        float r = wave(vW, vec2(0.8, 0.6), 1.3, 1.1) + wave(vW, vec2(-0.5, 0.9), 1.9, 1.6) + wave(vW, vec2(0.95, -0.3), 3.1, 2.3) * 0.5;
        c += 0.035 * r;
        float glint = smoothstep(2.05, 2.4, r + wave(vW, vec2(0.2, 1.0), 6.0, 3.0) * 0.6);
        c += glint * 0.35;
        float foam = smoothstep(0.62, 0.7, sh) * (0.5 + 0.5 * sin(sh * 60.0 - uTime * 2.0));
        c = mix(c, vec3(1.0), foam * 0.16);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.set((minX + maxX) / 2, SEA_Y, (minZ + maxZ) / 2);
  sea.raycast = () => {};
  group.add(sea);

  // Coastline points with the outward (seaward) normal, for quays and moorings.
  const coast = [];
  for (let z = minZ + 1; z < maxZ - 1; z += 0.75) for (let x = minX + 1; x < maxX - 1; x += 0.75) {
    if (!isLand(x, z)) continue;
    const gx = at(x + 0.6, z) - at(x - 0.6, z), gz = at(x, z + 0.6) - at(x, z - 0.6);
    const len = Math.hypot(gx, gz);
    if (len < 0.25 || at(x, z) > 0.75) continue;
    coast.push({ x, z, nx: -gx / len, nz: -gz / len });
  }

  return {
    group,
    isLand,
    inInfield: (x, z) => pointInPolygon(x, z, land),
    coast,
    bounds: { minX: minX + sx0 / PPU, maxX: minX + sx1 / PPU, minZ: minZ + sz0 / PPU, maxZ: minZ + sz1 / PPU },
    update(t) { uniforms.uTime.value = t; },
  };
}
