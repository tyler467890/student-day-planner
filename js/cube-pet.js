/**
 * Shared playback for Kenney Cube Pets.
 * Each GLB is a node animation (idle, walk, dance, gesture-positive, …)
 * with one shared colormap. Hats attach to the cube head, not the ears.
 */

import {
  AnimationMixer, Group, Mesh, SphereGeometry, MeshBasicMaterial, LoopRepeat, Color,
} from 'three';

export const NATURAL = '#ffffff';

const CLIP = {
  idle: 'idle',
  sleepy: 'idle',
  walk: 'walk',
  wave: 'gesture-positive',
  jump: 'dance',
  spin: 'dance',
  celebrate: 'dance',
};

export function clipFor(mode) {
  return CLIP[mode] || 'idle';
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

function faceFront(geometry, y) {
  const pos = geometry.attributes.position;
  let maxZ = 0.35;
  for (let i = 0; i < pos.count; i += 1) {
    if (Math.abs(pos.getY(i) - y) > 0.1) continue;
    if (Math.abs(pos.getX(i)) > 0.28) continue;
    if (pos.getZ(i) > maxZ) maxZ = pos.getZ(i);
  }
  return maxZ;
}

export function prepareCube(gltf) {
  const root = gltf.scene;
  const clips = {};
  for (const clip of gltf.animations) clips[clip.name] = clip;
  const mixer = new AnimationMixer(root);
  let body = null;
  const materials = [];
  root.traverse((obj) => {
    if (obj.name === 'body' && !body) body = obj;
    if (!obj.isMesh) return;
    obj.castShadow = true;
    const list = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of list) {
      if (mat && !materials.includes(mat)) materials.push(mat);
    }
  });
  const seat = body && body.geometry ? hatSeat(body.geometry) : { y: 1.27, width: 0.9 };
  const hatAnchor = new Group();
  hatAnchor.name = 'hat_anchor';
  hatAnchor.position.set(0, seat.y, 0.02);
  const hatScale = Math.min(1.15, Math.max(0.9, seat.width / 0.95));
  hatAnchor.scale.setScalar(hatScale);
  (body || root).add(hatAnchor);

  const blush = new Group();
  blush.name = 'cheeks';
  const blushMat = new MeshBasicMaterial({
    color: 0xff9eb8,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
  });
  const front = body && body.geometry ? faceFront(body.geometry, seat.y - 0.3) : 0.5;
  for (const side of [-1, 1]) {
    const cheek = new Mesh(new SphereGeometry(1, 10, 8), blushMat);
    cheek.scale.set(0.065, 0.038, 0.02);
    cheek.position.set(side * 0.18, seat.y - 0.32, front + 0.015);
    cheek.renderOrder = 2;
    blush.add(cheek);
  }
  (body || root).add(blush);

  const idle = clips.idle || gltf.animations[0];
  const action = mixer.clipAction(idle);
  action.setLoop(LoopRepeat, Infinity);
  action.play();
  mixer.setTime(0);
  return {
    root,
    mixer,
    clips,
    action,
    clipName: idle.name,
    token: 0,
    body,
    hatAnchor,
    blush,
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
  if (typeof seek === 'number') {
    const dur = Math.max(clip.duration, 0.001);
    const t = ((seek % dur) + dur) % dur;
    pet.mixer.setTime(t);
  } else if (dt) {
    const rate = mode === 'sleepy' ? 0.35 : 1;
    pet.mixer.update(dt * rate);
  } else {
    pet.mixer.update(0);
  }
  if (mode === 'sleepy' && pet.body) pet.body.rotateX(0.2);
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
