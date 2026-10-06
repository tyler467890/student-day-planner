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
import { clearGlbItems, fitFor as v2FitFor, loadFits as loadV2Fits, placeItemGlb } from './glb-items.js';

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
 * Ring wrapped around Y. `flat` near 1 keeps a rounded knit.
 * Higher values flatten the band into a ribbon.
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
  band(parent, [0, 0, TOP + 0.04], 0.64, 0.042, '#ffffff', { flat: 1.45 });
  ball(parent, [0, 0, TOP + 0.44], 0.11, '#ffffff');
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
  band(parent, [0, 0, TOP + 0.04], 0.64, 0.03, '#ff6b35', { flat: 1.8 });
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
  band(parent, [0, 0, TOP + 0.16], 0.6, 0.042, gold, { flat: 2.4, ...metal });
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

const GLASS_LENS_Z = 0.0918;
const GLASS_LENS_Y = 0.052;
const GLASS_WIDTH = 0.33;

async function glasses(parent, sun, fit = {}) {
  const sep = fit.eyeSep || 0.36;
  const eyeH = fit.eyeH || 0.2;
  const eyeY = fit.eyeY ?? 0.89;
  const eyeZ = fit.eyeZ ?? 0.635;
  const targetW = Math.min(1.05, Math.max(0.52, sep + 0.18));
  const targetH = Math.min(0.32, Math.max(0.15, eyeH));
  const scale = Math.min(2.8, Math.max(targetW / GLASS_WIDTH, targetH / 0.096));
  const depth = GLASS_LENS_Z * scale - (eyeZ + 0.02);
  const up = eyeY - GLASS_LENS_Y * scale;
  await placeGlb(parent, sun ? GLB.sunglasses : GLB.glasses, [0, depth, up], scale);
}

function bowTie(parent) {
  const z = 0.46;
  const y = FRONT + 0.02;
  puff(parent, [-0.16, y, z], 0.16, [1.25, 0.72, 0.42], '#ff4f79', { tilt: 0.4 });
  puff(parent, [0.16, y, z], 0.16, [1.25, 0.72, 0.42], '#ff4f79', { tilt: -0.4 });
  puff(parent, [0, y - 0.01, z], 0.055, [0.75, 0.9, 0.55], '#e03a63');
}

function scarf(parent) {
  // Knit wrap: a rounded band on the neck, plus two hanging ends with fringe.
  band(parent, [0, 0, 0.48], 0.66, 0.055, '#e23b4a', { flat: 1.12 });
  band(parent, [0, 0, 0.44], 0.68, 0.018, '#ffffff', { flat: 1.05 });
  box(parent, [0.1, -0.64, 0.16], [0.2, 0.08, 0.52], '#e23b4a');
  box(parent, [-0.08, -0.62, 0.12], [0.18, 0.075, 0.44], '#e23b4a');
  box(parent, [0.1, -0.64, -0.09], [0.2, 0.084, 0.055], '#ffffff');
  box(parent, [-0.08, -0.62, -0.09], [0.18, 0.08, 0.05], '#ffffff');
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

function cloth(parent, y, radiusTop, radiusBottom, height, color, winged) {
  const arc = 1.35;
  if (winged) {
    shell(parent, [0, 0, y], radiusTop, radiusBottom, height, color, {
      thetaStart: -arc / 2, thetaLength: arc, sides: 22,
    });
    shell(parent, [0, 0, y], radiusTop, radiusBottom, height, color, {
      thetaStart: Math.PI - arc / 2, thetaLength: arc, sides: 22,
    });
  } else {
    shell(parent, [0, 0, y], radiusTop, radiusBottom, height, color, { sides: 36 });
  }
}

function tutu(parent, winged) {
  const layers = [
    { y: 0.4, rt: 0.56, rb: 0.78, h: 0.16, c: '#ff7eb6' },
    { y: 0.36, rt: 0.58, rb: 0.92, h: 0.13, c: '#ff9ec8' },
    { y: 0.32, rt: 0.6, rb: 1.02, h: 0.1, c: '#ffd0e4' },
  ];
  for (const layer of layers) cloth(parent, layer.y, layer.rt, layer.rb, layer.h, layer.c, winged);
  band(parent, [0, 0, 0.47], 0.58, 0.028, '#e85a9a', { flat: 1.4 });
}

function heroMask(parent, fit = {}) {
  const eyeY = fit.eyeY ?? 0.89;
  const eyeZ = fit.eyeZ ?? 0.635;
  const sep = fit.eyeSep || 0.36;
  const radius = 1.15;
  const frontZ = eyeZ + 0.03;
  shell(parent, [0, -(frontZ - radius), eyeY], radius, radius, 0.2, '#2d2f48', {
    thetaStart: -0.52,
    thetaLength: 1.04,
    sides: 28,
  });
  puff(parent, [-sep / 2, -frontZ, eyeY], 0.07, [1.15, 0.72, 0.28], '#ffe08a');
  puff(parent, [sep / 2, -frontZ, eyeY], 0.07, [1.15, 0.72, 0.28], '#ffe08a');
}

async function sweater(parent, winged) {
  const wool = '#6d4aff';
  const rib = '#3a249e';
  const stripe = '#ffffff';
  // Wool shell over the cube. Stripes and the hem sit just outside it so they read.
  cloth(parent, 0.56, 0.7, 0.76, 0.6, wool, winged);
  cloth(parent, 0.42, 0.8, 0.83, 0.06, stripe, winged);
  cloth(parent, 0.56, 0.785, 0.81, 0.055, stripe, winged);
  cloth(parent, 0.7, 0.76, 0.785, 0.05, stripe, winged);
  cloth(parent, 0.3, 0.8, 0.84, 0.1, rib, winged);
  cloth(parent, 0.3, 0.84, 0.87, 0.032, wool, winged);
  band(parent, [0, 0, 0.88], 0.68, 0.036, rib, { flat: 1.25 });
  if (!winged) {
    [-1, 1].forEach((sign) => {
      const lean = sign * -0.5;
      const sleeve = tube(parent, [sign * 0.7, 0.02, 0.62], 0.14, 0.38, wool, { sides: 18 });
      sleeve.rotation.z = lean;
      const stripeBand = tube(parent, [sign * 0.74, 0.02, 0.66], 0.145, 0.05, stripe, { sides: 16 });
      stripeBand.rotation.z = lean;
      const cuff = tube(parent, [sign * 0.86, 0.03, 0.4], 0.12, 0.09, rib, { sides: 16 });
      cuff.rotation.z = lean;
    });
  }
  await placeGlb(parent, GLB.heart, [0.02, -0.88, 0.58], 0.48);
}

function cape(parent) {
  const arc = Math.PI * 0.95;
  shell(parent, [0, 0.06, 0.52], 0.64, 0.8, 0.98, '#c23b4a', {
    thetaStart: Math.PI - arc / 2, thetaLength: arc, sides: 28,
  });
  shell(parent, [0, 0.03, 0.52], 0.6, 0.75, 0.94, '#9e2e3c', {
    thetaStart: Math.PI - arc / 2, thetaLength: arc, sides: 28,
  });
  band(parent, [0, 0.02, 0.98], 0.6, 0.038, '#ffd23f', { flat: 1.4, arc: Math.PI * 0.85, aim: 'back' });
  ball(parent, [0, 0.12, 1.0], 0.04, '#ffe58a', { metal: 0.45 });
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

async function heartCheeks(parent, fit = {}) {
  const eyeY = (fit.eyeY ?? 0.89) - 0.16;
  const eyeZ = (fit.eyeZ ?? 0.635) + 0.015;
  const x = Math.max(0.22, (fit.eyeSep || 0.36) * 0.72);
  await placeGlb(parent, GLB.heart, [-x, -eyeZ, eyeY], 0.28);
  await placeGlb(parent, GLB.heart, [x, -eyeZ, eyeY], 0.28);
}

function bellCollar(parent) {
  band(parent, [0, 0, 0.42], 0.6, 0.03, '#ffd23f', { flat: 1.2, metal: 0.45, rough: 0.35 });
  ball(parent, [0, FRONT + 0.02, 0.3], 0.09, '#ffe58a', { metal: 0.35 });
}

async function starMedal(parent) {
  box(parent, [0, FRONT + 0.02, 0.58], [0.13, 0.03, 0.42], '#e23b4a');
  box(parent, [-0.1, FRONT + 0.04, 0.82], [0.11, 0.028, 0.18], '#e23b4a', { rot: [0, 0, 28] });
  box(parent, [0.1, FRONT + 0.04, 0.82], [0.11, 0.028, 0.18], '#e23b4a', { rot: [0, 0, -28] });
  await placeGlb(parent, GLB.star, [0, FRONT - 0.02, 0.36], 0.55);
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

/** Back items cover the rump. Shorten that pet's tail so it stays under them. */
const BACK_COVERS = new Set(['backpack', 'cape', 'wings', 'golden_wings', 'jetpack']);
const TAIL_TUCK = {
  fox: { scale: 0.18, pull: 0.2 },
  lion: { scale: 0.25, pull: 0.14 },
  cat: { scale: 0.3, pull: 0.12 },
  tiger: { scale: 0.3, pull: 0.12 },
  monkey: { scale: 0.3, pull: 0.12 },
};

/**
 * The clips animate the tail's scale, so this runs after the mixer.
 * Pets whose tail is part of the body mesh (dog) have no tail node.
 */
export function tuckTail(pet, outfit) {
  const tail = pet?.nodes?.tail;
  const base = tail?.userData?.bind?.s;
  if (!tail || !base) return;
  const tuck = BACK_COVERS.has(outfit?.back) ? (TAIL_TUCK[pet.animal] || { scale: 0.3, pull: 0.12 }) : null;
  if (!tuck) return;
  tail.scale.set(base.x * tuck.scale, base.y * tuck.scale, base.z * tuck.scale);
  tail.position.z += tuck.pull;
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
  round_glasses: async (p, ctx) => glasses(p, false, ctx.fit),
  sunglasses: async (p, ctx) => glasses(p, true, ctx.fit),
  heart_cheeks: async (p, ctx) => heartCheeks(p, ctx.fit),
  hero_mask: async (p, ctx) => heroMask(p, ctx.fit),
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
  const [map, fits, v2fits] = await Promise.all([
    loadOverrides(),
    loadFits(),
    loadV2Fits().catch(() => null),
  ]);
  const fit = mergeFit(animal, fits);
  seat(anchors.hat, anchorFromFit(fit, 'hat'));
  seat(anchors.face, anchorFromFit(fit, 'face'));
  seat(anchors.neck, anchorFromFit(fit, 'neck'));
  seat(anchors.body, anchorFromFit(fit, 'body'));
  seat(anchors.back, anchorFromFit(fit, 'back'));
  seat(anchors.effect, anchorFromFit(fit, 'effect'));
  clearGlbItems(anchors);
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
    // The designer's sweater is being redone. Keep the striped sweater builder.
    const v2 = id !== 'sweater' ? v2FitFor(v2fits, id, animal) : null;
    jobs.push((async () => {
      if (custom) {
        try {
          await placeCustom(anchors[slot], custom);
          return;
        } catch (err) {
          console.error(err);
        }
      }
      if (v2) {
        await placeItemGlb(anchors, id, animal, loadScene);
        return;
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
  let wide = fit.wide || 0.9;
  const worn = new Set(Object.values(outfit || {}));
  for (const id of worn) {
    const item = itemById(id);
    if (!item?.rise) continue;
    top = Math.max(top, TOP + item.rise + (fit.hat || 0));
  }
  // Rainbow reaches about x ±1.17 and y 1.60. Wings reach about x ±0.92.
  if (worn.has('rainbow_aura')) {
    wide = Math.max(wide, 1.36);
    top = Math.max(top, 1.74);
  }
  if (worn.has('wings') || worn.has('golden_wings')) {
    wide = Math.max(wide, 1.14);
  }
  return { bottom: -0.04, top: top + 0.14, wide };
}

export function preloadAccessories() {
  loadV2Fits().catch(() => null);
  if (!loader) return Promise.resolve();
  return Promise.all(Object.values(GLB).map((url) => loadScene(url).catch(() => null)));
}
