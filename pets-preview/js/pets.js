import {
  Scene, PerspectiveCamera, WebGLRenderer, Group, Mesh,
  SphereGeometry, ConeGeometry, CylinderGeometry, TorusGeometry, PlaneGeometry,
  MeshPhysicalMaterial, MeshBasicMaterial, ShadowMaterial, Sprite, SpriteMaterial, CanvasTexture,
  HemisphereLight, DirectionalLight,
  SRGBColorSpace, NoToneMapping, PCFSoftShadowMap,
  Vector3, Color,
} from 'three';
import { GLTFLoader } from '../vendor/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '../vendor/examples/jsm/libs/meshopt_decoder.module.js';

const ANIMALS = [
  ['dog', 'Dog'],
  ['cat', 'Cat'],
  ['bunny', 'Bunny'],
  ['penguin', 'Penguin'],
  ['horse', 'Horse'],
  ['monkey', 'Monkey'],
  ['tiger', 'Tiger'],
  ['shark', 'Shark'],
  ['pig', 'Pig'],
  ['axolotl', 'Axolotl'],
  ['capybara', 'Capybara'],
  ['dragon', 'Dragon'],
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
const ZOOM_MAX = 7.2;
const PARTS = ['body', 'head', 'arm_L', 'arm_R', 'foot_L', 'foot_R', 'tail', 'eyes_open', 'eyes_happy', 'eyes_sleepy'];

const canvas = document.querySelector('#stage');
const statusEl = document.querySelector('#pet-status');
const scene = new Scene();
const camera = new PerspectiveCamera(30, 1, 0.1, 40);
const BASE_FOV = 30;
let camZ = 3.35;
let camY = 1.7;
let lookY = 1.22;
camera.position.set(0, camY, camZ);

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
key.target.position.set(0, 0.85, 0);

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
};

let userYaw = -0.48;
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
hat.position.y = 0.12;
hat.rotation.z = -0.18;
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

const BROWN_EYES = new Set(['bunny', 'dog', 'horse', 'pig', 'penguin', 'shark']);
const EYE_LAYOUT = {
  dog: { spread: 0.31, drop: 0.055, s: 1.02 },
  cat: { spread: 0.3, drop: 0.05, s: 1.08 },
  bunny: { spread: 0.29, drop: 0.05, s: 1.08 },
  penguin: { spread: 0.25, drop: 0.04, s: 0.96 },
  horse: { spread: 0.34, drop: 0.04, s: 1 },
  monkey: { spread: 0.26, drop: 0.04, s: 0.96 },
  tiger: { spread: 0.31, drop: 0.05, s: 1.04 },
  shark: { spread: 0.31, drop: 0.03, s: 1 },
  pig: { spread: 0.3, drop: 0.02, s: 1 },
  axolotl: { spread: 0.35, drop: 0.04, s: 0.9 },
  capybara: { spread: 0.33, drop: 0.015, s: 0.8 },
  dragon: { spread: 0.3, drop: 0.05, s: 1.06 },
};
const eyeGeo = new SphereGeometry(1, 22, 16);
const eyeMatDark = new MeshBasicMaterial({ color: 0x1a1424 });
const eyeMatBrown = new MeshBasicMaterial({ color: 0x3a2418 });
const eyeMatWhite = new MeshBasicMaterial({ color: 0xffffff });
const smileMat = new MeshBasicMaterial({ color: 0x3a2418 });

function buildCartoonEyes(animal, anchor) {
  const layout = EYE_LAYOUT[animal] || { spread: 0.3, drop: 0.05, s: 1 };
  const mat = BROWN_EYES.has(animal) ? eyeMatBrown : eyeMatDark;
  const y = (anchor ? anchor.position.y : 0.5) - layout.drop;
  const z = (anchor ? anchor.position.z : 0.56) + 0.045;
  const w = 0.156 * layout.s;
  const h = 0.172 * layout.s;
  const d = 0.08 * layout.s;
  const rig = new Group();
  rig.name = 'cartoon_eyes';
  const sockets = [];
  const arc = Math.PI * 0.8;
  const sleepArc = Math.PI * 0.58;
  for (const side of [-1, 1]) {
    const socket = new Group();
    socket.position.set(side * layout.spread, y, z);
    socket.rotation.y = -side * 0.1;
    const open = new Group();
    const eye = new Mesh(eyeGeo, mat);
    eye.scale.set(w, h, d);
    eye.castShadow = false;
    eye.renderOrder = 2;
    const big = new Mesh(eyeGeo, eyeMatWhite);
    big.scale.set(0.03 * layout.s, 0.036 * layout.s, 0.018 * layout.s);
    big.position.set(side * w * 0.34, h * 0.38, d * 0.95);
    big.castShadow = false;
    big.renderOrder = 3;
    const small = new Mesh(eyeGeo, eyeMatWhite);
    small.scale.set(0.016 * layout.s, 0.018 * layout.s, 0.012 * layout.s);
    small.position.set(side * w * 0.02, h * 0.02, d * 1.15);
    small.castShadow = false;
    small.renderOrder = 3;
    open.add(eye, big, small);
    const happy = new Mesh(new TorusGeometry(w * 1.02, h * 0.2, 8, 18, arc), mat);
    happy.rotation.z = Math.PI / 2 - arc / 2;
    happy.position.z = 0.02;
    happy.castShadow = false;
    happy.visible = false;
    happy.renderOrder = 2;
    const sleepy = new Mesh(new TorusGeometry(w * 0.92, h * 0.15, 8, 14, sleepArc), mat);
    sleepy.rotation.z = -Math.PI / 2 - sleepArc / 2;
    sleepy.scale.y = 0.72;
    sleepy.position.z = 0.02;
    sleepy.castShadow = false;
    sleepy.visible = false;
    sleepy.renderOrder = 2;
    socket.add(open, happy, sleepy);
    rig.add(socket);
    sockets.push({ open, happy, sleepy });
  }
  return { rig, sockets };
}

function addWhiskers(head, anchor, color) {
  const mat = new MeshBasicMaterial({ color });
  const geo = new CylinderGeometry(0.02, 0.008, 1, 6);
  const y = (anchor ? anchor.position.y : 0.5) - 0.16;
  const z = (anchor ? anchor.position.z : 0.56) + 0.02;
  const rows = [
    { dy: 0.055, pitch: 0.22 },
    { dy: 0, pitch: 0.02 },
    { dy: -0.05, pitch: -0.2 },
  ];
  for (const side of [-1, 1]) {
    for (const row of rows) {
      const len = 0.4;
      const whisker = new Mesh(geo, mat);
      whisker.scale.y = len;
      whisker.rotation.z = side * Math.PI / 2;
      whisker.rotation.x = row.pitch;
      whisker.position.set(side * 0.4, y + row.dy, z);
      whisker.castShadow = false;
      head.add(whisker);
    }
  }
}

function addBead(head, position, scale, color) {
  const bead = new Mesh(eyeGeo, new MeshBasicMaterial({ color }));
  bead.scale.set(scale[0], scale[1], scale[2]);
  bead.position.copy(position);
  bead.castShadow = false;
  bead.renderOrder = 2;
  head.add(bead);
  return bead;
}

function addTailTip(animal, tail, baseMat) {
  if (!tail) return;
  const specs = {
    dog: { pos: [0.48, 0.22, -0.08], s: 0.16 },
    cat: { pos: [0.5, 0.28, -0.02], s: 0.15 },
    tiger: { pos: [0.5, 0.2, -0.08], s: 0.16 },
    horse: { color: 0x9b7bea, pos: [0.46, 0.12, -0.12], s: 0.17 },
    pig: { pos: [0.42, 0.18, -0.06], s: 0.12 },
    monkey: { pos: [0.52, 0.24, 0.0], s: 0.12 },
    bunny: { color: 0xfff7fb, pos: [0.42, 0.1, 0.02], s: 0.17 },
  };
  const spec = specs[animal];
  if (!spec) return;
  const mat = spec.color == null ? baseMat : vinyl(spec.color, 0.42);
  if (!mat) return;
  const puff = new Mesh(new SphereGeometry(1, 14, 10), mat);
  puff.scale.set(spec.s, spec.s * 0.82, spec.s);
  puff.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
  puff.castShadow = true;
  tail.add(puff);
}

function addAnimalFeatures(animal, head, anchor) {
  const eyeY = anchor ? anchor.position.y : 0.5;
  const eyeZ = anchor ? anchor.position.z : 0.56;
  if (animal === 'cat') {
    addWhiskers(head, anchor, 0x6a5088);
    addBead(head, new Vector3(0, eyeY - 0.16, eyeZ + 0.04), [0.075, 0.055, 0.05], 0xff8fb0);
  } else if (animal === 'tiger') {
    addWhiskers(head, anchor, 0x3a2a38);
    addBead(head, new Vector3(0, 0.4, 0.68), [0.09, 0.065, 0.055], 0xff7a9a);
  } else if (animal === 'dog') {
    addBead(head, new Vector3(0, 0.4, 0.72), [0.105, 0.075, 0.06], 0x2a211c);
  } else if (animal === 'bunny') {
    addBead(head, new Vector3(0, eyeY - 0.15, eyeZ + 0.035), [0.062, 0.048, 0.04], 0xff7fa3);
  } else if (animal === 'horse') {
    addBead(head, new Vector3(0.1, 0.34, 0.84), [0.05, 0.04, 0.035], 0x8a5a4a);
    addBead(head, new Vector3(-0.1, 0.34, 0.84), [0.05, 0.04, 0.035], 0x8a5a4a);
  } else if (animal === 'pig') {
    addBead(head, new Vector3(0.07, 0.42, 0.76), [0.045, 0.055, 0.03], 0xc85a78);
    addBead(head, new Vector3(-0.07, 0.42, 0.76), [0.045, 0.055, 0.03], 0xc85a78);
  } else if (animal === 'capybara') {
    addBead(head, new Vector3(0, 0.5, 0.78), [0.16, 0.07, 0.05], 0x6a4632);
  } else if (animal === 'penguin') {
    const beak = new Mesh(new SphereGeometry(1, 16, 12), vinyl(0xffa23a, 0.35));
    beak.scale.set(0.2, 0.12, 0.16);
    beak.position.set(0, eyeY - 0.2, eyeZ + 0.05);
    beak.castShadow = true;
    head.add(beak);
    const arc = Math.PI * 0.72;
    const smile = new Mesh(new TorusGeometry(0.09, 0.018, 8, 16, arc), smileMat);
    smile.rotation.z = -Math.PI / 2 - arc / 2;
    smile.position.set(0, beak.position.y - 0.11, eyeZ + 0.02);
    smile.castShadow = false;
    smile.renderOrder = 2;
    head.add(smile);
  }
}

function resetCartoonEyes(pet) {
  if (!pet.face) return;
  for (const socket of pet.face.sockets) socket.open.scale.set(1, 1, 1);
}

function showCartoonEyes(pet, which) {
  if (!pet.face) return;
  for (const socket of pet.face.sockets) {
    socket.open.visible = which === 'open';
    socket.happy.visible = which === 'happy';
    socket.sleepy.visible = which === 'sleepy';
  }
}

function capture(obj) {
  return {
    obj,
    p: obj.position.clone(),
    r: obj.rotation.clone(),
    s: obj.scale.clone(),
  };
}

function restore(pet) {
  for (const base of Object.values(pet.bases)) {
    base.obj.position.copy(base.p);
    base.obj.rotation.copy(base.r);
    base.obj.scale.copy(base.s);
  }
}

function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
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
  return { h, s, l };
}

function hslToHex(h, s, l) {
  const hue = (p, q, t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  let r;
  let g;
  let b;
  if (s === 0) r = g = b = l;
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue(p, q, h + 1 / 3);
    g = hue(p, q, h);
    b = hue(p, q, h - 1 / 3);
  }
  const channel = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function limitLightness(hex) {
  const clean = `#${hex.replace('#', '').toLowerCase()}`;
  const { h, s, l } = hexToHsl(clean);
  if (l >= 0.34 && l <= 0.72) return clean;
  return hslToHex(h, s, Math.min(0.72, Math.max(0.34, l)));
}

function prepare(gltf) {
  const root = gltf.scene;
  const nodes = {};
  const baseMats = new Set();
  const bellyMats = new Set();
  let info = root;
  root.traverse((obj) => {
    if (obj.name) nodes[obj.name] = obj;
    if (obj.userData && obj.userData.baseColor) info = obj;
    if (obj.isMesh) {
      obj.castShadow = true;
      const list = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of list) {
        if (!mat) continue;
        if (mat.name === 'base') baseMats.add(mat);
        else if (mat.name === 'belly') bellyMats.add(mat);
      }
    }
  });
  for (const name of ['eyes_open', 'eyes_happy', 'eyes_sleepy', 'mouth_open']) {
    if (nodes[name]) nodes[name].visible = false;
  }
  const bases = {};
  for (const name of PARTS) {
    if (nodes[name]) bases[name] = capture(nodes[name]);
  }
  const animal = info.userData.animal;
  const face = nodes.head ? buildCartoonEyes(animal, nodes.eyes_open) : null;
  if (face && nodes.head) {
    nodes.head.add(face.rig);
    addAnimalFeatures(animal, nodes.head, nodes.eyes_open);
  }
  addTailTip(animal, nodes.tail, [...baseMats][0]);
  return {
    root,
    nodes,
    bases,
    face,
    baseMats: [...baseMats],
    bellyMats: [...bellyMats],
    baseColor: info.userData.baseColor || '#888888',
    bellyColor: info.userData.bellyColor || '#ffffff',
  };
}

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

function ensure(name) {
  if (cache.has(name)) return Promise.resolve(cache.get(name));
  if (inflight.has(name)) return inflight.get(name);
  const task = loader.loadAsync(`models/${name}.glb`).then((gltf) => {
    const pet = prepare(gltf);
    cache.set(name, pet);
    inflight.delete(name);
    return pet;
  });
  inflight.set(name, task);
  return task;
}

function applyColors() {
  if (!current) return;
  const natural = state.swatch == null;
  const baseHex = natural ? current.baseColor : state.swatch;
  const base = new Color(baseHex);
  const belly = natural
    ? new Color(current.bellyColor)
    : base.clone().lerp(new Color(0xffffff), 0.7);
  for (const mat of current.baseMats) mat.color.copy(base);
  for (const mat of current.bellyMats) mat.color.copy(belly);
}

function showEyes(which) {
  if (current.nodes.eyes_open) current.nodes.eyes_open.visible = false;
  if (current.nodes.eyes_happy) current.nodes.eyes_happy.visible = false;
  if (current.nodes.eyes_sleepy) current.nodes.eyes_sleepy.visible = false;
  showCartoonEyes(current, which);
}

function showMouth(open) {
  const nodes = current.nodes;
  if (nodes.mouth) nodes.mouth.visible = !open;
  if (nodes.mouth_open) nodes.mouth_open.visible = open && !!nodes.mouth_open;
}

function smooth(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function applyPose() {
  if (!current) return;
  const pet = current;
  restore(pet);
  const body = pet.bases.body;
  const head = pet.bases.head;
  const height = state.height;
  const bodySize = state.body;
  if (body) {
    body.obj.scale.set(body.s.x * bodySize, body.s.y * height, body.s.z * bodySize);
  }
  const span = head && body ? head.p.y - body.p.y : 0.9;
  const extra = (height - 1) * span;
  const liftPart = (name, outward) => {
    const base = pet.bases[name];
    if (!base) return;
    base.obj.position.x = base.p.x * (outward ? bodySize : 1);
    base.obj.position.y = base.p.y + extra;
    base.obj.position.z = base.p.z * (outward ? bodySize : 1);
  };
  if (head) head.obj.position.y = head.p.y + extra;
  liftPart('arm_L', true);
  liftPart('arm_R', true);
  liftPart('tail', false);
  if (pet.bases.foot_L) {
    pet.bases.foot_L.obj.position.x = pet.bases.foot_L.p.x * bodySize;
    pet.bases.foot_L.obj.position.z = pet.bases.foot_L.p.z * bodySize;
  }
  if (pet.bases.foot_R) {
    pet.bases.foot_R.obj.position.x = pet.bases.foot_R.p.x * bodySize;
    pet.bases.foot_R.obj.position.z = pet.bases.foot_R.p.z * bodySize;
  }

  const mode = state.mode;
  const t = state.modeT;
  const bob = Math.sin(state.time * 2.2);
  holder.position.set(0, 0, 0);
  resetCartoonEyes(pet);
  if (pet.nodes.cheeks) pet.nodes.cheeks.visible = state.cheeks;
  hat.visible = state.hat;
  zzz.visible = false;
  showMouth(false);

  let eye = state.eyes === 'happy' ? 'happy' : 'open';
  if (mode === 'sleepy') {
    eye = 'sleepy';
    if (head) {
      head.obj.rotation.x += 0.28;
      head.obj.rotation.z += Math.sin(state.time * 1.05) * 0.06;
    }
    if (body) {
      const breathe = 1 + Math.sin(state.time * 1.15) * 0.025;
      body.obj.scale.y *= breathe;
      body.obj.position.y += Math.sin(state.time * 1.15) * 0.02;
    }
    zzz.visible = true;
    zzz.position.set(0.55, 0.85 + Math.sin(state.time * 1.6) * 0.04, 0.15);
  } else if (mode === 'jump') {
    eye = 'happy';
    showMouth(true);
    const p = Math.min(t / DURATION.jump, 1);
    const lift = Math.sin(p * Math.PI);
    holder.position.y = lift * 0.32;
    if (pet.bases.arm_L) pet.bases.arm_L.obj.rotation.z = 1.9;
    if (pet.bases.arm_R) pet.bases.arm_R.obj.rotation.z = -1.9;
    if (body) body.obj.scale.y *= 1 + lift * 0.06;
  } else {
    holder.position.y = bob * 0.03;
    if (body && (mode === 'idle' || mode === 'walk' || mode === 'wave' || mode === 'spin')) {
      const breathe = 1 + bob * 0.015;
      body.obj.scale.y *= breathe;
    }
    const phase = state.time % 4.5;
    if (!state.paused && phase > 4.32) {
      const k = phase < 4.41 ? (phase - 4.32) / 0.09 : (4.5 - phase) / 0.09;
      if (eye === 'open' && pet.face) {
        const squash = 1 - 0.92 * k;
        for (const socket of pet.face.sockets) socket.open.scale.y = squash;
      } else if (eye === 'happy') {
        eye = k > 0.45 ? 'sleepy' : 'happy';
      }
    }
  }

  if (mode === 'wave') {
    const up = smooth(t / 0.16);
    const wiggle = Math.sin(t * 8) * 0.08;
    if (pet.bases.arm_L) {
      pet.bases.arm_L.obj.rotation.z = (1.92 + wiggle) * up;
      pet.bases.arm_L.obj.rotation.x = -0.35 * up;
    }
  }

  if (mode === 'walk') {
    const cycle = t * 7.5;
    holder.position.x = Math.sin(t * 1.25) * 0.28;
    if (body) body.obj.rotation.z += Math.sin(cycle) * 0.08;
    if (body) body.obj.position.y += Math.abs(Math.sin(cycle)) * 0.035;
    if (pet.bases.foot_L) pet.bases.foot_L.obj.rotation.x = Math.sin(cycle) * 0.45;
    if (pet.bases.foot_R) pet.bases.foot_R.obj.rotation.x = Math.sin(cycle + Math.PI) * 0.45;
    if (pet.bases.tail) pet.bases.tail.obj.rotation.y += Math.sin(cycle) * 0.35;
  } else if (pet.bases.tail && mode !== 'sleepy') {
    pet.bases.tail.obj.rotation.y += Math.sin(state.time * 2.4) * 0.18;
  }

  if (eye === 'open' && state.eyes === 'sparkly' && pet.face && mode !== 'sleepy') {
    for (const socket of pet.face.sockets) {
      socket.open.scale.x *= 1.22;
      socket.open.scale.z *= 1.22;
      socket.open.scale.y *= 1.22;
    }
  }

  showEyes(eye);

  let spin = 0;
  if (mode === 'spin') {
    const p = Math.min(t / DURATION.spin, 1);
    const e = p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) ** 2) / 2;
    spin = e * Math.PI * 2;
    holder.position.y += Math.abs(Math.sin(t * 10)) * 0.04;
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
  camera.position.set(0, camY, camZ);
  camera.lookAt(0, lookY, 0);
}

function present(pet) {
  if (current && current !== pet) holder.remove(current.root);
  current = pet;
  state.shown = state.animal;
  if (!pet.root.parent) holder.add(pet.root);
  if (pet.nodes.hat_anchor) pet.nodes.hat_anchor.add(hat);
  if (pet.nodes.head) pet.nodes.head.add(zzz);
  applyColors();
  applyPose();
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
  applyPose();
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
    }
  }
  applyPose();
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
  else applyPose();
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
  if (!current) return state.swatch || '#3d5a9e';
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

function hatOffset() {
  applyPose();
  if (!current || !current.nodes.hat_anchor) return 0;
  current.nodes.hat_anchor.updateWorldMatrix(true, true);
  current.nodes.hat_anchor.getWorldPosition(v3a);
  pom.getWorldPosition(v3b);
  return v3a.distanceTo(v3b);
}

function hatFollow() {
  applyPose();
  if (!current || !current.nodes.hat_anchor) return { hatY: 0, headY: 0, gap: 0 };
  current.nodes.hat_anchor.updateWorldMatrix(true, true);
  current.nodes.hat_anchor.getWorldPosition(v3a);
  pom.getWorldPosition(v3b);
  return { hatY: v3b.y, headY: v3a.y, gap: v3a.distanceTo(v3b) };
}

const gridGroup = new Group();
scene.add(gridGroup);

const FACE_SPOTS = [
  [-0.7, 0.62],
  [0.7, 0.62],
  [-0.7, -0.48],
  [0.7, -0.48],
];

async function showFaceGrid(names) {
  const pets = [];
  for (const name of names) pets.push(await ensure(name));
  holder.visible = false;
  while (gridGroup.children.length) gridGroup.remove(gridGroup.children[0]);
  pets.forEach((pet, index) => {
    if (pet.root.parent) pet.root.parent.remove(pet.root);
    const spot = FACE_SPOTS[index] || [0, 0];
    pet.root.position.set(spot[0], spot[1], 0);
    pet.root.rotation.set(0, -0.5, 0);
    pet.root.scale.set(1, 1, 1);
    resetCartoonEyes(pet);
    showCartoonEyes(pet, 'open');
    if (pet.nodes.cheeks) pet.nodes.cheeks.visible = true;
    if (pet.nodes.mouth) pet.nodes.mouth.visible = true;
    if (pet.nodes.mouth_open) pet.nodes.mouth_open.visible = false;
    if (pet.nodes.eyes_open) pet.nodes.eyes_open.visible = false;
    if (pet.nodes.eyes_happy) pet.nodes.eyes_happy.visible = false;
    if (pet.nodes.eyes_sleepy) pet.nodes.eyes_sleepy.visible = false;
    gridGroup.add(pet.root);
  });
  grid = {
    pets,
    fov: 38,
    cam: new Vector3(0, 1.55, 2.15),
    look: new Vector3(0, 1.42, 0),
  };
  applyPose();
  renderer.render(scene, camera);
}

function clearFaceGrid() {
  if (!grid) return;
  for (const pet of grid.pets) {
    pet.root.position.set(0, 0, 0);
    pet.root.rotation.set(0, 0, 0);
    if (pet.root.parent === gridGroup) gridGroup.remove(pet.root);
  }
  grid = null;
  holder.visible = true;
  camera.fov = BASE_FOV;
  camera.updateProjectionMatrix();
  if (current) present(current);
  else {
    applyPose();
    renderer.render(scene, camera);
  }
}

function pixelScore() {
  applyPose();
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
  fps,
  pixelScore,
  hatOffset,
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
    applyPose();
    renderer.render(scene, camera);
  },
  get zoom() { return camZ; },
  set zoom(value) {
    camZ = clamp(Number(value), ZOOM_MIN, ZOOM_MAX);
    applyPose();
    renderer.render(scene, camera);
  },
  get lookY() { return lookY; },
  set lookY(value) { lookY = Number(value); },
  get camY() { return camY; },
  set camY(value) { camY = Number(value); },
  get timeScale() { return state.timeScale; },
  set timeScale(value) { state.timeScale = Number(value); },
  anchors() {
    return current ? { head: current.nodes.hat_anchor, hand: current.nodes.arm_L } : null;
  },
};
