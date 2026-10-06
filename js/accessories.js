/**
 * Cube-style accessories for Kenney Cube Pets.
 * Item positions follow the Blender fit (head top at y = 1.431).
 * Groups hang off the body so they move with the clips.
 */

import {
  Group, Mesh, BoxGeometry, ConeGeometry, CylinderGeometry, SphereGeometry,
  TorusGeometry, MeshPhysicalMaterial, DoubleSide, BufferGeometry, BufferAttribute,
  Box3, Vector3,
} from 'three';
import { itemById } from './shop.js';
import { HEAD_TOP, PET_FIT, anchorFromFit, mergeFit } from './pet-fit.js';

const BODY_Y = 0.18125;
const TOP = HEAD_TOP;
const FRONT = -0.625;

export { PET_FIT };

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

let overrideMap = null;
let fitMap = null;

function customSpec(raw) {
  const src = typeof raw === 'string' ? raw : raw?.src;
  if (typeof src !== 'string' || !/^items\/glbs\/[a-z0-9_./-]+\.glb$/.test(src)) return null;
  const scale = Number(typeof raw === 'object' ? raw.scale : 1);
  const rotY = Number(typeof raw === 'object' ? raw.rotY : 0);
  const at = typeof raw === 'object' && Array.isArray(raw.at) ? raw.at : [0, 0, 0];
  return {
    src,
    scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
    rotY: Number.isFinite(rotY) ? rotY : 0,
    at,
  };
}

/** items/overrides.json maps an item id to a GLB that replaces the placeholder. */
async function loadOverrides() {
  if (overrideMap) return overrideMap;
  try {
    const res = await fetch(new URL('../items/overrides.json', import.meta.url));
    const data = res.ok ? await res.json() : {};
    overrideMap = data && typeof data === 'object' ? data : {};
  } catch {
    overrideMap = {};
  }
  return overrideMap;
}

/** items/fits.json nudges the built-in per-pet seats without a code change. */
async function loadFits() {
  if (fitMap) return fitMap;
  try {
    const res = await fetch(new URL('../items/fits.json', import.meta.url));
    const data = res.ok ? await res.json() : {};
    fitMap = data && typeof data === 'object' ? data : {};
  } catch {
    fitMap = {};
  }
  return fitMap;
}

async function placeCustom(parent, spec) {
  const url = new URL(`../${spec.src}`, import.meta.url).href;
  await placeGlb(parent, url, spec.at, spec.scale, spec.rotY);
}

function vinyl(hex, opts = {}) {
  const side = opts.side ?? 0;
  const key = `${hex}|${opts.metal || 0}|${opts.emit || 0}|${opts.rough ?? 0.5}|${side}`;
  let mat = mats.get(key);
  if (mat) return mat;
  mat = new MeshPhysicalMaterial({
    color: hex,
    roughness: opts.rough ?? 0.5,
    metalness: opts.metal || 0,
    clearcoat: 0.2,
    emissive: opts.emit ? hex : 0x000000,
    emissiveIntensity: opts.emit || 0,
    side,
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
  const sides = opts.sides || 24;
  const mesh = new Mesh(new ConeGeometry(radius, height, sides), vinyl(color, opts));
  mesh.position.set(loc[0], loc[2], -loc[1]);
  if (opts.tilt) mesh.rotation.x += opts.tilt;
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function placeMesh(mesh, loc) {
  mesh.position.set(loc[0], loc[2], -loc[1]);
  mesh.castShadow = true;
}

function addMesh(parent, geometry, loc, color, opts = {}) {
  const mesh = new Mesh(geometry, vinyl(color, opts));
  placeMesh(mesh, loc);
  if (opts.rot) {
    const [rx, ry, rz] = opts.rot;
    mesh.rotation.set((rx || 0) * Math.PI / 180, (rz || 0) * Math.PI / 180, -(ry || 0) * Math.PI / 180);
  }
  parent.add(mesh);
  return mesh;
}

/** Thin disc. theta 0 points toward the camera. */
function disc(parent, loc, radius, thick, color, opts = {}) {
  return addMesh(
    parent,
    new CylinderGeometry(
      radius,
      opts.radiusBottom ?? radius,
      thick,
      opts.sides || 32,
      1,
      false,
      opts.thetaStart || 0,
      opts.thetaLength ?? Math.PI * 2,
    ),
    loc,
    color,
    opts,
  );
}

/** Open curved shell. Fabric stays one thin surface, visible from both sides. */
function shell(parent, loc, radiusTop, radiusBottom, height, color, opts = {}) {
  return addMesh(
    parent,
    new CylinderGeometry(
      radiusTop,
      radiusBottom,
      height,
      opts.sides || 32,
      1,
      true,
      opts.thetaStart || 0,
      opts.thetaLength ?? Math.PI * 2,
    ),
    loc,
    color,
    { ...opts, side: DoubleSide },
  );
}

/**
 * Ribbon wrapped around Y. `flat` stretches the tube vertically so the
 * band reads as cloth (tall and paper-thin) rather than a rope.
 */
function band(parent, loc, radius, tube, color, opts = {}) {
  const geo = new TorusGeometry(
    radius,
    tube,
    opts.tubeSeg || 10,
    opts.arcSeg || 40,
    opts.arc ?? Math.PI * 2,
  );
  const mesh = new Mesh(geo, vinyl(color, { ...opts, side: DoubleSide }));
  mesh.rotation.x = Math.PI / 2;
  if (opts.arc && opts.aim === 'back') mesh.rotation.y = -Math.PI / 2 - opts.arc / 2;
  else if (opts.arc && opts.aim === 'front') mesh.rotation.y = Math.PI / 2 - opts.arc / 2;
  if (opts.flat) mesh.scale.y = opts.flat;
  placeMesh(mesh, loc);
  parent.add(mesh);
  return mesh;
}

function dome(parent, loc, radius, color, opts = {}) {
  const mesh = addMesh(
    parent,
    new SphereGeometry(radius, opts.sides || 28, 18, 0, Math.PI * 2, 0, opts.phi || Math.PI * 0.5),
    loc,
    color,
    opts,
  );
  mesh.scale.set(opts.wide || 1, opts.squash || 1, opts.deep || 1);
  return mesh;
}

function puff(parent, loc, radius, scale, color, opts = {}) {
  const mesh = addMesh(
    parent,
    new SphereGeometry(radius, opts.seg || 18, opts.segH || 14),
    loc,
    color,
    opts,
  );
  mesh.scale.set(scale[0], scale[1], scale[2]);
  if (opts.tilt) mesh.rotation.z = opts.tilt;
  return mesh;
}

function tube(parent, loc, radius, height, color, opts = {}) {
  return addMesh(
    parent,
    new CylinderGeometry(opts.radiusTop ?? radius, radius, height, opts.sides || 16),
    loc,
    color,
    opts,
  );
}

function ball(parent, loc, radius, color, opts = {}) {
  const mesh = new Mesh(new SphereGeometry(radius, 20, 16), vinyl(color, opts));
  mesh.position.set(loc[0], loc[2], -loc[1]);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
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
  pyramid(parent, [0.06, 0, TOP + 0.46], 0.32, 0.78, '#ff6fa8', { sides: 28 });
  disc(parent, [0.06, 0, TOP + 0.05], 0.4, 0.028, '#ffd23f');
  ball(parent, [0.06, 0, TOP + 0.86], 0.07, '#fff3a0');
}

function beanie(parent) {
  dome(parent, [0, 0, TOP - 0.02], 0.64, '#4fb3ff', { squash: 0.62, phi: Math.PI * 0.52 });
  band(parent, [0, 0, TOP + 0.02], 0.64, 0.028, '#ffffff', { flat: 1.8 });
  ball(parent, [0, 0, TOP + 0.42], 0.1, '#ffffff');
}

function cap(parent) {
  dome(parent, [0, 0.04, TOP], 0.58, '#ff5a5f', { squash: 0.5, wide: 1.05, deep: 0.92 });
  disc(parent, [0, -0.22, TOP + 0.02], 0.48, 0.026, '#ff5a5f', {
    thetaStart: -Math.PI / 2,
    thetaLength: Math.PI,
    sides: 24,
  });
  ball(parent, [0, 0.02, TOP + 0.32], 0.04, '#ffffff');
}

function flowerCrown(parent) {
  band(parent, [0, 0, TOP + 0.04], 0.64, 0.016, '#6bcb77', { flat: 1.8 });
  const cols = ['#ff7eb6', '#ffd23f', '#b388ff', '#ff9f43'];
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    const x = Math.sin(a) * 0.64;
    const depth = -Math.cos(a) * 0.64;
    puff(parent, [x, depth, TOP + 0.1], 0.09, [1, 0.65, 1], cols[i % 4]);
    ball(parent, [x, depth, TOP + 0.15], 0.028, '#fff6d8');
  }
}

function gradCap(parent) {
  tube(parent, [0, 0, TOP + 0.1], 0.42, 0.2, '#2d2f48', { sides: 28 });
  box(parent, [0, 0, TOP + 0.22], [1.28, 1.28, 0.03], '#2d2f48');
  tube(parent, [0.48, -0.12, TOP + 0.08], 0.012, 0.28, '#ffd23f', { sides: 8 });
  ball(parent, [0.48, -0.12, TOP - 0.05], 0.045, '#ffd23f');
}

async function wizardHat(parent) {
  disc(parent, [0, 0, TOP + 0.03], 0.66, 0.028, '#7b5cff');
  pyramid(parent, [0, 0.02, TOP + 0.58], 0.42, 1.02, '#7b5cff', { sides: 28 });
  await placeGlb(parent, GLB.star, [0, -0.28, TOP + 0.38], 0.55, -12);
}

function flameBand(parent) {
  band(parent, [0, 0, TOP + 0.02], 0.64, 0.018, '#ff6b35', { flat: 2.4 });
  [[-0.24, 0.32], [0, 0.46], [0.24, 0.32]].forEach(([x, h], i) => {
    const flame = pyramid(parent, [x, -0.5, TOP + 0.08 + h / 2], 0.08, h, '#ffb627', { emit: 0.35, sides: 18 });
    flame.userData.fx = 'flame';
    flame.userData.phase = i;
  });
}

function sprout(parent) {
  tube(parent, [0, 0, TOP + 0.2], 0.045, 0.34, '#4caf50', { sides: 12 });
  const left = puff(parent, [-0.14, 0, TOP + 0.34], 0.16, [1.35, 0.32, 0.55], '#6bcb77');
  left.rotation.z = 0.55;
  const right = puff(parent, [0.15, 0, TOP + 0.4], 0.15, [1.3, 0.3, 0.5], '#8be08f');
  right.rotation.z = -0.65;
}

async function crown(parent) {
  const gold = '#ffc83d';
  const metal = { metal: 0.55, rough: 0.35 };
  band(parent, [0, 0, TOP + 0.16], 0.6, 0.026, gold, { flat: 3.6, ...metal });
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2;
    pyramid(
      parent,
      [Math.sin(a) * 0.6, -Math.cos(a) * 0.6, TOP + 0.38],
      0.08,
      0.2,
      gold,
      { sides: 12, ...metal },
    );
  }
  await placeGlb(parent, GLB.jewel, [0, -0.62, TOP + 0.16], 0.55);
}

async function glasses(parent, sun) {
  await placeGlb(parent, sun ? GLB.sunglasses : GLB.glasses, [0, -0.48, 0.78], 3.4);
}

function bowTie(parent) {
  const z = 0.44;
  const y = FRONT - 0.01;
  puff(parent, [-0.15, y, z], 0.15, [1.25, 0.7, 0.2], '#ff4f79', { tilt: 0.42 });
  puff(parent, [0.15, y, z], 0.15, [1.25, 0.7, 0.2], '#ff4f79', { tilt: -0.42 });
  puff(parent, [0, y, z], 0.048, [0.7, 0.85, 0.4], '#e03a63');
}

function scarf(parent) {
  band(parent, [0, 0, 0.5], 0.6, 0.016, '#ff6b6b', { flat: 3.4 });
  band(parent, [0, 0, 0.44], 0.608, 0.01, '#ffffff', { flat: 1.2 });
  box(parent, [0.1, -0.62, 0.24], [0.15, 0.016, 0.38], '#ff6b6b');
  box(parent, [-0.04, -0.6, 0.22], [0.15, 0.016, 0.32], '#ff6b6b');
  box(parent, [0.1, -0.62, 0.06], [0.15, 0.018, 0.028], '#ffffff');
  box(parent, [-0.04, -0.6, 0.07], [0.15, 0.018, 0.024], '#ffffff');
}

function backpack(parent, winged) {
  puff(parent, [0, 0.78, 0.78], 0.36, [1.05, 1.2, 0.78], '#ffb627');
  puff(parent, [0, 0.86, 1.02], 0.2, [1.35, 0.62, 0.48], '#ff8c42');
  if (!winged) {
    tube(parent, [-0.34, 0.18, 0.82], 0.032, 0.5, '#ff8c42', { sides: 10 });
    tube(parent, [0.34, 0.18, 0.82], 0.032, 0.5, '#ff8c42', { sides: 10 });
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
  const y = 0.3;
  const layers = [
    { rt: 0.5, rb: 0.86, h: 0.05, c: '#ff7eb6', dy: 0 },
    { rt: 0.52, rb: 0.96, h: 0.036, c: '#ffd0e4', dy: -0.018 },
  ];
  for (const layer of layers) {
    if (winged) {
      const arc = 1.15;
      shell(parent, [0, 0, y + layer.dy], layer.rt, layer.rb, layer.h, layer.c, {
        thetaStart: -arc / 2, thetaLength: arc, sides: 20,
      });
      shell(parent, [0, 0, y + layer.dy], layer.rt, layer.rb, layer.h, layer.c, {
        thetaStart: Math.PI - arc / 2, thetaLength: arc, sides: 20,
      });
    } else {
      shell(parent, [0, 0, y + layer.dy], layer.rt, layer.rb, layer.h, layer.c, { sides: 36 });
    }
  }
}

function heroMask(parent) {
  const arc = 1.35;
  shell(parent, [0, 0.04, 0.78], 0.66, 0.66, 0.18, '#2d2f48', {
    thetaStart: -arc / 2,
    thetaLength: arc,
    sides: 24,
  });
  puff(parent, [-0.22, FRONT, 0.78], 0.1, [1.15, 0.62, 0.28], '#ffe08a');
  puff(parent, [0.22, FRONT, 0.78], 0.1, [1.15, 0.62, 0.28], '#ffe08a');
}

function sweater(parent, winged) {
  const color = '#6d4aff';
  const stripe = '#ffffff';
  const y = 0.58;
  const arc = 1.3;
  const panels = winged
    ? [{ thetaStart: -arc / 2, thetaLength: arc }, { thetaStart: Math.PI - arc / 2, thetaLength: arc }]
    : [{ thetaStart: 0, thetaLength: Math.PI * 2 }];
  for (const panel of panels) {
    shell(parent, [0, 0, y], 0.66, 0.7, 0.46, color, { ...panel, sides: winged ? 20 : 32 });
    shell(parent, [0, 0, y + 0.15], 0.68, 0.72, 0.05, stripe, { ...panel, sides: winged ? 20 : 32 });
  }
}

function cape(parent) {
  const arc = Math.PI * 0.9;
  shell(parent, [0, 0.1, 0.58], 0.56, 0.82, 0.9, '#c23b4a', {
    thetaStart: Math.PI - arc / 2,
    thetaLength: arc,
    sides: 28,
  });
  band(parent, [0, 0.04, 1.0], 0.58, 0.014, '#ffd23f', { flat: 2.2, arc: Math.PI * 0.8, aim: 'back' });
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
  [-1, 1].forEach((sign) => {
    const upper = puff(parent, [sign * 0.78, 0.26, 0.84], 0.4, [1.2, 0.58, 0.14], color, { metal });
    upper.rotation.z = sign * -0.45;
    upper.rotation.y = sign * 0.3;
    const lower = puff(parent, [sign * 0.58, 0.16, 0.64], 0.26, [1.1, 0.48, 0.14], color, { metal });
    lower.rotation.z = sign * -0.18;
    lower.rotation.y = sign * 0.18;
  });
}

function jetpack(parent) {
  puff(parent, [0, 0.68, 0.9], 0.3, [1.15, 0.68, 0.72], '#d9dde8', { metal: 0.35 });
  [-0.2, 0.2].forEach((x, i) => {
    tube(parent, [x, 0.76, 0.72], 0.1, 0.58, '#8d93a8', { metal: 0.4, sides: 18 });
    const flame = pyramid(parent, [x, 0.76, 0.3], 0.08, 0.24, '#ff7a45', { emit: 0.45, sides: 16 });
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
  band(parent, [0, 0, 0.42], 0.62, 0.02, '#ffd23f', { flat: 1.5, metal: 0.45, rough: 0.35 });
  ball(parent, [0, FRONT - 0.02, 0.32], 0.08, '#ffe58a', { metal: 0.35 });
}

async function starMedal(parent) {
  box(parent, [0, FRONT - 0.02, 0.72], [0.11, 0.016, 0.4], '#e23b4a');
  box(parent, [-0.09, FRONT, 0.94], [0.09, 0.014, 0.18], '#e23b4a', { rot: [0, 0, 32] });
  box(parent, [0.09, FRONT, 0.94], [0.09, 0.014, 0.18], '#e23b4a', { rot: [0, 0, -32] });
  await placeGlb(parent, GLB.star, [0, FRONT - 0.06, 0.42], 0.55);
}

function rainbow(parent) {
  const cols = ['#ff5a7a', '#ffb627', '#ffe14a', '#3dce7a', '#4aa3ff', '#7b5cff'];
  cols.forEach((color, i) => {
    const ringMesh = new Mesh(
      new CylinderGeometry(0.95 + i * 0.012, 0.95, 0.032, 40, 1, true),
      vinyl(color, { emit: 0.25, rough: 0.4, side: DoubleSide }),
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

function seat(group, pose) {
  group.rotation.set(pose.tilt || 0, 0, 0);
  group.scale.setScalar(pose.scale || 1);
  group.position.set(pose.x || 0, pose.y || 0, pose.z || 0);
}

export async function buildOutfit(anchors, outfit, animal) {
  if (!anchors) return;
  const [map, fits] = await Promise.all([loadOverrides(), loadFits()]);
  const fit = mergeFit(animal, fits);
  seat(anchors.hat, anchorFromFit(fit, 'hat'));
  seat(anchors.face, anchorFromFit(fit, 'face'));
  seat(anchors.neck, anchorFromFit(fit, 'neck'));
  seat(anchors.body, anchorFromFit(fit, 'body'));
  seat(anchors.back, anchorFromFit(fit, 'back'));
  seat(anchors.effect, anchorFromFit(fit, 'effect'));
  for (const group of [anchors.hat, anchors.face, anchors.neck, anchors.body, anchors.back, anchors.effect]) {
    emptyGroup(group);
  }
  const ctx = { winged: Boolean(fit.winged), animal, fit };
  const jobs = [];
  for (const slot of ['hat', 'face', 'neck', 'body', 'back', 'effect']) {
    const id = outfit?.[slot];
    if (!id) continue;
    const custom = customSpec(map[id]);
    const build = BUILDERS[id];
    jobs.push((async () => {
      if (custom) {
        try {
          await placeCustom(anchors[slot], custom);
          return;
        } catch (err) {
          console.error(err);
        }
      }
      if (!build) return;
      await build(anchors[slot], ctx);
    })().catch((err) => {
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
  const fit = mergeFit(animal, fitMap || {});
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
