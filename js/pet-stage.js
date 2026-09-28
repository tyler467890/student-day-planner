/**
 * Embedded 3D pet for the Today screen.
 * Models and Three.js live under /models and /vendor so the service worker
 * can cache them. /pets-preview/ stays a separate page.
 */

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

const DURATION = { wave: 1.55, jump: 1.2, spin: 1.35, celebrate: 2.55, sleepy: 2.8 };
const PARTS = ['body', 'head', 'arm_L', 'arm_R', 'foot_L', 'foot_R', 'tail', 'eyes_open', 'eyes_happy', 'eyes_sleepy'];

const EYE_LAYOUT = {
  dog: { spread: 0.2, s: 1.02, iris: 0x8d5a32 },
  cat: { spread: 0.19, s: 1.06, iris: 0x3f9a62 },
  bunny: { spread: 0.185, s: 1.06, iris: 0x6eafdf },
  penguin: { spread: 0.16, s: 0.96, iris: 0x4e86c4 },
  horse: { spread: 0.21, s: 0.98, iris: 0x7a4a2a },
  monkey: { spread: 0.175, s: 0.98, iris: 0x6b4630 },
  tiger: { spread: 0.195, s: 1.02, iris: 0xc4a24a },
  shark: { spread: 0.19, s: 0.98, iris: 0x3d86c8 },
  pig: { spread: 0.19, s: 1, iris: 0x6aa0d4 },
  axolotl: { spread: 0.2, s: 0.9, iris: 0xc47a4a },
  capybara: { spread: 0.2, s: 0.82, iris: 0x7a5434 },
  dragon: { spread: 0.19, s: 1.02, iris: 0x3c9a6a },
};

const SNOUT = {
  dog: { mouth: 'smile' },
  cat: { mouth: 'w' },
  bunny: { mouth: 'w' },
  penguin: { mouth: 'closed' },
  horse: { mouth: 'smile' },
  monkey: { mouth: 'smile' },
  tiger: { mouth: 'w' },
  shark: { mouth: 'closed' },
  pig: { mouth: 'smile' },
  axolotl: { mouth: 'smile' },
  capybara: { mouth: 'smile' },
  dragon: { mouth: 'smile' },
};

export function webglAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function vinyl(color, roughness = 0.4) {
  return new MeshPhysicalMaterial({
    color,
    roughness,
    metalness: 0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.25,
  });
}

function limitLightness(hex) {
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

export function createPetStage(canvas) {
  const scene = new Scene();
  const camera = new PerspectiveCamera(32, 1, 0.1, 40);
  const lookX = 0.12;
  const lookY = 1.38;
  camera.position.set(lookX, 1.5, 6.55);
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

  const ground = new Mesh(new PlaneGeometry(12, 12), new ShadowMaterial({ opacity: 0.22 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0.001;
  ground.receiveShadow = true;
  scene.add(ground);

  const turntable = new Group();
  scene.add(turntable);
  const holder = new Group();
  turntable.add(holder);

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
  hat.add(hatCone, hatBrim, stripe, pom);
  hat.position.y = 0.04;
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

  const eyeGeo = new SphereGeometry(1, 20, 16);
  const scleraMat = new MeshBasicMaterial({ color: 0xf4efe6 });
  const pupilMat = new MeshBasicMaterial({ color: 0x2a211c });
  const catchMat = new MeshBasicMaterial({ color: 0xfffaf4 });
  const lidMat = new MeshBasicMaterial({ color: 0x8d6f68 });
  const tongueMat = new MeshBasicMaterial({ color: 0xf7b4c4 });
  const mouthMat = new MeshBasicMaterial({ color: 0xd46a84 });
  const blushMat = new MeshBasicMaterial({ color: 0xff9eb8, transparent: true, opacity: 0.88, depthWrite: false });
  const irisMats = new Map();

  const state = {
    animal: 'penguin',
    color: null,
    eyes: 'round',
    cheeks: true,
    hat: false,
    height: 1,
    body: 1,
    mode: 'idle',
    modeT: 0,
    time: 0,
    ambient: 'idle',
    idleFor: 0,
    active: false,
  };

  let current = null;
  const cache = new Map();
  const inflight = new Map();
  let raf = 0;
  let last = performance.now();

  function irisMaterial(color) {
    let mat = irisMats.get(color);
    if (!mat) {
      mat = new MeshBasicMaterial({ color });
      irisMats.set(color, mat);
    }
    return mat;
  }

  function flatMesh(geo, mat, scale, position, order) {
    const mesh = new Mesh(geo, mat);
    mesh.scale.set(scale[0], scale[1], scale[2]);
    mesh.position.set(position[0], position[1], position[2]);
    mesh.castShadow = false;
    mesh.renderOrder = order;
    return mesh;
  }

  function buildCartoonEyes(animal, anchor, tune = {}) {
    const layout = EYE_LAYOUT[animal] || { spread: 0.19, s: 1, iris: 0x8d5a32 };
    const y = anchor ? anchor.position.y : 0.5;
    const z = (anchor ? anchor.position.z : 0.56) + 0.06;
    const s = Number(tune.eyeScale) || layout.s;
    const spread = Number(tune.eyeSpread) || layout.spread;
    const w = 0.112 * s;
    const h = 0.142 * s;
    const d = 0.108 * s;
    const iris = irisMaterial(layout.iris);
    const rig = new Group();
    const sockets = [];
    const happyArc = Math.PI * 0.72;
    const sleepArc = Math.PI * 0.55;
    for (const side of [-1, 1]) {
      const socket = new Group();
      socket.position.set(side * spread, y, z);
      const open = new Group();
      open.add(flatMesh(eyeGeo, scleraMat, [w, h, d], [0, 0, 0], 2));
      open.add(flatMesh(eyeGeo, iris, [w * 0.88, h * 0.84, d * 0.07], [0, 0, d * 0.98], 4));
      const pupilR = Math.min(w, h) * 0.34;
      open.add(flatMesh(eyeGeo, pupilMat, [pupilR, pupilR, d * 0.045], [0, 0, d * 1.08], 5));
      open.add(flatMesh(eyeGeo, catchMat, [0.02 * s, 0.024 * s, d * 0.03], [side * w * 0.28, h * 0.24, d * 1.14], 6));
      open.add(flatMesh(eyeGeo, catchMat, [0.009 * s, 0.01 * s, d * 0.025], [side * w * 0.04, -h * 0.18, d * 1.16], 6));
      const lidArc = Math.PI * 0.3;
      const lid = new Mesh(new TorusGeometry(1, 0.02, 4, 12, lidArc), lidMat);
      lid.rotation.z = Math.PI / 2 - lidArc / 2;
      lid.scale.set(w * 0.96, h * 0.7, 1);
      lid.position.set(0, h * 0.62, d * 1.02);
      lid.renderOrder = 7;
      open.add(lid);
      const happy = new Mesh(new TorusGeometry(w * 0.92, h * 0.055, 6, 14, happyArc), lidMat);
      happy.rotation.z = Math.PI / 2 - happyArc / 2;
      happy.position.set(0, -h * 0.05, d * 0.55);
      happy.visible = false;
      happy.renderOrder = 4;
      const sleepy = new Mesh(new TorusGeometry(w * 0.88, h * 0.045, 6, 12, sleepArc), lidMat);
      sleepy.rotation.z = -Math.PI / 2 - sleepArc / 2;
      sleepy.position.set(0, h * 0.08, d * 0.55);
      sleepy.visible = false;
      sleepy.renderOrder = 4;
      socket.add(open, happy, sleepy);
      rig.add(socket);
      sockets.push({ open, happy, sleepy });
    }
    return { rig, sockets, layout };
  }

  function smileArc(radius, tube, arc) {
    const mesh = new Mesh(new TorusGeometry(radius, tube, 5, 14, arc), mouthMat);
    mesh.rotation.z = -Math.PI / 2 - arc / 2;
    mesh.renderOrder = 4;
    return mesh;
  }

  function addFeatures(animal, head, anchor, mouthNode, tune = {}) {
    const spec = SNOUT[animal];
    if (!spec || !head) return { mouth: null, blush: null };
    const eyeY = anchor ? anchor.position.y : 0.5;
    const eyeZ = anchor ? anchor.position.z : 0.56;
    const origin = mouthNode ? mouthNode.position.clone() : new Vector3(0, eyeY - 0.16, eyeZ + 0.02);
    if (spec.muzzle) {
      const mesh = new Mesh(new SphereGeometry(1, 16, 12), vinyl(spec.muzzle, 0.5));
      mesh.scale.set(0.055, 0.032, 0.028);
      mesh.position.set(0, origin.y + 0.02, origin.z - 0.02);
      mesh.castShadow = true;
      head.add(mesh);
    }
    if (spec.nose) {
      const lift = spec.noseLift == null ? 0.1 : spec.noseLift;
      const xs = spec.pair ? [-spec.pair, spec.pair] : [0];
      for (const x of xs) {
        const bead = new Mesh(eyeGeo, new MeshBasicMaterial({ color: spec.nose }));
        bead.scale.set(spec.noseScale[0], spec.noseScale[1], spec.noseScale[2]);
        bead.position.set(x, origin.y + lift, origin.z + 0.08);
        bead.renderOrder = 2;
        head.add(bead);
      }
    }
    if (spec.whisker) {
      const mat = new MeshBasicMaterial({ color: spec.whisker });
      const geo = new CylinderGeometry(0.006, 0.002, 1, 5);
      for (const side of [-1, 1]) {
        for (const row of [{ dy: 0.03, pitch: 0.16 }, { dy: 0, pitch: 0 }, { dy: -0.028, pitch: -0.14 }]) {
          const whisker = new Mesh(geo, mat);
          whisker.scale.y = 0.26;
          whisker.rotation.z = side * Math.PI / 2;
          whisker.rotation.x = row.pitch;
          whisker.position.set(origin.x + side * 0.16, origin.y + row.dy, origin.z + 0.02);
          head.add(whisker);
        }
      }
    }
    const mouth = new Group();
    const kind = spec.mouth || 'smile';
    if (kind === 'w') {
      const arc = Math.PI * 0.8;
      for (const side of [-1, 1]) {
        const part = smileArc(0.032, 0.0036, arc);
        part.position.set(side * 0.03, -0.01, 0);
        mouth.add(part);
      }
    } else {
      const arc = kind === 'closed' ? Math.PI * 0.55 : Math.PI * 0.7;
      mouth.add(smileArc(kind === 'closed' ? 0.034 : 0.042, 0.0038, arc));
      if (kind === 'smile') mouth.add(flatMesh(eyeGeo, tongueMat, [0.012, 0.006, 0.004], [0, 0.004, 0.01], 5));
    }
    mouth.position.set(origin.x, origin.y - 0.02, origin.z + 0.015);
    mouth.userData.base = 1;
    head.add(mouth);
    const blush = new Group();
    const spread = Math.min(Number(tune.eyeSpread) || (EYE_LAYOUT[animal] && EYE_LAYOUT[animal].spread) || 0.19, 0.34);
    for (const side of [-1, 1]) {
      blush.add(flatMesh(eyeGeo, blushMat, [0.052, 0.03, 0.016], [side * spread, eyeY - 0.1, eyeZ + 0.035], 3));
    }
    head.add(blush);
    return { mouth, blush };
  }

  function capture(obj) {
    return { obj, p: obj.position.clone(), r: obj.rotation.clone(), s: obj.scale.clone() };
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
    for (const name of ['eyes_open', 'eyes_happy', 'eyes_sleepy', 'mouth', 'mouth_open', 'cheeks']) {
      if (nodes[name]) nodes[name].visible = false;
    }
    const bases = {};
    for (const name of PARTS) {
      if (nodes[name]) bases[name] = capture(nodes[name]);
    }
    const animal = info.userData.animal;
    const tune = {
      eyeSpread: Number(info.userData.eyeSpread) || 0,
      eyeScale: Number(info.userData.eyeScale) || 0,
    };
    const face = nodes.head ? buildCartoonEyes(animal, nodes.eyes_open, tune) : null;
    if (face && nodes.head) {
      nodes.head.add(face.rig);
      const features = addFeatures(animal, nodes.head, nodes.eyes_open, nodes.mouth || nodes.mouth_open, tune);
      face.mouth = features.mouth;
      face.blush = features.blush;
    }
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

  function modelUrl(name) {
    return new URL(`../models/${name}.glb`, import.meta.url).href;
  }

  function ensure(name) {
    if (cache.has(name)) return Promise.resolve(cache.get(name));
    if (inflight.has(name)) return inflight.get(name);
    const task = loader.loadAsync(modelUrl(name)).then((gltf) => {
      const pet = prepare(gltf);
      cache.set(name, pet);
      inflight.delete(name);
      return pet;
    });
    inflight.set(name, task);
    return task;
  }

  function applyColors(pet) {
    const natural = state.color == null;
    const baseHex = natural ? pet.baseColor : state.color;
    const base = new Color(baseHex);
    const belly = natural
      ? new Color(pet.bellyColor).lerp(new Color(0xfff7f2), 0.25)
      : base.clone().lerp(new Color(0xffffff), 0.78);
    for (const mat of pet.baseMats) mat.color.copy(base);
    for (const mat of pet.bellyMats) mat.color.copy(belly);
  }

  function showEyes(pet, which) {
    if (pet.nodes.eyes_open) pet.nodes.eyes_open.visible = false;
    if (pet.nodes.eyes_happy) pet.nodes.eyes_happy.visible = false;
    if (pet.nodes.eyes_sleepy) pet.nodes.eyes_sleepy.visible = false;
    if (!pet.face) return;
    for (const socket of pet.face.sockets) {
      socket.open.visible = which === 'open';
      socket.happy.visible = which === 'happy';
      socket.sleepy.visible = which === 'sleepy';
    }
  }

  function restore(pet) {
    for (const base of Object.values(pet.bases)) {
      base.obj.position.copy(base.p);
      base.obj.rotation.copy(base.r);
      base.obj.scale.copy(base.s);
    }
  }

  function smooth(t) {
    const x = Math.min(1, Math.max(0, t));
    return x * x * (3 - 2 * x);
  }

  function restingMode() {
    if (state.ambient === 'sleepy' || state.idleFor > 20) return 'sleepy';
    return 'idle';
  }

  function applyPose() {
    if (!current) return;
    const pet = current;
    restore(pet);
    const body = pet.bases.body;
    const head = pet.bases.head;
    const height = state.height;
    const bodySize = state.body;
    if (body) body.obj.scale.set(body.s.x * bodySize, body.s.y * height, body.s.z * bodySize);
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
    if (head) {
      head.obj.scale.set(head.s.x * 1.08, head.s.y * 1.1, head.s.z * 1.06);
      head.obj.position.y += 0.03;
    }
    if (body) {
      body.obj.scale.x *= 1.03;
      body.obj.scale.z *= 1.05;
      body.obj.scale.y *= 0.95;
    }
    for (const name of ['arm_L', 'arm_R', 'foot_L', 'foot_R']) {
      const limb = pet.bases[name];
      if (!limb) continue;
      limb.obj.scale.set(limb.s.x * 0.92, limb.s.y * 0.9, limb.s.z * 0.92);
    }

    let mode = state.mode;
    const t = state.modeT;
    const celebrating = mode === 'celebrate';
    const jumpLike = mode === 'jump' || (celebrating && t < 1.15);
    const spinning = mode === 'spin' || (celebrating && t >= 1.15);
    const bob = Math.sin(state.time * 2.2);
    holder.position.set(0, 0, 0);
    if (pet.face) {
      for (const socket of pet.face.sockets) socket.open.scale.set(1, 1, 1);
      if (pet.face.mouth) pet.face.mouth.scale.setScalar(pet.face.mouth.userData.base || 1);
      if (pet.face.blush) pet.face.blush.visible = state.cheeks;
    }
    if (pet.nodes.cheeks) pet.nodes.cheeks.visible = false;
    hat.visible = state.hat;
    zzz.visible = false;
    if (pet.nodes.mouth) pet.nodes.mouth.visible = false;
    if (pet.nodes.mouth_open) pet.nodes.mouth_open.visible = false;

    let eye = state.eyes === 'happy' ? 'happy' : 'open';
    if (mode === 'sleepy') {
      eye = 'sleepy';
      if (head) {
        head.obj.rotation.x += 0.28;
        head.obj.rotation.z += Math.sin(state.time * 1.05) * 0.06;
      }
      if (body) {
        body.obj.scale.y *= 1 + Math.sin(state.time * 1.15) * 0.025;
        body.obj.position.y += Math.sin(state.time * 1.15) * 0.02;
      }
      zzz.visible = true;
      zzz.position.set(0.55, 0.85 + Math.sin(state.time * 1.6) * 0.04, 0.15);
    } else if (jumpLike) {
      eye = 'happy';
      if (pet.face && pet.face.mouth) pet.face.mouth.scale.setScalar((pet.face.mouth.userData.base || 1) * 1.12);
      const local = celebrating ? t : t;
      const p = Math.min(local / DURATION.jump, 1);
      const lift = Math.sin(p * Math.PI);
      holder.position.y = lift * (celebrating ? 0.42 : 0.32);
      if (pet.bases.arm_L) pet.bases.arm_L.obj.rotation.z = celebrating ? 2.05 : 1.9;
      if (pet.bases.arm_R) pet.bases.arm_R.obj.rotation.z = celebrating ? -2.05 : -1.9;
      if (body) body.obj.scale.y *= 1 + lift * 0.06;
    } else {
      holder.position.y = bob * 0.03;
      if (body) body.obj.scale.y *= 1 + bob * 0.015;
      const phase = state.time % 4.5;
      if (phase > 4.32 && mode !== 'wave') {
        const k = phase < 4.41 ? (phase - 4.32) / 0.09 : (4.5 - phase) / 0.09;
        if (eye === 'open' && pet.face) {
          const squash = 1 - 0.92 * k;
          for (const socket of pet.face.sockets) socket.open.scale.y = squash;
        }
      }
    }

    if (mode === 'wave') {
      eye = 'happy';
      const up = smooth(Math.min(t / 0.16, 1));
      const wiggle = Math.sin(t * 8) * 0.08;
      if (pet.bases.arm_L) {
        pet.bases.arm_L.obj.rotation.z = (1.92 + wiggle) * up;
        pet.bases.arm_L.obj.rotation.x = -0.35 * up;
      }
    }

    if (pet.bases.tail && mode !== 'sleepy') {
      pet.bases.tail.obj.rotation.y += Math.sin(state.time * 2.4) * 0.18;
    }

    if (eye === 'open' && state.eyes === 'sparkly' && pet.face && mode !== 'sleepy') {
      for (const socket of pet.face.sockets) {
        socket.open.scale.x *= 1.1;
        socket.open.scale.y *= 1.1;
        socket.open.scale.z *= 1.1;
      }
    }
    showEyes(pet, eye);

    let spin = 0;
    if (spinning) {
      const local = celebrating ? t - 1.15 : t;
      const p = Math.min(local / DURATION.spin, 1);
      const e = p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) ** 2) / 2;
      spin = e * Math.PI * 2;
      holder.position.y += Math.abs(Math.sin(local * 10)) * 0.04;
      eye = 'happy';
      showEyes(pet, 'happy');
    }
    turntable.rotation.y = -0.38 + spin;
    camera.position.set(lookX, 1.5, 6.55);
    camera.lookAt(lookX, lookY, 0);
  }

  function present(pet) {
    if (current && current !== pet) holder.remove(current.root);
    current = pet;
    if (!pet.root.parent) holder.add(pet.root);
    if (pet.nodes.hat_anchor) pet.nodes.hat_anchor.add(hat);
    if (pet.nodes.head) pet.nodes.head.add(zzz);
    applyColors(pet);
    applyPose();
    resize();
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

  const observer = new ResizeObserver(() => resize());
  observer.observe(canvas.parentElement || canvas);

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!state.active || !current) return;
    state.time += dt;
    if (state.mode === 'idle' || state.mode === 'sleepy') {
      state.idleFor += dt;
      state.mode = restingMode();
      state.modeT = 0;
    } else {
      state.modeT += dt;
      const limit = DURATION[state.mode] || 1.2;
      if (state.modeT >= limit) {
        state.mode = restingMode();
        state.modeT = 0;
        state.idleFor = 0;
      }
    }
    applyPose();
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  let serial = 0;
  function setPet(config) {
    const next = config || {};
    state.color = next.color ? limitLightness(next.color) : null;
    state.eyes = next.eyes || 'round';
    state.cheeks = next.cheeks !== false;
    state.hat = Boolean(next.hat);
    state.height = Math.min(1.4, Math.max(0.75, Number(next.height) || 1));
    state.body = Math.min(1.3, Math.max(0.8, Number(next.body) || 1));
    const animal = next.animal || 'penguin';
    const mine = ++serial;
    state.animal = animal;
    return ensure(animal).then((pet) => {
      if (mine !== serial) return pet;
      present(pet);
      return pet;
    });
  }

  return {
    setPet,
    setAmbient(kind) {
      state.ambient = kind === 'sleepy' ? 'sleepy' : 'idle';
      if (state.mode === 'idle' || state.mode === 'sleepy') state.mode = restingMode();
    },
    react(kind) {
      const name = kind === 'celebrate' || kind === 'jump' || kind === 'wave' ? kind : 'wave';
      state.mode = name;
      state.modeT = 0;
      state.idleFor = 0;
    },
    calm() {
      state.mode = restingMode();
      state.modeT = 0;
    },
    poke() {
      state.idleFor = 0;
      if (state.mode === 'sleepy' && state.ambient !== 'sleepy') state.mode = 'idle';
    },
    setActive(on) {
      state.active = Boolean(on);
      if (state.active) resize();
    },
    resize,
    get mode() { return state.mode; },
    destroy() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      renderer.dispose();
    },
  };
}
