import {
  Scene, PerspectiveCamera, WebGLRenderer, Group, Mesh,
  SphereGeometry, ConeGeometry, CylinderGeometry, PlaneGeometry,
  MeshPhysicalMaterial, ShadowMaterial, Sprite, SpriteMaterial, CanvasTexture,
  HemisphereLight, DirectionalLight,
  SRGBColorSpace, NoToneMapping, PCFSoftShadowMap,
  Vector3,
} from 'three';
import { GLTFLoader } from '../vendor/examples/jsm/loaders/GLTFLoader.js';
import { prepareCube, poseClip, tintMaterials, limitLightness, NATURAL } from '../../js/cube-pet.js';

const ANIMALS = [
  ['dog', 'Dog'],
  ['cat', 'Cat'],
  ['bunny', 'Bunny'],
  ['penguin', 'Penguin'],
  ['monkey', 'Monkey'],
  ['tiger', 'Tiger'],
  ['pig', 'Pig'],
  ['lion', 'Lion'],
  ['panda', 'Panda'],
  ['fox', 'Fox'],
  ['koala', 'Koala'],
  ['chick', 'Chick'],
];

const SWATCHES = [
  { name: 'Natural', hex: null },
  { name: 'Sunny yellow', hex: '#FFD23F' },
  { name: 'Peach', hex: '#FFB086' },
  { name: 'Coral pink', hex: '#FF8AD4' },
  { name: 'Lavender', hex: '#C4B5FD' },
  { name: 'Sky blue', hex: '#7EC8FF' },
  { name: 'Mint', hex: '#7DDFC3' },
  { name: 'Cocoa', hex: '#A8704A' },
];

const DURATION = { wave: 1.55, jump: 1.2, spin: 1.35, sleepy: 2.8, walk: 2.6 };
const ZOOM_MIN = 2.8;
const ZOOM_MAX = 8.4;

const canvas = document.querySelector('#stage');
const statusEl = document.querySelector('#pet-status');
const scene = new Scene();
const camera = new PerspectiveCamera(32, 1, 0.1, 40);
const BASE_FOV = 32;
let camZ = 5.4;
let camY = 1.2;
let lookX = 0.12;
let lookY = 0.95;
camera.position.set(lookX, camY, camZ);

const renderer = new WebGLRenderer({
  canvas,
  alpha: true,
  antialias: true,
  powerPreference: 'low-power',
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = NoToneMapping;
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;

scene.add(new HemisphereLight(0xfff9ff, 0xe6def4, 1.05));

const key = new DirectionalLight(0xfff6ef, 2.35);
key.position.set(-2.8, 5.4, 3.2);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.near = 0.4;
key.shadow.camera.far = 16;
key.shadow.camera.left = -2.2;
key.shadow.camera.right = 2.2;
key.shadow.camera.top = 2.2;
key.shadow.camera.bottom = -2.2;
key.shadow.bias = -0.0006;
key.shadow.normalBias = 0.025;
scene.add(key);
scene.add(key.target);
key.target.position.set(0, 0.7, 0);

const fill = new DirectionalLight(0xf4f1ff, 1.05);
fill.position.set(3.4, 2.6, 2.4);
scene.add(fill);

const ground = new Mesh(
  new PlaneGeometry(12, 12),
  new ShadowMaterial({ opacity: 0.28 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0.001;
ground.receiveShadow = true;
scene.add(ground);

const turntable = new Group();
scene.add(turntable);
const holder = new Group();
turntable.add(holder);

const state = {
  animal: 'penguin',
  shown: null,
  loading: true,
  swatch: null,
  height: 1,
  body: 1,
  eyes: 'round',
  cheeks: true,
  hat: false,
  mode: 'idle',
  modeT: 0,
  time: 0,
  timeScale: 1,
  paused: false,
  poseToken: 0,
};

let userYaw = -0.42;
let grid = null;
let current = null;
const cache = new Map();
const inflight = new Map();
const v3a = new Vector3();
const v3b = new Vector3();

function vinyl(color, roughness = 0.4) {
  return new MeshPhysicalMaterial({
    color,
    roughness,
    metalness: 0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.25,
  });
}

const hat = new Group();
const hatCone = new Mesh(new ConeGeometry(0.2, 0.5, 16), vinyl(0xff4d8d, 0.38));
hatCone.position.y = 0.28;
hatCone.castShadow = true;
const hatBrim = new Mesh(new CylinderGeometry(0.24, 0.26, 0.06, 16), vinyl(0xffd23f, 0.4));
hatBrim.position.y = 0.03;
hatBrim.castShadow = true;
const stripe = new Mesh(new CylinderGeometry(0.13, 0.15, 0.07, 16), vinyl(0xffffff, 0.35));
stripe.position.y = 0.24;
const pom = new Mesh(new SphereGeometry(0.075, 14, 10), vinyl(0xfff3a0, 0.35));
pom.position.y = 0.56;
pom.name = 'hat-pom';
hat.add(hatCone, hatBrim, stripe, pom);
hat.rotation.z = -0.08;
hat.visible = false;

const zzzCanvas = document.createElement('canvas');
zzzCanvas.width = 128;
zzzCanvas.height = 64;
const zctx = zzzCanvas.getContext('2d');
zctx.fillStyle = '#6d4aff';
zctx.font = '700 42px sans-serif';
zctx.textAlign = 'center';
zctx.textBaseline = 'middle';
zctx.fillText('Zzz', 64, 34);
const zzzTex = new CanvasTexture(zzzCanvas);
zzzTex.colorSpace = SRGBColorSpace;
const zzz = new Sprite(new SpriteMaterial({ map: zzzTex, transparent: true, depthWrite: false }));
zzz.scale.set(0.42, 0.21, 1);
zzz.visible = false;

const loader = new GLTFLoader();

function ensure(name) {
  if (cache.has(name)) return Promise.resolve(cache.get(name));
  if (inflight.has(name)) return inflight.get(name);
  const task = loader.loadAsync(`models/${name}.glb`).then((gltf) => {
    const pet = prepareCube(gltf);
    cache.set(name, pet);
    inflight.delete(name);
    return pet;
  });
  inflight.set(name, task);
  return task;
}

function applyColors() {
  if (!current) return;
  tintMaterials(current.materials, state.swatch || NATURAL);
}

function applyPose(dt = 0) {
  if (!current) return;
  const pet = current;
  pet.root.scale.set(state.body, state.height, state.body);
  const seek = state.paused ? state.modeT : null;
  poseClip(pet, state.mode, state.paused ? 0 : dt, seek, state.poseToken);
  if (pet.blush) pet.blush.visible = state.cheeks;
  hat.visible = state.hat;
  zzz.visible = state.mode === 'sleepy';
  if (state.mode === 'sleepy') {
    zzz.position.set(0.42, pet.hatAnchor.position.y + 0.12, 0.12);
    zzz.position.y += Math.sin(state.time * 1.6) * 0.04;
  }
  holder.position.set(0, 0, 0);
  if (state.mode === 'jump') {
    const p = Math.min(state.modeT / DURATION.jump, 1);
    holder.position.y = Math.sin(p * Math.PI) * 0.32;
  }
  let spin = 0;
  if (state.mode === 'spin') {
    const p = Math.min(state.modeT / DURATION.spin, 1);
    const e = p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) ** 2) / 2;
    spin = e * Math.PI * 2;
  }
  turntable.rotation.y = userYaw + spin;
  if (grid) {
    camera.fov = grid.fov;
    camera.updateProjectionMatrix();
    camera.position.copy(grid.cam);
    camera.lookAt(grid.look);
    return;
  }
  if (camera.fov !== BASE_FOV) {
    camera.fov = BASE_FOV;
    camera.updateProjectionMatrix();
  }
  camera.position.set(lookX, camY, camZ);
  camera.lookAt(lookX, lookY, 0);
}

function present(pet) {
  if (current && current !== pet) holder.remove(current.root);
  current = pet;
  state.shown = state.animal;
  if (!pet.root.parent) holder.add(pet.root);
  pet.hatAnchor.add(hat);
  if (pet.body) pet.body.add(zzz);
  applyColors();
  applyPose(0);
  syncControls();
}

let requestSerial = 0;
function setAnimal(name) {
  if (!ANIMALS.some(([id]) => id === name)) return Promise.resolve();
  state.animal = name;
  const serial = ++requestSerial;
  const ready = cache.has(name);
  state.loading = !ready;
  statusEl.hidden = ready;
  syncControls();
  return ensure(name).then((pet) => {
    if (serial !== requestSerial) return pet;
    state.loading = false;
    statusEl.hidden = true;
    present(pet);
    return pet;
  }).catch((error) => {
    if (serial === requestSerial) {
      state.loading = false;
      statusEl.hidden = true;
    }
    console.error(error);
    throw error;
  });
}

function setSwatch(hex) {
  state.swatch = hex.toLowerCase();
  applyColors();
  syncControls();
}

function setColor(hex) {
  state.swatch = limitLightness(hex);
  applyColors();
  syncControls();
}

function setNatural() {
  state.swatch = null;
  applyColors();
  syncControls();
}

function setHeight(n) {
  state.height = Math.min(1.4, Math.max(0.75, Number(n)));
  syncControls();
}

function setBody(n) {
  state.body = Math.min(1.3, Math.max(0.8, Number(n)));
  syncControls();
}

function setEyes(style) {
  if (!['round', 'happy', 'sparkly'].includes(style)) return;
  state.eyes = style;
  syncControls();
}

function setCheeks(on) {
  state.cheeks = Boolean(on);
  syncControls();
}

function setHat(on) {
  state.hat = Boolean(on);
  syncControls();
}

function play(name) {
  state.paused = false;
  state.poseToken += 1;
  if (!DURATION[name]) {
    state.mode = 'idle';
    state.modeT = 0;
    return;
  }
  state.mode = name;
  state.modeT = 0;
}

function pause(atTime) {
  state.paused = true;
  state.modeT = atTime;
  applyPose(0);
  renderer.render(scene, camera);
}

function resume() {
  state.paused = false;
}

function step(dt) {
  const scaled = dt * state.timeScale;
  state.time += scaled;
  if (state.mode !== 'idle') {
    state.modeT += scaled;
    if (state.modeT >= DURATION[state.mode]) {
      state.mode = 'idle';
      state.modeT = 0;
      state.poseToken += 1;
    }
  }
  applyPose(scaled);
}

const frameTimes = [];
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  frameTimes.push(now);
  while (frameTimes.length && now - frameTimes[0] > 2000) frameTimes.shift();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!state.paused) step(dt);
  else applyPose(0);
  renderer.render(scene, camera);
}

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);
}
window.addEventListener('resize', resize);

const pointers = new Map();
let lastPinch = null;
canvas.addEventListener('pointerdown', (event) => {
  canvas.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 2) lastPinch = pinchSpan();
});
canvas.addEventListener('pointermove', (event) => {
  const prev = pointers.get(event.pointerId);
  if (!prev) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 1) userYaw += (event.clientX - prev.x) * 0.012;
  else if (pointers.size >= 2 && lastPinch) {
    const span = pinchSpan();
    if (span) {
      camZ = clamp(camZ * (lastPinch / span), ZOOM_MIN, ZOOM_MAX);
      lastPinch = span;
    }
  }
});
function endPointer(event) {
  pointers.delete(event.pointerId);
  lastPinch = pointers.size >= 2 ? pinchSpan() : null;
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  camZ = clamp(camZ + event.deltaY * 0.004, ZOOM_MIN, ZOOM_MAX);
}, { passive: false });

function pinchSpan() {
  const pts = [...pointers.values()];
  if (pts.length < 2) return null;
  return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
}
function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function activeHex() {
  if (!current) return state.swatch || NATURAL;
  return state.swatch || current.baseColor;
}

function syncControls() {
  document.querySelectorAll('[data-animal]').forEach((button) => {
    button.setAttribute('aria-pressed', button.dataset.animal === state.animal ? 'true' : 'false');
  });
  document.querySelectorAll('[data-eyes]').forEach((button) => {
    button.setAttribute('aria-pressed', button.dataset.eyes === state.eyes ? 'true' : 'false');
  });
  document.querySelector('#pet-cheeks').setAttribute('aria-pressed', state.cheeks ? 'true' : 'false');
  document.querySelector('#pet-hat').setAttribute('aria-pressed', state.hat ? 'true' : 'false');
  const hex = activeHex();
  const picker = document.querySelector('#pet-colour');
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) picker.value = hex;
  document.querySelectorAll('.swatch').forEach((button) => {
    const selected = state.swatch == null
      ? button.dataset.swatch === 'natural'
      : button.dataset.swatch === state.swatch.toLowerCase();
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    if (button.dataset.swatch === 'natural' && current) button.style.background = current.baseColor;
  });
  document.querySelector('#pet-height').value = String(state.height);
  document.querySelector('#pet-body').value = String(state.body);
}

const animalBox = document.querySelector('#animals');
for (const [id, label] of ANIMALS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.animal = id;
  button.textContent = label;
  button.setAttribute('aria-pressed', id === 'penguin' ? 'true' : 'false');
  button.addEventListener('click', () => setAnimal(id));
  animalBox.append(button);
}

const swatchBox = document.querySelector('#swatches');
for (const swatch of SWATCHES) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'swatch';
  button.dataset.swatch = swatch.hex ? swatch.hex.toLowerCase() : 'natural';
  button.style.background = swatch.hex || 'conic-gradient(#f2b66d, #b9a6ec, #5fa8e8, #6fd6a6, #f2b66d)';
  button.setAttribute('aria-label', `Colour ${swatch.name}`);
  button.addEventListener('click', () => (swatch.hex ? setSwatch(swatch.hex) : setNatural()));
  swatchBox.append(button);
}

document.querySelectorAll('[data-eyes]').forEach((button) => {
  button.addEventListener('click', () => setEyes(button.dataset.eyes));
});
document.querySelector('#pet-cheeks').addEventListener('click', () => setCheeks(!state.cheeks));
document.querySelector('#pet-hat').addEventListener('click', () => setHat(!state.hat));
document.querySelectorAll('[data-emote]').forEach((button) => {
  button.addEventListener('click', () => play(button.dataset.emote));
});
document.querySelector('#pet-height').addEventListener('input', (event) => setHeight(event.target.value));
document.querySelector('#pet-body').addEventListener('input', (event) => setBody(event.target.value));
document.querySelector('#pet-colour').addEventListener('input', (event) => setColor(event.target.value));

function hatFollow() {
  applyPose(0);
  if (!current || !current.hatAnchor) return { hatY: 0, headY: 0, gap: 0 };
  current.hatAnchor.updateWorldMatrix(true, true);
  current.hatAnchor.getWorldPosition(v3a);
  pom.getWorldPosition(v3b);
  return { hatY: v3b.y, headY: v3a.y, gap: v3a.distanceTo(v3b) };
}

const gridGroup = new Group();
scene.add(gridGroup);

async function showFaceGrid(names) {
  const pets = [];
  for (const name of names) pets.push(await ensure(name));
  holder.visible = false;
  while (gridGroup.children.length) gridGroup.remove(gridGroup.children[0]);
  pets.forEach((pet, index) => {
    if (pet.root.parent) pet.root.parent.remove(pet.root);
    const col = index % 2;
    const row = Math.floor(index / 2);
    pet.root.position.set(-0.4 + col * 1.1, 0.2 - row * 1.15, 0);
    pet.root.rotation.set(0, -0.4, 0);
    pet.root.scale.set(1, 1, 1);
    poseClip(pet, 'idle', 0, 0, pet.token);
    if (pet.blush) pet.blush.visible = true;
    gridGroup.add(pet.root);
  });
  grid = {
    pets,
    fov: 34,
    cam: new Vector3(0, 0.85, 4.2),
    look: new Vector3(0, 0.7, 0),
  };
  applyPose(0);
  renderer.render(scene, camera);
}

function clearFaceGrid() {
  if (!grid) return;
  for (const pet of grid.pets) {
    pet.root.position.set(0, 0, 0);
    pet.root.rotation.set(0, 0, 0);
    pet.root.scale.set(1, 1, 1);
    if (pet.root.parent === gridGroup) gridGroup.remove(pet.root);
  }
  grid = null;
  holder.visible = true;
  camera.fov = BASE_FOV;
  camera.updateProjectionMatrix();
  if (current) present(current);
  else {
    applyPose(0);
    renderer.render(scene, camera);
  }
}

function captureFaceSheet(names) {
  const width = 390;
  const height = 844;
  const sheet = document.createElement('canvas');
  sheet.width = width;
  sheet.height = height;
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#f6f2fc';
  ctx.fillRect(0, 0, width, height);
  const cell = 176;
  const gapX = 14;
  const gapY = 36;
  const padX = Math.round((width - cell * 2 - gapX) / 2);
  const padY = 48;
  const spots = [
    [padX, padY],
    [padX + cell + gapX, padY],
    [padX, padY + cell + gapY],
    [padX + cell + gapX, padY + cell + gapY],
  ];
  const pixelRatio = renderer.getPixelRatio();
  const prevHolder = holder.visible;
  const prevHat = hat.visible;
  const prevGround = ground.visible;
  holder.visible = false;
  hat.visible = false;
  ground.visible = false;
  zzz.visible = false;
  renderer.setPixelRatio(1);
  renderer.setSize(cell, cell, false);
  const gl = renderer.getContext();
  const buf = new Uint8Array(cell * cell * 4);
  const paint = (pet, index) => {
    if (pet.root.parent) pet.root.parent.remove(pet.root);
    pet.root.position.set(0, 0, 0);
    pet.root.rotation.set(0, -0.45, 0);
    pet.root.scale.set(1, 1, 1);
    gridGroup.add(pet.root);
    poseClip(pet, 'idle', 0, 0, pet.token);
    if (pet.blush) pet.blush.visible = true;
    camera.fov = 28;
    camera.aspect = 1;
    camera.updateProjectionMatrix();
    camera.position.set(0.15, 1.05, 3.6);
    camera.lookAt(0, 0.85, 0);
    renderer.render(scene, camera);
    gl.readPixels(0, 0, cell, cell, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const img = ctx.createImageData(cell, cell);
    for (let y = 0; y < cell; y += 1) {
      const src = (cell - 1 - y) * cell * 4;
      const row = buf.subarray(src, src + cell * 4);
      for (let x = 0; x < cell; x += 1) {
        const i = x * 4;
        const o = y * cell * 4 + i;
        const a = row[i + 3];
        if (a < 12) {
          img.data[o] = 246;
          img.data[o + 1] = 242;
          img.data[o + 2] = 252;
          img.data[o + 3] = 255;
        } else {
          img.data[o] = row[i];
          img.data[o + 1] = row[i + 1];
          img.data[o + 2] = row[i + 2];
          img.data[o + 3] = 255;
        }
      }
    }
    const spot = spots[index];
    ctx.putImageData(img, spot[0], spot[1]);
    gridGroup.remove(pet.root);
    pet.root.position.set(0, 0, 0);
    pet.root.rotation.set(0, 0, 0);
    pet.root.scale.set(1, 1, 1);
  };
  return Promise.all(names.map((name) => ensure(name))).then((loaded) => {
    loaded.forEach((pet, index) => paint(pet, index));
    holder.visible = prevHolder;
    hat.visible = prevHat;
    ground.visible = prevGround;
    renderer.setPixelRatio(pixelRatio);
    resize();
    if (current) present(current);
    else {
      applyPose(0);
      renderer.render(scene, camera);
    }
    return sheet.toDataURL('image/png');
  });
}

function pixelScore() {
  applyPose(0);
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  if (!w || !h) return 0;
  const buf = new Uint8Array(4);
  let hits = 0;
  for (let y = 0.22; y <= 0.82; y += 0.06) {
    for (let x = 0.22; x <= 0.78; x += 0.06) {
      gl.readPixels(Math.floor(x * (w - 1)), Math.floor(y * (h - 1)), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      if (buf[3] > 12 && buf[0] + buf[1] + buf[2] > 24) hits += 1;
    }
  }
  return hits;
}

function fps() {
  if (frameTimes.length < 2) return 0;
  const seconds = (frameTimes[frameTimes.length - 1] - frameTimes[0]) / 1000;
  if (seconds <= 0) return 0;
  return (frameTimes.length - 1) / seconds;
}

resize();
requestAnimationFrame(frame);
setAnimal('penguin');

window.__PETS = {
  setAnimal,
  setColor,
  setSwatch,
  setNatural,
  setHeight,
  setBody,
  setEyes,
  setCheeks,
  setHat,
  play,
  pause,
  resume,
  showFaceGrid,
  clearFaceGrid,
  captureFaceSheet,
  fps,
  pixelScore,
  hatFollow,
  get animal() { return state.animal; },
  get shown() { return state.shown; },
  get loading() { return state.loading; },
  get mode() { return state.mode; },
  get hatVisible() { return state.hat; },
  get cheeks() { return state.cheeks; },
  get eyes() { return state.eyes; },
  get height() { return state.height; },
  get body() { return state.body; },
  get color() { return activeHex(); },
  get yaw() { return userYaw; },
  set yaw(value) {
    userYaw = Number(value);
    applyPose(0);
    renderer.render(scene, camera);
  },
  get zoom() { return camZ; },
  set zoom(value) {
    camZ = clamp(Number(value), ZOOM_MIN, ZOOM_MAX);
    applyPose(0);
    renderer.render(scene, camera);
  },
  get lookY() { return lookY; },
  set lookY(value) { lookY = Number(value); },
  get camY() { return camY; },
  set camY(value) { camY = Number(value); },
  get timeScale() { return state.timeScale; },
  set timeScale(value) { state.timeScale = Number(value); },
  anchors() {
    return current ? { head: current.hatAnchor, hand: null } : null;
  },
};
