// Player characters on the board: the 2D character art stands on the tile as a camera-facing cut-out
// (classic 2.5D), swaps expressions with what is happening, flips to face where it moves and is animated
// in its own style (the car idles on its suspension, flyers flap and hover, the zombie shambles...).
import * as THREE from 'three';
import { CHARACTER_META, EXPRESSIONS } from './character-meta.js';

export const characterUrl = (id, expr = 'confident') => `/characters/${id}/${expr}.svg`;

// Which way each character faces in its art: 1 = right, -1 = left.
const FACING = { redline: 1, bug: -1, ronin: -1, moko: 1, scorch: -1, override: -1, mort: -1, talon: -1 };

/**
 * How each character moves.
 * kind: idle style (see animate()). hop: jump height between spaces. flap: wing beat (amp = sideways stretch
 * of the outer art, hz = beats per second, from = height fraction where the wings start).
 */
const STYLES = {
  redline: { kind: 'drive', hop: 0.1 },
  bug: { kind: 'skitter', hop: 0.5, flap: { amp: 0.07, hz: 7, from: 0.3 } },
  ronin: { kind: 'stance', hop: 0.8 },
  moko: { kind: 'float', hop: 0.3 },
  scorch: { kind: 'fly', hop: 1.3, flap: { amp: 0.14, hz: 2.6, from: 0.35 } },
  override: { kind: 'robot', hop: 0.55 },
  mort: { kind: 'shamble', hop: 0.35 },
  talon: { kind: 'fly', hop: 1.4, flap: { amp: 0.16, hz: 3, from: 0.3 } },
};
const DEFAULT_STYLE = { kind: 'stance', hop: 0.7 };

const TEX_HEIGHT = 512; // texture resolution; the SVGs scale cleanly to any size
const SIZE = 3.8; // largest side of a character, in board units
const LIFT = 0.1; // characters stand this fraction of their height up, so the leaning cut-out clears the tile
const textures = new Map();

// One texture per expression, drawn from the SVG as soon as it loads.
function texturesFor(id) {
  if (textures.has(id)) return textures.get(id);
  const meta = CHARACTER_META[id];
  const w = Math.round((TEX_HEIGHT * meta.width) / meta.height);
  const set = {};
  for (const expr of EXPRESSIONS) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = TEX_HEIGHT;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const img = new Image();
    img.onload = () => { canvas.getContext('2d').drawImage(img, 0, 0, w, TEX_HEIGHT); tex.needsUpdate = true; };
    img.src = characterUrl(id, expr);
    set[expr] = tex;
  }
  textures.set(id, set);
  return set;
}

// Cut-out material that can bend the art: shear (lean/sway, grows with height) and flap (stretches the
// outer parts of the art sideways above a given height, so wings beat while the body stays put).
function bendMaterial(map, u) {
  const mat = new THREE.MeshBasicMaterial({ map, transparent: true, alphaTest: 0.08, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uShear, uFlap, uFlapFrom, uTop, uHalfW;')
      .replace('#include <begin_vertex>', `vec3 transformed = vec3(position);
        float hgt = clamp(position.y / uTop, 0.0, 1.0);
        transformed.x += transformed.x * uFlap * smoothstep(uFlapFrom, 1.0, hgt) * min(1.0, abs(position.x) / uHalfW) * 2.0;
        transformed.x += uShear * position.y;`);
  };
  return mat;
}

/**
 * Character token. `tilt` is the camera pitch (radians above horizontal); the cut-out leans back by it
 * so it faces the fixed camera.
 */
export function createToken(id, color, { tilt = 0.98 } = {}) {
  const meta = CHARACTER_META[id];
  const style = STYLES[id] ?? DEFAULT_STYLE;
  const tex = texturesFor(id);
  const root = new THREE.Group();

  const k = SIZE / Math.max(meta.width, meta.height);
  const w = meta.width * k, h = meta.height * k;
  const foot = meta.footY * k; // from the top of the art
  const geo = new THREE.PlaneGeometry(w, h, 12, 12);
  geo.translate(0, foot - h / 2, 0); // feet at the origin
  const u = {
    uShear: { value: 0 }, uFlap: { value: 0 }, uFlapFrom: { value: style.flap?.from ?? 1 },
    uTop: { value: foot }, uHalfW: { value: w / 2 },
  };
  const material = bendMaterial(tex.confident, u);
  const art = new THREE.Mesh(geo, material);
  art.rotation.x = -tilt;
  art.raycast = () => {};
  art.renderOrder = 2;
  const holder = new THREE.Group(); // bob, squash and rock happen here
  holder.position.y = h * LIFT;
  holder.add(art);
  root.add(holder);
  const restY = holder.position.y;

  let expression = 'confident';
  let facing = 1;
  const phase = Math.random() * 10;
  root.userData = {
    animal: holder,
    holder,
    style,
    parts: {},
    height: h,
    setExpression(expr) {
      if (expr === expression || !tex[expr]) return;
      expression = expr;
      material.map = tex[expr];
    },
    // Mirror the art so the character faces the way it is moving on screen (dir: -1 left, 1 right).
    setFacing(dir) {
      if (!dir) return;
      facing = dir;
      art.scale.x = dir === (FACING[id] ?? 1) ? 1 : -1;
    },
    /**
     * Per-frame animation in the character's own style: bob, squash, rock, sway and wing beat.
     * s: { active, moving, hop (0..1 progress of the current hop while moving) }.
     */
    animate(time, s) {
      const t = time + phase;
      const flap = style.flap ? Math.sin(t * style.flap.hz * Math.PI * 2) : 0;
      let y = 0, sx = 1, sy = 1, rock = 0, shear = 0, wings = style.flap ? flap * style.flap.amp : 0;
      if (s.moving) {
        const arc = Math.sin((s.hop ?? 0) * Math.PI);
        switch (style.kind) {
          case 'drive': // rolls along, leaning into the drive
            y = Math.abs(Math.sin(t * 22)) * 0.04; shear = 0.12 * facing; rock = 0.04 * Math.sin(t * 9); break;
          case 'float': // glides on the cloud
            y = 0.35 + Math.sin(t * 4) * 0.08; rock = -0.06 * facing; break;
          case 'fly': // flies with fast beats
            y = 0.5; wings = Math.sin(t * style.flap.hz * 2.2 * Math.PI * 2) * style.flap.amp * 1.2; break;
          case 'robot': // heavy stomp: squashes on landing
            sy = 1 - (1 - arc) * 0.12; sx = 1 + (1 - arc) * 0.08; rock = Math.round(Math.sin(t * 6)) * 0.03; break;
          case 'shamble': // lurching hops
            shear = Math.sin(t * 7) * 0.12; rock = Math.sin(t * 7) * 0.08; break;
          case 'skitter': // scuttles with buzzing wings
            shear = Math.sin(t * 30) * 0.05; wings *= 1.6; break;
          default: { const sq = 1 + arc * 0.12; sx = 1 / sq; sy = sq; } // stretches in the air
        }
      } else {
        const boost = s.active ? 1 : 0; // the active player is livelier
        switch (style.kind) {
          case 'drive': // engine idling on its suspension, revs now and then
            y = Math.abs(Math.sin(t * 20)) * (0.015 + boost * 0.02);
            rock = Math.sin(t * 1.7) * 0.02 + (Math.sin(t * 0.7) > 0.95 ? Math.sin(t * 40) * 0.03 : 0);
            sy = 1 - Math.abs(Math.sin(t * 20)) * 0.01;
            break;
          case 'skitter': // twitchy beetle: quick shuffles and buzzing wings
            shear = Math.sin(t * 5) * 0.04 + (Math.sin(t * 1.3) > 0.8 ? Math.sin(t * 25) * 0.05 : 0);
            y = Math.abs(Math.sin(t * 4)) * (0.05 + boost * 0.12);
            break;
          case 'float': // bobs on its cloud
            y = 0.3 + Math.sin(t * 1.8) * (0.14 + boost * 0.08);
            rock = Math.sin(t * 1.1) * 0.05;
            break;
          case 'fly': // hovers in time with the wing beat
            y = 0.35 + boost * 0.15 - flap * 0.1;
            rock = Math.sin(t * 0.9) * 0.03;
            break;
          case 'robot': // mechanical: weight shifts in steps, servo bob
            rock = Math.round(Math.sin(t * 1.4) * 2) * 0.015;
            y = (Math.sin(t * 2.4) > 0 ? 0.04 : 0) + (boost ? Math.abs(Math.round(Math.sin(t * 3.2) * 2) / 2) * 0.12 : 0);
            sy = 1 + (Math.sin(t * 2.4) > 0 ? 0.015 : 0);
            break;
          case 'shamble': // slow zombie sway, arms out
            shear = Math.sin(t * 1.5) * 0.09;
            rock = Math.sin(t * 1.5 + 0.6) * 0.06;
            y = Math.abs(Math.sin(t * 1.5)) * (0.04 + boost * 0.1);
            break;
          default: // stance: steady breathing, ready to strike
            sy = 1 + Math.sin(t * 2.2) * 0.03;
            sx = 1 - Math.sin(t * 2.2) * 0.012;
            shear = Math.sin(t * 1.1) * 0.025;
            y = boost ? Math.abs(Math.sin(t * 3.2)) * 0.18 : 0;
        }
      }
      holder.position.y = restY + y;
      holder.scale.set(sx, sy, 1);
      holder.rotation.z = rock;
      u.uShear.value = shear;
      u.uFlap.value = wings;
    },
    // Mood poses on top of the idle animation: a happy jump, or a wince while paying.
    moodPose(mood, age) {
      if (mood === 'celebrate') holder.position.y = restY + Math.abs(Math.sin(age * 9)) * 0.8;
      else holder.scale.set(1 + Math.sin(age * 20) * 0.08, 1 - Math.sin(age * 20) * 0.1, 1);
    },
  };
  return root;
}
