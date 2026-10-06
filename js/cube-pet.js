/**
 * Shared playback for Kenney Cube Pets.
 * Each GLB is a node animation (idle, walk, dance, gesture-positive, …)
 * with one shared colormap. Hats attach to the cube head, not the ears.
 */

import { AnimationMixer, LoopRepeat, Color } from 'three';
import { makeAnchors } from './accessories.js';

export const NATURAL = '#ffffff';

const CLIP = {
  idle: 'idle',
  sleepy: 'idle',
  static: 'static',
  walk: 'walk',
  run: 'run',
  eat: 'eat',
  wave: 'gesture-positive',
  jump: 'dance',
  spin: 'dance',
  celebrate: 'dance',
  dance: 'dance',
  levelup: 'dance',
  wiggle: 'gesture-positive',
  confetti: 'dance',
  stars: 'gesture-positive',
  cheer: 'gesture-positive',
  signature: 'gesture-positive',
};

export function clipFor(mode) {
  return CLIP[mode] || 'idle';
}

function smooth(p) {
  const t = Math.min(1, Math.max(0, p));
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
}

/** Highest wide slice of the head cube, above the shoulder and below ear tips. */
export function hatSeat(geometry) {
  const pos = geometry.attributes.position;
  const bands = new Map();
  for (let i = 0; i < pos.count; i += 1) {
    const py = pos.getY(i);
    if (py < 1.05) continue;
    const px = pos.getX(i);
    const pz = pos.getZ(i);
    if (Math.abs(px) > 0.7 || pz < -0.35 || pz > 0.6) continue;
    const key = Math.round(py * 20) / 20;
    let band = bands.get(key);
    if (!band) {
      band = { minX: 9, maxX: -9, minZ: 9, maxZ: -9, n: 0 };
      bands.set(key, band);
    }
    if (px < band.minX) band.minX = px;
    if (px > band.maxX) band.maxX = px;
    if (pz < band.minZ) band.minZ = pz;
    if (pz > band.maxZ) band.maxZ = pz;
    band.n += 1;
  }
  const heights = [...bands.keys()].sort((a, b) => b - a);
  for (const y of heights) {
    const band = bands.get(y);
    const xw = band.maxX - band.minX;
    const zw = band.maxZ - band.minZ;
    if (band.n >= 8 && xw >= 0.55 && zw >= 0.45) return { y: y + 0.02, width: xw };
  }
  return { y: 1.27, width: 0.9 };
}

export function prepareCube(gltf, animal = '') {
  const root = gltf.scene;
  const clips = {};
  for (const clip of gltf.animations) clips[clip.name] = clip;
  const mixer = new AnimationMixer(root);
  let body = null;
  const nodes = {};
  const materials = [];
  root.traverse((obj) => {
    if (obj.name && !nodes[obj.name]) nodes[obj.name] = obj;
    if (obj.name === 'body' && !body) body = obj;
    if (!obj.isMesh) return;
    obj.castShadow = true;
    const list = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of list) {
      if (mat && !materials.includes(mat)) materials.push(mat);
    }
  });
  const anchors = makeAnchors(body || root);

  const idle = clips.idle || gltf.animations[0];
  const action = mixer.clipAction(idle);
  action.setLoop(LoopRepeat, Infinity);
  action.play();
  mixer.setTime(0);
  for (const node of [body, nodes.tail, nodes['wing-left'], nodes['wing-right']]) {
    if (!node) continue;
    node.userData.bind = {
      q: node.quaternion.clone(),
      s: node.scale.clone(),
    };
  }
  return {
    animal,
    nodes,
    root,
    mixer,
    clips,
    action,
    clipName: idle.name,
    token: 0,
    body,
    hatAnchor: anchors.hat,
    anchors,
    materials,
    baseColor: NATURAL,
  };
}

/**
 * Play the clip for `mode`. `dt` advances it; `seek` poses an exact time.
 * `token` restarts the clip when the emote changes.
 */
export function poseClip(pet, mode, dt, seek, token) {
  const name = clipFor(mode);
  const clip = pet.clips[name] || pet.clips.idle || Object.values(pet.clips)[0];
  const restart = token !== undefined && token !== pet.token;
  if (!pet.action || pet.clipName !== clip.name || restart) {
    if (pet.action) pet.action.stop();
    pet.action = pet.mixer.clipAction(clip);
    pet.action.setLoop(LoopRepeat, Infinity);
    pet.action.play();
    pet.clipName = clip.name;
    pet.token = token;
    pet.mixer.setTime(0);
  }
  const rate = mode === 'sleepy' ? 0.35 : 1;
  if (pet.action) pet.action.timeScale = rate;
  if (typeof seek === 'number') {
    const dur = Math.max(clip.duration, 0.001);
    const t = ((seek % dur) + dur) % dur;
    pet.mixer.setTime(t);
  } else if (dt) {
    pet.mixer.update(dt);
  } else {
    pet.mixer.update(0);
  }
}

export function tintMaterials(materials, hex) {
  const color = new Color(hex || NATURAL);
  for (const mat of materials) {
    if (mat.color) mat.color.copy(color);
  }
}

export function limitLightness(hex) {
  const clean = `#${String(hex || '').replace('#', '').toLowerCase()}`;
  if (!/^#[0-9a-f]{6}$/.test(clean)) return null;
  const n = parseInt(clean.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (l >= 0.34 && l <= 0.72) return clean;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  const nl = Math.min(0.72, Math.max(0.34, l));
  const hue = (p, q, t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  let rr;
  let gg;
  let bb;
  if (s === 0) rr = gg = bb = nl;
  else {
    const q = nl < 0.5 ? nl * (1 + s) : nl + s - nl * s;
    const p = 2 * nl - q;
    rr = hue(p, q, h + 1 / 3);
    gg = hue(p, q, h);
    bb = hue(p, q, h - 1 / 3);
  }
  const channel = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${channel(rr)}${channel(gg)}${channel(bb)}`;
}

/** Put procedural nodes back to the pose captured before any flourish. */
export function restoreBinds(pet) {
  if (!pet) return;
  const nodes = [pet.body, pet.nodes?.tail, pet.nodes?.['wing-left'], pet.nodes?.['wing-right']];
  for (const node of nodes) {
    const bind = node?.userData?.bind;
    if (!bind) continue;
    node.quaternion.copy(bind.q);
    node.scale.copy(bind.s);
  }
}

/**
 * Extra motion on top of the GLB clip. Holder offsets are returned so the
 * stage can move the whole pet; tail, wing, and body tweaks land on nodes
 * the mixer just posed.
 */
export function applyFlourish(pet, mode, t) {
  const out = { x: 0, y: 0, z: 0, rx: 0, rz: 0, spin: 0 };
  if (!pet) return out;
  const body = pet.body;
  const tail = pet.nodes?.tail;
  const wings = [pet.nodes?.['wing-left'], pet.nodes?.['wing-right']].filter(Boolean);
  const wag = (amp, speed) => {
    if (tail) tail.rotateY(Math.sin(t * speed) * amp);
  };
  const flap = (amp, speed) => {
    wings.forEach((wing, i) => {
      wing.rotateZ(Math.sin(t * speed) * amp * (i === 0 ? 1 : -1));
    });
  };

  if (mode === 'jump') {
    const p = Math.min(t / 1.2, 1);
    out.y = Math.sin(p * Math.PI) * 0.32;
    out.spin = smooth(p) * Math.PI * 2;
  } else if (mode === 'celebrate' || mode === 'dance') {
    const p = Math.min(t / 1.2, 1);
    out.y = Math.sin(p * Math.PI) * (mode === 'celebrate' ? 0.28 : 0.16);
  } else if (mode === 'spin') {
    out.spin = smooth(Math.min(t / 1.35, 1)) * Math.PI * 2;
  } else if (mode === 'wiggle') {
    if (body) body.rotateZ(Math.sin(t * 14) * 0.18);
    wag(0.75, 16);
  } else if (mode === 'confetti') {
    out.y = Math.abs(Math.sin(t * Math.PI * 3)) * 0.16;
  } else if (mode === 'stars' || mode === 'cheer') {
    out.y = Math.sin(Math.min(t / 1.2, 1) * Math.PI) * 0.12;
  } else if (mode === 'signature') {
    signatureFlourish(pet, t, out, { body, wag, flap });
  }
  return out;
}

function signatureFlourish(pet, t, out, { body, wag, flap }) {
  const animal = pet.animal;
  if (animal === 'dog') {
    if (body) body.rotateY(Math.sin(t * 18) * 0.55);
    wag(0.95, 22);
  } else if (animal === 'lion') {
    const pulse = Math.max(0, Math.sin(Math.min(t, 1.05) * 9));
    if (body) {
      const s = 1 + pulse * 0.14;
      body.scale.x *= s;
      body.scale.y *= s;
      body.scale.z *= 1 + pulse * 0.22;
      const open = Math.min(1, t / 0.22) * (t < 1.05 ? 1 : Math.max(0, 1 - (t - 1.05) / 0.35));
      body.rotateX(-0.32 * open);
    }
    wag(0.35, 8);
  } else if (animal === 'cat') {
    const k = t < 0.4 ? t / 0.4 : t < 1 ? 1 : Math.max(0, 1 - (t - 1) / 0.5);
    if (body) {
      body.scale.y *= 1 + k * 0.22;
      body.rotateX(-0.24 * k);
    }
    wag(0.28, 6);
  } else if (animal === 'bunny') {
    out.y = Math.abs(Math.sin(t * Math.PI * 2.2)) * 0.4;
  } else if (animal === 'penguin') {
    out.x = Math.sin(t * 8) * 0.16;
    out.z = Math.sin(Math.min(t / 1.2, 1) * Math.PI) * 0.22;
    flap(0.75, 10);
  } else if (animal === 'monkey') {
    const p = Math.min(t / 1.15, 1);
    out.rx = smooth(p) * Math.PI * 2;
    out.y = Math.sin(p * Math.PI) * 0.42;
    if (body) body.scale.x *= 1 + Math.sin(t * 18) * 0.05;
    wag(0.4, 12);
  } else if (animal === 'tiger') {
    const p = Math.min(t / 1.15, 1);
    out.z = Math.sin(p * Math.PI) * 0.55;
    out.y = Math.sin(p * Math.PI) * 0.3;
    wag(0.55, 11);
  } else if (animal === 'pig') {
    const bounce = Math.abs(Math.sin(t * 12));
    if (body) {
      body.scale.y *= 1 + bounce * 0.16;
      body.scale.x *= 1 - bounce * 0.06;
    }
    out.y = bounce * 0.08;
  } else if (animal === 'panda') {
    const p = Math.min(t / 1.35, 1);
    out.rz = smooth(p) * Math.PI * 2;
    out.x = Math.sin(p * Math.PI) * 0.12;
  } else if (animal === 'fox') {
    const p = Math.min(t / 0.95, 1);
    out.y = Math.sin(p * Math.PI) * 0.36;
    out.z = Math.sin(p * Math.PI) * 0.28;
    wag(0.65, 14);
  } else if (animal === 'koala') {
    out.rz = Math.sin(t * 3.2) * 0.24;
    if (body) body.scale.x *= 0.9 + Math.sin(t * 3.2) * 0.04;
  } else if (animal === 'chick') {
    flap(0.95, 16);
    out.y = Math.abs(Math.sin(t * 14)) * 0.07;
  }
}
