/**
 * Cube-style accessories for Kenney Cube Pets.
 * Item positions follow the Blender fit (head top at y = 1.431).
 * Groups hang off the body so they move with the clips.
 */

import {
  Group, Mesh, BoxGeometry, ConeGeometry, CylinderGeometry, SphereGeometry,
  MeshPhysicalMaterial, BufferGeometry, BufferAttribute,
  Box3, Vector3,
} from 'three';
import { itemById } from './shop.js';

const BODY_Y = 0.18125;
const TOP = 1.431;
const FRONT = -0.625;

// The brim is already built on the cube top (y = 1.431). A positive hat
// lift opens a gap under the brim, so these stay at 0 and the brim rests
// on the head. Penguin, chick and monkey shift back a hair so the hat
// sits over the front tuft. The bunny hat sits on the front of the head,
// in front of the ears, tipped forward. The lion's
// brim sinks into the mane because the mane rises above the cube.
export const PET_FIT = {
  dog: { hat: 0, face: 0.78, neck: 0.4, top: 1.62, wide: 0.82 },
  cat: { hat: 0, face: 0.72, neck: 0.38, top: 1.68, wide: 0.84 },
  bunny: { hat: -0.02, face: 0.78, neck: 0.4, top: 2.12, wide: 0.9, hatZ: 0.5, hatScale: 0.66, hatTilt: 0.38 },
  penguin: { hat: 0, face: 0.8, neck: 0.5, top: 1.7, wide: 1.15, hatZ: -0.03, winged: true },
  monkey: { hat: 0, face: 0.76, neck: 0.44, top: 1.7, wide: 1.2, hatZ: -0.03 },
  tiger: { hat: 0, face: 0.74, neck: 0.4, top: 1.64, wide: 0.9 },
  pig: { hat: 0, face: 0.8, neck: 0.44, top: 1.62, wide: 0.84 },
  lion: { hat: 0, face: 0.76, neck: 0.42, top: 1.9, wide: 1.05 },
  panda: { hat: 0, face: 0.74, neck: 0.4, top: 1.58, wide: 0.9 },
  fox: { hat: 0, face: 0.74, neck: 0.4, top: 1.78, wide: 0.88 },
  koala: { hat: 0, face: 0.72, neck: 0.38, top: 1.56, wide: 1.05 },
  chick: { hat: 0, face: 0.8, neck: 0.5, top: 1.7, wide: 1.12, hatZ: -0.03, winged: true },
};

const GLB = {
  glasses: new URL('../items/glbs/mini/aid-glasses.glb', import.meta.url).href,
  sunglasses: new URL('../items/glbs/mini/aid-sunglasses.glb', import.meta.url).href,
  hat: new URL('../items/glbs/holiday/snowman-hat.glb', import.meta.url).href,
  heart: new URL('../items/glbs/platformer/heart.glb', import.meta.url).href,
  star: new URL('../items/glbs/platformer/star.glb', import.meta.url).href,
  jewel: new URL('../items/glbs/platformer/jewel.glb', import.meta.url).href,
  snowA: new URL('../items/glbs/holiday/snowflake-a.glb', import.meta.url).href,
  snowB: new URL('../items/glbs/holiday/snowflake-b.glb', import.meta.url).href,
  snowC: new URL('../items/glbs/holiday/snowflake-c.glb', import.meta.url).href,
};

const mats = new Map();
let loader = null;
const scenes = new Map();
let hatTemplate = null;

export function bindLoader(gltfLoader) {
  loader = gltfLoader;
}

function vinyl(hex, opts = {}) {
  const key = `${hex}|${opts.metal || 0}|${opts.emit || 0}|${opts.rough ?? 0.5}`;
  let mat = mats.get(key);
  if (mat) return mat;
  mat = new MeshPhysicalMaterial({
    color: hex,
    roughness: opts.rough ?? 0.5,
    metalness: opts.metal || 0,
    clearcoat: 0.2,
    emissive: opts.emit ? hex : 0x000000,
    emissiveIntensity: opts.emit || 0,
  });
  mats.set(key, mat);
  return mat;
}

function box(parent, loc, size, color, opts = {}) {
  const mesh = new Mesh(new BoxGeometry(size[0], size[2], size[1]), vinyl(color, opts));
  mesh.position.set(loc[0], loc[2], -loc[1]);
  if (opts.rot) {
    const [rx, ry, rz] = opts.rot;
    mesh.rotation.set((rx || 0) * Math.PI / 180, (rz || 0) * Math.PI / 180, -(ry || 0) * Math.PI / 180);
  }
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function pyramid(parent, loc, radius, height, color, opts = {}) {
  const sides = opts.sides || 4;
  const mesh = new Mesh(new ConeGeometry(radius, height, sides), vinyl(color, opts));
  mesh.position.set(loc[0], loc[2], -loc[1]);
  if (sides === 4) mesh.rotation.y = Math.PI / 4;
  if (opts.tilt) mesh.rotation.x += opts.tilt;
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function ball(parent, loc, radius, color, opts = {}) {
  const mesh = new Mesh(new SphereGeometry(radius, 16, 12), vinyl(color, opts));
  mesh.position.set(loc[0], loc[2], -loc[1]);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function ring(parent, z, half, thick, h, color, opts = {}) {
  const a = half - thick / 2;
  const bars = [
    [0, -a, 2 * half, thick],
    [0, a, 2 * half, thick],
    [-a, 0, thick, 2 * half - 2 * thick + 0.02],
    [a, 0, thick, 2 * half - 2 * thick + 0.02],
  ];
  if (opts.openSides) bars.splice(2, 2);
  for (const [x, y, sx, sy] of bars) box(parent, [x, y, z], [sx, sy, h], color, opts);
}

function loadScene(url) {
  if (!loader) return Promise.reject(new Error('no loader'));
  if (scenes.has(url)) return scenes.get(url);
  const task = loader.loadAsync(url).then((gltf) => gltf.scene);
  scenes.set(url, task);
  return task;
}

function cutBelow(geometry, minY) {
  const src = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = src.attributes.position;
  const normal = src.attributes.normal;
  const uv = src.attributes.uv;
  const keep = [];
  for (let i = 0; i < pos.count; i += 3) {
    const y0 = pos.getY(i);
    const y1 = pos.getY(i + 1);
    const y2 = pos.getY(i + 2);
    if (y0 >= minY && y1 >= minY && y2 >= minY) keep.push(i, i + 1, i + 2);
  }
  const next = new BufferGeometry();
  const count = keep.length;
  const p = new Float32Array(count * 3);
  const n = normal ? new Float32Array(count * 3) : null;
  const t = uv ? new Float32Array(count * 2) : null;
  for (let k = 0; k < count; k += 1) {
    const i = keep[k];
    p[k * 3] = pos.getX(i);
    p[k * 3 + 1] = pos.getY(i);
    p[k * 3 + 2] = pos.getZ(i);
    if (n) {
      n[k * 3] = normal.getX(i);
      n[k * 3 + 1] = normal.getY(i);
      n[k * 3 + 2] = normal.getZ(i);
    }
    if (t) {
      t[k * 2] = uv.getX(i);
      t[k * 2 + 1] = uv.getY(i);
    }
  }
  next.setAttribute('position', new BufferAttribute(p, 3));
  if (n) next.setAttribute('normal', new BufferAttribute(n, 3));
  if (t) next.setAttribute('uv', new BufferAttribute(t, 2));
  return next;
}

async function placeGlb(parent, url, loc, scale, rotY = 0) {
  const src = await loadScene(url);
  const obj = src.clone(true);
  obj.position.set(loc[0], loc[2], -loc[1]);
  obj.scale.setScalar(scale);
  if (rotY) obj.rotation.y = rotY * Math.PI / 180;
  obj.traverse((mesh) => {
    if (mesh.isMesh) mesh.castShadow = true;
  });
  parent.add(obj);
  return obj;
}

async function topHat(parent) {
  if (!hatTemplate) {
    const src = await loadScene(GLB.hat);
    const base = src.clone(true);
    base.traverse((mesh) => {
      if (!mesh.isMesh || !mesh.geometry) return;
      mesh.geometry = cutBelow(mesh.geometry, 1.06);
      mesh.geometry.computeBoundingBox();
    });
    const bounds = new Box3().setFromObject(base);
    const minY = bounds.min.y;
    const center = bounds.getCenter(new Vector3());
    base.scale.setScalar(2.2);
    base.position.set(-center.x * 2.2, (TOP - 0.02) - minY * 2.2, -center.z * 2.2);
    hatTemplate = base;
  }
  const hat = hatTemplate.clone(true);
  parent.add(hat);
}

function partyHat(parent) {
  pyramid(parent, [0.08, 0, TOP + 0.42], 0.36, 0.84, '#ff6fa8');
  box(parent, [0.08, 0, TOP + 0.08], [0.78, 0.78, 0.1], '#ffd23f');
  box(parent, [0.08, 0, TOP + 0.86], [0.16, 0.16, 0.16], '#fff3a0');
}

function beanie(parent) {
  box(parent, [0, 0, TOP + 0.16], [1.22, 1.22, 0.38], '#4fb3ff');
  ring(parent, TOP + 0.02, 0.64, 0.12, 0.16, '#ffffff');
  ball(parent, [0, 0, TOP + 0.4], 0.12, '#ffffff');
}

function cap(parent) {
  box(parent, [0, -0.02, TOP + 0.14], [1.12, 1.02, 0.28], '#ff5a5f');
  box(parent, [0, FRONT - 0.08, TOP + 0.04], [0.96, 0.42, 0.06], '#ff5a5f');
  box(parent, [0, 0.02, TOP + 0.3], [0.14, 0.14, 0.06], '#ffffff');
}

function flowerCrown(parent) {
  ring(parent, TOP + 0.02, 0.66, 0.08, 0.08, '#6bcb77');
  const cols = ['#ff7eb6', '#ffd23f', '#b388ff', '#ff9f43'];
  const pts = [[-0.55, -0.55], [0, -0.62], [0.55, -0.55], [0.62, 0], [0.55, 0.55], [0, 0.62], [-0.55, 0.55], [-0.62, 0]];
  pts.forEach(([x, y], i) => {
    box(parent, [x, y, TOP + 0.08], [0.22, 0.22, 0.14], cols[i % 4]);
    box(parent, [x, y, TOP + 0.16], [0.08, 0.08, 0.06], '#ffffff');
  });
}

function gradCap(parent) {
  box(parent, [0, 0, TOP + 0.1], [0.92, 0.92, 0.22], '#2d2f48');
  box(parent, [0, 0, TOP + 0.24], [1.35, 1.35, 0.07], '#2d2f48');
  box(parent, [0.55, -0.15, TOP + 0.18], [0.04, 0.04, 0.36], '#ffd23f');
  ball(parent, [0.55, -0.15, TOP + 0.02], 0.06, '#ffd23f');
}

async function wizardHat(parent) {
  box(parent, [0, 0, TOP + 0.04], [1.35, 1.35, 0.08], '#7b5cff');
  pyramid(parent, [0, 0.02, TOP + 0.58], 0.48, 1.05, '#7b5cff');
  await placeGlb(parent, GLB.star, [0, -0.28, TOP + 0.38], 0.55, -12);
}

function flameBand(parent) {
  ring(parent, TOP - 0.02, 0.66, 0.1, 0.16, '#ff6b35');
  [[-0.28, 0.38], [0, 0.55], [0.28, 0.38]].forEach(([x, h], i) => {
    const flame = pyramid(parent, [x, FRONT + 0.02, TOP + h / 2], 0.12, h, '#ffb627', { emit: 0.35 });
    flame.userData.fx = 'flame';
    flame.userData.phase = i;
  });
}

function sprout(parent) {
  box(parent, [0, 0, TOP + 0.2], [0.1, 0.1, 0.36], '#4caf50');
  box(parent, [-0.16, 0, TOP + 0.36], [0.32, 0.08, 0.16], '#6bcb77', { rot: [0, 18, 25] });
  box(parent, [0.16, 0, TOP + 0.42], [0.32, 0.08, 0.16], '#8be08f', { rot: [0, -18, -25] });
}

async function crown(parent) {
  const gold = '#ffc83d';
  ring(parent, TOP + 0.12, 0.62, 0.12, 0.28, gold, { metal: 0.55, rough: 0.35 });
  [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [0, -0.62]].forEach(([x, y]) => {
    box(parent, [x, y, TOP + 0.32], [0.16, 0.16, 0.16], gold, { metal: 0.55, rough: 0.35 });
  });
  await placeGlb(parent, GLB.jewel, [0, FRONT - 0.02, TOP + 0.16], 0.55);
}

async function glasses(parent, sun) {
  await placeGlb(parent, sun ? GLB.sunglasses : GLB.glasses, [0, -0.48, 0.78], 3.4);
}

function bowTie(parent) {
  const z = 0.42;
  const y = FRONT - 0.02;
  box(parent, [-0.16, y, z], [0.24, 0.16, 0.16], '#ff4f79', { rot: [0, 0, 18] });
  box(parent, [0.16, y, z], [0.24, 0.16, 0.16], '#ff4f79', { rot: [0, 0, -18] });
  box(parent, [0, y - 0.02, z], [0.1, 0.1, 0.12], '#e03a63');
}

function scarf(parent) {
  ring(parent, 0.46, 0.7, 0.14, 0.18, '#ff6b6b');
  ring(parent, 0.5, 0.72, 0.06, 0.05, '#ffffff');
  box(parent, [0.22, FRONT - 0.06, 0.22], [0.22, 0.1, 0.42], '#ff6b6b');
  box(parent, [0.24, FRONT - 0.1, 0.08], [0.24, 0.04, 0.06], '#ffffff');
}

function backpack(parent, winged) {
  const y = 0.72;
  box(parent, [0, y, 0.72], [0.78, 0.32, 0.72], '#ffb627');
  box(parent, [0, y + 0.02, 0.95], [0.7, 0.28, 0.28], '#ff8c42');
  if (!winged) {
    box(parent, [-0.32, 0.15, 0.85], [0.1, 0.08, 0.55], '#ff8c42');
    box(parent, [0.32, 0.15, 0.85], [0.1, 0.08, 0.55], '#ff8c42');
  }
}

async function hearts(parent) {
  const spots = [[-0.85, -0.15, 1.55, 0.7], [0.9, 0.05, 1.85, 0.55], [0.7, -0.2, 1.15, 0.42]];
  for (const [x, y, z, s] of spots) {
    const heart = await placeGlb(parent, GLB.heart, [x, y, z], s, 10);
    heart.userData.fx = 'bob';
    heart.userData.baseY = heart.position.y;
    heart.userData.amp = 0.08;
    heart.userData.speed = 1.6;
    heart.userData.phase = x;
  }
}

async function sparkles(parent) {
  const spots = [[-0.8, -0.1, 1.6, 0.55], [0.85, 0.05, 1.9, 0.45], [0.55, -0.25, 1.2, 0.36]];
  for (const [x, y, z, s] of spots) {
    const star = await placeGlb(parent, GLB.star, [x, y, z], s);
    star.userData.fx = 'bob';
    star.userData.baseY = star.position.y;
    star.userData.amp = 0.07;
    star.userData.speed = 1.8;
    star.userData.phase = z;
  }
}

function tutu(parent, winged) {
  const z = 0.32;
  const half = winged ? 0.62 : 0.86;
  ring(parent, z, half, 0.16, 0.12, '#ff7eb6', { openSides: winged });
  ring(parent, z - 0.08, half + 0.08, 0.1, 0.08, '#ffd0e4', { openSides: winged });
}

function heroMask(parent) {
  box(parent, [0, FRONT - 0.02, 0.78], [1.05, 0.08, 0.28], '#2d2f48');
  box(parent, [-0.22, FRONT - 0.04, 0.78], [0.22, 0.06, 0.14], '#ffe08a');
  box(parent, [0.22, FRONT - 0.04, 0.78], [0.22, 0.06, 0.14], '#ffe08a');
}

function sweater(parent, winged) {
  const color = '#6d4aff';
  const stripe = '#ffffff';
  if (winged) {
    box(parent, [0, FRONT + 0.02, 0.62], [1.2, 0.1, 0.55], color);
    box(parent, [0, 0.62, 0.62], [1.2, 0.1, 0.55], color);
    box(parent, [0, FRONT + 0.04, 0.72], [1.16, 0.06, 0.1], stripe);
  } else {
    ring(parent, 0.62, 0.7, 0.1, 0.5, color);
    ring(parent, 0.74, 0.72, 0.06, 0.1, stripe);
  }
}

function cape(parent) {
  box(parent, [0, 0.78, 0.7], [0.9, 0.08, 0.9], '#c23b4a');
  box(parent, [0, 0.7, 1.05], [0.95, 0.08, 0.16], '#ffd23f');
}

async function snowfall(parent) {
  const files = [GLB.snowA, GLB.snowB, GLB.snowC];
  for (let i = 0; i < 7; i += 1) {
    const flake = await placeGlb(parent, files[i % 3], [0, 0, 1.2], 0.35);
    flake.position.set((i % 3) - 1, 1.5, (i % 2 ? 0.4 : -0.3));
    flake.userData.fx = 'snow';
    flake.userData.top = 1.9;
    flake.userData.span = 1.5;
    flake.userData.speed = 0.18 + (i % 3) * 0.05;
    flake.userData.phase = i * 0.17;
  }
}

function wingPair(parent, color, metal = 0) {
  box(parent, [-0.85, 0.15, 0.75], [0.7, 0.08, 0.55], color, { metal, rot: [0, 0, 18] });
  box(parent, [0.85, 0.15, 0.75], [0.7, 0.08, 0.55], color, { metal, rot: [0, 0, -18] });
  box(parent, [-0.55, 0.2, 0.95], [0.4, 0.06, 0.28], color, { metal });
  box(parent, [0.55, 0.2, 0.95], [0.4, 0.06, 0.28], color, { metal });
}

function jetpack(parent) {
  box(parent, [0, 0.7, 0.85], [0.7, 0.28, 0.45], '#d9dde8', { metal: 0.35 });
  [[-0.22], [0.22]].forEach(([x], i) => {
    box(parent, [x, 0.78, 0.7], [0.22, 0.22, 0.7], '#8d93a8', { metal: 0.4 });
    const flame = pyramid(parent, [x, 0.78, 0.28], 0.1, 0.28, '#ff7a45', { emit: 0.45 });
    flame.rotation.x = Math.PI;
    flame.userData.fx = 'flame';
    flame.userData.phase = i;
  });
}

async function heartCheeks(parent) {
  await placeGlb(parent, GLB.heart, [-0.32, -0.5, 0.62], 0.32);
  await placeGlb(parent, GLB.heart, [0.32, -0.5, 0.62], 0.32);
}

function bellCollar(parent) {
  ring(parent, 0.4, 0.68, 0.08, 0.1, '#ffd23f', { metal: 0.45 });
  ball(parent, [0, FRONT - 0.04, 0.3], 0.1, '#ffe58a', { metal: 0.35 });
}

async function starMedal(parent) {
  box(parent, [0, FRONT - 0.02, 0.7], [0.16, 0.06, 0.45], '#e23b4a');
  box(parent, [-0.12, FRONT, 0.95], [0.1, 0.05, 0.22], '#e23b4a', { rot: [0, 0, 28] });
  box(parent, [0.12, FRONT, 0.95], [0.1, 0.05, 0.22], '#e23b4a', { rot: [0, 0, -28] });
  await placeGlb(parent, GLB.star, [0, FRONT - 0.08, 0.42], 0.55);
}

function rainbow(parent) {
  const cols = ['#ff5a7a', '#ffb627', '#ffe14a', '#3dce7a', '#4aa3ff', '#7b5cff'];
  cols.forEach((color, i) => {
    const ringMesh = new Mesh(
      new CylinderGeometry(0.95 + i * 0.015, 0.95, 0.05, 28, 1, true),
      vinyl(color, { emit: 0.25, rough: 0.4 }),
    );
    ringMesh.position.y = 0.7;
    ringMesh.userData.fx = 'spin';
    ringMesh.userData.speed = 0.4 + i * 0.05;
    parent.add(ringMesh);
  });
}

const BUILDERS = {
  party_hat: async (p) => partyHat(p),
  beanie: async (p) => beanie(p),
  cap: async (p) => cap(p),
  flower_crown: async (p) => flowerCrown(p),
  top_hat: async (p) => topHat(p),
  grad_cap: async (p) => gradCap(p),
  wizard_hat: async (p) => wizardHat(p),
  flame_band: async (p) => flameBand(p),
  sprout: async (p) => sprout(p),
  crown: async (p) => crown(p),
  round_glasses: async (p) => glasses(p, false),
  sunglasses: async (p) => glasses(p, true),
  heart_cheeks: async (p) => heartCheeks(p),
  hero_mask: async (p) => heroMask(p),
  bow_tie: async (p) => bowTie(p),
  scarf: async (p) => scarf(p),
  bell_collar: async (p) => bellCollar(p),
  star_medal: async (p) => starMedal(p),
  tutu: async (p, ctx) => tutu(p, ctx.winged),
  sweater: async (p, ctx) => sweater(p, ctx.winged),
  backpack: async (p, ctx) => backpack(p, ctx.winged),
  cape: async (p) => cape(p),
  wings: async (p) => wingPair(p, '#7ec8ff'),
  golden_wings: async (p) => wingPair(p, '#ffc83d', 0.45),
  jetpack: async (p) => jetpack(p),
  hearts: async (p) => hearts(p),
  sparkles: async (p) => sparkles(p),
  snowfall: async (p) => snowfall(p),
  rainbow_aura: async (p) => rainbow(p),
};

export function makeAnchors(body) {
  const root = new Group();
  root.name = 'accessory_root';
  root.position.set(0, -BODY_Y, 0);
  const hat = new Group();
  hat.name = 'hat_anchor';
  const face = new Group();
  face.name = 'face_anchor';
  const neck = new Group();
  neck.name = 'neck_anchor';
  const bodySlot = new Group();
  bodySlot.name = 'body_anchor';
  const back = new Group();
  back.name = 'back_anchor';
  const effect = new Group();
  effect.name = 'effect_anchor';
  root.add(hat, face, neck, bodySlot, back, effect);
  if (body) body.add(root);
  return { root, hat, face, neck, body: bodySlot, back, effect };
}

function emptyGroup(group) {
  while (group.children.length) group.remove(group.children[0]);
}

export async function buildOutfit(anchors, outfit, animal) {
  if (!anchors) return;
  const fit = PET_FIT[animal] || PET_FIT.dog;
  const hatScale = fit.hatScale || 1;
  const tilt = fit.hatTilt || 0;
  const brimY = TOP + (fit.hat || 0);
  const brimZ = fit.hatZ || 0;
  // Scale and tilt around the brim, so a forward tip still meets the head.
  anchors.hat.rotation.set(tilt, 0, 0);
  anchors.hat.scale.setScalar(hatScale);
  anchors.hat.position.set(
    0,
    brimY - hatScale * TOP * Math.cos(tilt),
    brimZ - hatScale * TOP * Math.sin(tilt),
  );
  anchors.face.position.set(0, (fit.face || 0.78) - 0.78, fit.faceZ || 0);
  anchors.neck.position.set(0, (fit.neck || 0.4) - 0.4, 0);
  anchors.back.position.set(0, 0, fit.backZ || 0);
  for (const group of [anchors.hat, anchors.face, anchors.neck, anchors.body, anchors.back, anchors.effect]) {
    emptyGroup(group);
  }
  const ctx = { winged: Boolean(fit.winged), animal, fit };
  const jobs = [];
  for (const slot of ['hat', 'face', 'neck', 'body', 'back', 'effect']) {
    const id = outfit?.[slot];
    const build = BUILDERS[id];
    if (!build) continue;
    jobs.push(build(anchors[slot], ctx).catch((err) => {
      console.error(err);
      box(anchors[slot], [0, 0, TOP + 0.2], [0.3, 0.3, 0.3], '#ffd23f');
    }));
  }
  await Promise.all(jobs);
}

export function tickAccessories(root, time) {
  if (!root) return;
  root.traverse((obj) => {
    const fx = obj.userData?.fx;
    if (fx === 'bob') {
      obj.position.y = obj.userData.baseY + Math.sin(time * obj.userData.speed + obj.userData.phase) * obj.userData.amp;
    } else if (fx === 'snow') {
      const t = (time * obj.userData.speed + obj.userData.phase) % 1;
      obj.position.y = obj.userData.top - t * obj.userData.span;
      obj.rotation.y = time;
    } else if (fx === 'spin') {
      obj.rotation.y = time * (obj.userData.speed || 0.5);
    } else if (fx === 'flame') {
      const s = 0.82 + Math.abs(Math.sin(time * 10 + obj.userData.phase)) * 0.28;
      obj.scale.set(s, s, s);
    }
  });
}

export function frameFor(animal, outfit) {
  const fit = PET_FIT[animal] || PET_FIT.dog;
  let top = fit.top;
  for (const id of Object.values(outfit || {})) {
    const item = itemById(id);
    if (!item?.rise) continue;
    top = Math.max(top, TOP + item.rise + (fit.hat || 0));
  }
  return { bottom: -0.04, top: top + 0.14, wide: fit.wide || 0.9 };
}

export function preloadAccessories() {
  if (!loader) return Promise.resolve();
  return Promise.all(Object.values(GLB).map((url) => loadScene(url).catch(() => null)));
}
