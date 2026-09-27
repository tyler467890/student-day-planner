import {
  Scene, PerspectiveCamera, WebGLRenderer, Group, Mesh,
  SphereGeometry, CapsuleGeometry, ConeGeometry, CylinderGeometry,
  CircleGeometry, TorusGeometry, OctahedronGeometry,
  MeshToonMaterial, MeshStandardMaterial, MeshBasicMaterial,
  HemisphereLight, DirectionalLight,
  DataTexture, NearestFilter, ClampToEdgeWrapping, RGBAFormat, UnsignedByteType,
  CanvasTexture, Sprite, SpriteMaterial,
  SRGBColorSpace, NoColorSpace, NoToneMapping,
  Vector3, Color,
} from 'three';

const SWATCHES = ['#3B5BDB', '#FF8A3D', '#FF8AD4', '#00C2A8', '#FF4D1A', '#7C3AED', '#FFD23F', '#FFFFFF'];
const DEFAULTS = { penguin: '#3B5BDB', cat: '#FF8A3D', bunny: '#FF8AD4' };
const DURATION = { wave: 1.55, jump: 1.18, spin: 1.35, sleepy: 2.8, walk: 2.6 };
const ZOOM_MIN = 2.8;
const ZOOM_MAX = 7.2;

const canvas = document.querySelector('#stage');
const scene = new Scene();
const camera = new PerspectiveCamera(32, 1, 0.1, 40);
let camZ = 4.2;
camera.position.set(0, 1.02, camZ);

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

scene.add(new HemisphereLight(0xfff8f2, 0xc9b6ff, 1.2));
const sun = new DirectionalLight(0xffffff, 1.45);
sun.position.set(2.4, 4.8, 3.2);
scene.add(sun);

const gradient = new DataTexture(
  new Uint8Array([
    90, 90, 90, 255,
    150, 150, 150, 255,
    215, 215, 215, 255,
    255, 255, 255, 255,
  ]),
  4,
  1,
  RGBAFormat,
  UnsignedByteType,
);
gradient.magFilter = NearestFilter;
gradient.minFilter = NearestFilter;
gradient.wrapS = ClampToEdgeWrapping;
gradient.wrapT = ClampToEdgeWrapping;
gradient.colorSpace = NoColorSpace;
gradient.generateMipmaps = false;
gradient.needsUpdate = true;

const floor = new Mesh(
  new CircleGeometry(1.45, 28),
  new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.38, depthWrite: false }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = 0;
scene.add(floor);

const shadow = new Mesh(
  new CircleGeometry(0.62, 24),
  new MeshBasicMaterial({ color: 0x3a2468, transparent: true, opacity: 0.18, depthWrite: false }),
);
shadow.rotation.x = -Math.PI / 2;
shadow.position.y = 0.015;
scene.add(shadow);

const turntable = new Group();
scene.add(turntable);

const state = {
  animal: 'penguin',
  color: null,
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

let userYaw = 0;
const animals = {};
let current = null;

const v3a = new Vector3();
const v3b = new Vector3();

function toon(color) {
  return new MeshToonMaterial({ color, gradientMap: gradient });
}

function shiny(color, roughness = 0.22) {
  return new MeshStandardMaterial({ color, roughness, metalness: 0.05 });
}

function mesh(geo, mat) {
  return new Mesh(geo, mat);
}

function scaffold(kind) {
  const root = new Group();
  const fit = new Group();
  const body = new Group();
  const head = new Group();
  const hand = new Group();
  const hatMount = new Group();
  root.add(fit);
  fit.add(body);
  body.add(head);
  head.add(hatMount);
  return {
    kind,
    root,
    fit,
    body,
    head,
    hand,
    hatMount,
    anchors: { head: hatMount, hand },
    colourMats: [],
    bases: [],
    feet: [],
    eyes: null,
    eyeSets: {},
    cheeks: null,
    tail: null,
    ears: null,
  };
}

function remember(animal, obj) {
  animal.bases.push({
    obj,
    p: obj.position.clone(),
    r: obj.rotation.clone(),
    s: obj.scale.clone(),
  });
}

function restore(animal) {
  for (const b of animal.bases) {
    b.obj.position.copy(b.p);
    b.obj.rotation.copy(b.r);
    b.obj.scale.copy(b.s);
  }
}

const eyeWhite = shiny(0xffffff, 0.16);
const pupilMat = shiny(0x1c1233, 0.3);
const glintMat = new MeshBasicMaterial({ color: 0xffffff });
const sparkMat = shiny(0xfff4a8, 0.12);
const cheekMat = toon(0xff8eb8);

function addEyes(animal, spread, y, z, scale = 1) {
  const root = new Group();
  root.position.set(0, y, z);
  root.scale.setScalar(scale);
  animal.head.add(root);
  animal.eyes = root;

  function pair(build) {
    const g = new Group();
    for (const side of [-1, 1]) {
      const pivot = new Group();
      pivot.position.x = side * spread;
      build(pivot, side);
      g.add(pivot);
    }
    root.add(g);
    return g;
  }

  animal.eyeSets.round = pair((pivot) => {
    const white = mesh(new SphereGeometry(0.095, 12, 10), eyeWhite);
    const pupil = mesh(new SphereGeometry(0.048, 10, 8), pupilMat);
    pupil.position.z = 0.055;
    const glint = mesh(new SphereGeometry(0.02, 8, 6), glintMat);
    glint.position.set(0.025, 0.03, 0.085);
    pivot.add(white, pupil, glint);
  });

  animal.eyeSets.happy = pair((pivot) => {
    const arc = mesh(new TorusGeometry(0.075, 0.02, 6, 14, Math.PI), pupilMat);
    arc.position.z = 0.04;
    pivot.add(arc);
  });

  animal.eyeSets.sparkly = pair((pivot) => {
    const star = mesh(new OctahedronGeometry(0.09, 0), sparkMat);
    const glint = mesh(new SphereGeometry(0.028, 8, 6), glintMat);
    glint.position.set(0.03, 0.035, 0.06);
    pivot.add(star, glint);
  });
}

function addCheeks(animal, spread, y, z) {
  const g = new Group();
  for (const side of [-1, 1]) {
    const c = mesh(new SphereGeometry(0.055, 10, 8), cheekMat);
    c.scale.z = 0.42;
    c.position.set(side * spread, y, z);
    g.add(c);
  }
  animal.head.add(g);
  animal.cheeks = g;
}

function buildPenguin() {
  const a = scaffold('penguin');
  const navy = toon(0x3b5bdb);
  const white = toon(0xfff7fb);
  const orange = toon(0xff8a1e);
  a.colourMats.push(navy);

  const torso = mesh(new SphereGeometry(0.46, 14, 12), navy);
  torso.scale.set(0.9, 1.08, 0.8);
  torso.position.y = 0.58;
  a.body.add(torso);

  const belly = mesh(new SphereGeometry(0.3, 14, 10), white);
  belly.scale.set(0.72, 1.05, 0.42);
  belly.position.set(0, 0.52, 0.24);
  a.body.add(belly);

  a.head.position.set(0, 1.12, 0.02);
  const skull = mesh(new SphereGeometry(0.4, 14, 12), navy);
  a.head.add(skull);
  const face = mesh(new SphereGeometry(0.26, 12, 10), white);
  face.scale.set(0.95, 0.78, 0.48);
  face.position.set(0, -0.02, 0.24);
  a.head.add(face);

  const beak = mesh(new ConeGeometry(0.085, 0.22, 10), orange);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, -0.05, 0.42);
  a.head.add(beak);

  addEyes(a, 0.14, 0.06, 0.34, 1.05);
  addCheeks(a, 0.2, -0.08, 0.36);

  const flipGeo = new CapsuleGeometry(0.075, 0.3, 3, 6);
  a.hand.position.set(0.4, 0.72, 0);
  a.hand.rotation.z = 0.28;
  const flip = mesh(flipGeo, navy);
  flip.position.y = -0.22;
  a.hand.add(flip);
  a.body.add(a.hand);

  const other = new Group();
  other.position.set(-0.4, 0.72, 0);
  other.rotation.z = -0.28;
  const flipL = mesh(flipGeo, navy);
  flipL.position.y = -0.22;
  other.add(flipL);
  a.body.add(other);

  const footGeo = new SphereGeometry(0.11, 10, 8);
  for (const side of [1, -1]) {
    const foot = mesh(footGeo, orange);
    foot.scale.set(1.55, 0.42, 1.85);
    foot.position.set(side * 0.16, 0.05, 0.1);
    a.body.add(foot);
    a.feet.push(foot);
  }

  a.hatMount.position.set(0, 0.36, 0.02);
  remember(a, a.body);
  remember(a, a.head);
  remember(a, a.hand);
  remember(a, other);
  remember(a, a.eyes);
  for (const foot of a.feet) remember(a, foot);
  return a;
}

function buildCat() {
  const a = scaffold('cat');
  const fur = toon(0xff8a3d);
  const white = toon(0xfff7fb);
  const pink = toon(0xff6b9a);
  a.colourMats.push(fur);

  const torso = mesh(new SphereGeometry(0.4, 14, 12), fur);
  torso.scale.set(1.05, 0.9, 0.95);
  torso.position.y = 0.48;
  a.body.add(torso);
  const chest = mesh(new SphereGeometry(0.18, 12, 8), white);
  chest.position.set(0, 0.42, 0.24);
  a.body.add(chest);

  a.head.position.set(0, 1.02, 0.05);
  const skull = mesh(new SphereGeometry(0.36, 14, 12), fur);
  a.head.add(skull);

  const ears = new Group();
  for (const side of [-1, 1]) {
    const ear = mesh(new ConeGeometry(0.12, 0.26, 8), fur);
    ear.position.set(side * 0.2, 0.3, 0);
    ear.rotation.z = side * -0.25;
    const inner = mesh(new ConeGeometry(0.06, 0.14, 8), pink);
    inner.position.set(side * 0.2, 0.28, 0.045);
    inner.rotation.z = side * -0.25;
    ears.add(ear, inner);
  }
  a.head.add(ears);
  a.ears = ears;

  const muzzle = mesh(new SphereGeometry(0.11, 10, 8), white);
  muzzle.scale.set(1.35, 0.75, 0.65);
  muzzle.position.set(0, -0.08, 0.28);
  a.head.add(muzzle);
  const nose = mesh(new SphereGeometry(0.04, 8, 6), pink);
  nose.position.set(0, -0.02, 0.38);
  a.head.add(nose);

  addEyes(a, 0.13, 0.06, 0.32, 1);
  addCheeks(a, 0.18, -0.08, 0.34);

  const legGeo = new CapsuleGeometry(0.065, 0.14, 3, 6);
  for (const [x, y, z] of [[0.15, 0.16, 0.12], [-0.15, 0.16, 0.12], [0.16, 0.18, -0.14], [-0.16, 0.18, -0.14]]) {
    const leg = mesh(legGeo, fur);
    leg.position.set(x, y, z);
    a.body.add(leg);
    a.feet.push(leg);
  }

  a.hand.position.set(0.32, 0.52, 0.16);
  a.hand.rotation.z = 0.35;
  const paw = mesh(new CapsuleGeometry(0.055, 0.16, 3, 6), fur);
  paw.position.y = -0.14;
  a.hand.add(paw);
  a.body.add(a.hand);

  const tail = new Group();
  tail.position.set(0.02, 0.5, -0.32);
  tail.rotation.x = 1.05;
  tail.rotation.z = 0.55;
  const tailMesh = mesh(new CapsuleGeometry(0.05, 0.38, 3, 6), fur);
  tailMesh.position.y = 0.22;
  tail.add(tailMesh);
  a.body.add(tail);
  a.tail = tail;

  a.hatMount.position.set(0, 0.34, 0);
  remember(a, a.body);
  remember(a, a.head);
  remember(a, a.hand);
  remember(a, a.eyes);
  remember(a, ears);
  remember(a, tail);
  for (const foot of a.feet) remember(a, foot);
  return a;
}

function buildBunny() {
  const a = scaffold('bunny');
  const fur = toon(0xff8ad4);
  const white = toon(0xfff7fb);
  const pink = toon(0xff6b9a);
  a.colourMats.push(fur);

  const torso = mesh(new SphereGeometry(0.4, 14, 12), fur);
  torso.scale.set(0.95, 0.92, 0.9);
  torso.position.y = 0.5;
  a.body.add(torso);

  const tail = mesh(new SphereGeometry(0.1, 10, 8), white);
  tail.position.set(0, 0.48, -0.34);
  a.body.add(tail);

  a.head.position.set(0, 1.02, 0.06);
  const skull = mesh(new SphereGeometry(0.36, 14, 12), fur);
  a.head.add(skull);

  const ears = new Group();
  for (const side of [-1, 1]) {
    const ear = mesh(new CapsuleGeometry(0.07, 0.42, 3, 6), fur);
    ear.position.set(side * 0.14, 0.52, 0);
    ear.rotation.z = side * -0.08;
    const inner = mesh(new CapsuleGeometry(0.035, 0.28, 2, 6), pink);
    inner.position.set(side * 0.14, 0.5, 0.04);
    inner.rotation.z = side * -0.08;
    ears.add(ear, inner);
  }
  a.head.add(ears);
  a.ears = ears;

  const muzzle = mesh(new SphereGeometry(0.1, 10, 8), white);
  muzzle.scale.set(1.2, 0.7, 0.6);
  muzzle.position.set(0, -0.1, 0.28);
  a.head.add(muzzle);
  const nose = mesh(new SphereGeometry(0.035, 8, 6), pink);
  nose.scale.set(1.2, 0.8, 0.8);
  nose.position.set(0, -0.04, 0.36);
  a.head.add(nose);

  addEyes(a, 0.13, 0.04, 0.32, 1.05);
  addCheeks(a, 0.18, -0.08, 0.34);

  const footGeo = new SphereGeometry(0.1, 10, 8);
  for (const side of [1, -1]) {
    const foot = mesh(footGeo, fur);
    foot.scale.set(1.15, 0.55, 1.7);
    foot.position.set(side * 0.14, 0.07, 0.12);
    a.body.add(foot);
    a.feet.push(foot);
  }

  a.hand.position.set(0.3, 0.5, 0.18);
  a.hand.rotation.z = 0.3;
  const paw = mesh(new SphereGeometry(0.08, 10, 8), fur);
  paw.scale.set(0.9, 1.15, 0.8);
  paw.position.y = -0.12;
  a.hand.add(paw);
  a.body.add(a.hand);

  a.hatMount.position.set(0, 0.32, 0.02);
  remember(a, a.body);
  remember(a, a.head);
  remember(a, a.hand);
  remember(a, a.eyes);
  remember(a, ears);
  for (const foot of a.feet) remember(a, foot);
  return a;
}

const hat = new Group();
const hatCone = mesh(new ConeGeometry(0.16, 0.32, 12), toon(0xff4d8d));
hatCone.position.y = 0.18;
const hatBrim = mesh(new CylinderGeometry(0.18, 0.2, 0.045, 12), toon(0xffd23f));
hatBrim.position.y = 0.02;
const pom = mesh(new SphereGeometry(0.055, 10, 8), toon(0xfff3a0));
pom.position.y = 0.36;
hat.add(hatCone, hatBrim, pom);
hat.visible = false;

const zzzCanvas = document.createElement('canvas');
zzzCanvas.width = 128;
zzzCanvas.height = 64;
const zctx = zzzCanvas.getContext('2d');
zctx.clearRect(0, 0, 128, 64);
zctx.fillStyle = '#6D4AFF';
zctx.font = '700 42px sans-serif';
zctx.textAlign = 'center';
zctx.textBaseline = 'middle';
zctx.fillText('Zzz', 64, 34);
const zzzTex = new CanvasTexture(zzzCanvas);
zzzTex.colorSpace = SRGBColorSpace;
const zzz = new Sprite(new SpriteMaterial({ map: zzzTex, transparent: true, depthWrite: false }));
zzz.scale.set(0.5, 0.25, 1);
zzz.visible = false;

function activeColor() {
  return state.color || DEFAULTS[state.animal];
}

function applyColour() {
  const color = new Color(activeColor());
  for (const mat of current.colourMats) mat.color.copy(color);
}

function applyFace() {
  for (const [name, group] of Object.entries(current.eyeSets)) {
    group.visible = name === state.eyes;
  }
  if (current.cheeks) current.cheeks.visible = state.cheeks;
  hat.visible = state.hat;
}

function showAnimal(name) {
  if (current) turntable.remove(current.root);
  current = animals[name];
  state.animal = name;
  turntable.add(current.root);
  current.hatMount.add(hat);
  current.head.add(zzz);
  applyColour();
  applyFace();
  syncControls();
}

function smooth(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function applyPose() {
  const animal = current;
  restore(animal);
  animal.fit.scale.set(state.body, state.body * state.height, state.body);
  animal.root.position.x = 0;

  const mode = state.mode;
  const t = state.modeT;
  const bob = Math.sin(state.time * 2.3);

  if (mode === 'sleepy') {
    animal.eyes.scale.y *= 0.14;
    animal.body.rotation.z += Math.sin(state.time * 1.15) * 0.08;
    animal.body.position.y += Math.sin(state.time * 1.15) * 0.03;
    zzz.visible = true;
    zzz.position.set(0.28, 0.58 + Math.sin(state.time * 2.4) * 0.05, 0.15);
  } else {
    zzz.visible = false;
    if (mode === 'idle' || mode === 'walk' || mode === 'wave' || mode === 'spin') {
      animal.body.position.y += bob * 0.035;
      const breathe = 1 + bob * 0.018;
      animal.body.scale.y *= breathe;
      animal.body.scale.x /= breathe;
    }
    const phase = state.time % 3.6;
    if (!state.paused && phase > 3.42) {
      const k = phase < 3.51 ? (phase - 3.42) / 0.09 : (3.6 - phase) / 0.09;
      animal.eyes.scale.y *= 1 - 0.88 * k;
    }
  }

  if (mode === 'walk') {
    const cycle = t * (animal.kind === 'penguin' ? 8 : 7);
    animal.root.position.x = Math.sin(t * 1.35) * 0.6;
    if (animal.kind === 'penguin') {
      animal.body.rotation.z += Math.sin(cycle) * 0.16;
      animal.body.position.y += Math.abs(Math.sin(cycle)) * 0.035;
    } else {
      const hop = Math.abs(Math.sin(cycle));
      animal.body.position.y += hop * 0.16;
      animal.body.rotation.x += (hop - 0.5) * -0.1;
    }
    animal.feet.forEach((foot, i) => {
      foot.rotation.x += Math.sin(cycle + i * Math.PI) * 0.45;
    });
    if (animal.tail) animal.tail.rotation.z += Math.sin(cycle) * 0.35;
  } else if (animal.tail && mode !== 'sleepy') {
    animal.tail.rotation.z += Math.sin(state.time * 3) * 0.25;
  }

  if (mode === 'wave') {
    const up = smooth(t / 0.16);
    animal.hand.rotation.z += 1.9 * up;
    animal.hand.rotation.x += Math.sin(t * 14) * 0.55 * up;
  }

  let lift = 0;
  if (mode === 'jump') {
    const p = Math.min(t / DURATION.jump, 1);
    lift = Math.sin(p * Math.PI);
    animal.body.position.y += lift * 0.55;
    animal.body.scale.y *= 1 + lift * 0.08;
    animal.body.scale.x *= 1 - lift * 0.05;
    animal.head.rotation.z += Math.sin(p * Math.PI * 2) * 0.1;
    if (animal.ears) animal.ears.rotation.x += lift * 0.35;
  }

  let spin = 0;
  if (mode === 'spin') {
    const p = Math.min(t / DURATION.spin, 1);
    const e = p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) ** 2) / 2;
    spin = e * Math.PI * 2;
    animal.body.position.y += Math.abs(Math.sin(t * 12)) * 0.05;
  }

  turntable.rotation.y = userYaw + spin;
  camera.position.set(0, 1.02, camZ);
  camera.lookAt(0, 0.84, 0);

  turntable.updateWorldMatrix(true, true);
  animal.root.getWorldPosition(v3a);
  shadow.position.x = v3a.x;
  shadow.position.z = v3a.z;
  shadow.scale.setScalar(Math.max(0.35, state.body * (1 - lift * 0.45)));
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
  if (pointers.size === 1) {
    userYaw += (event.clientX - prev.x) * 0.012;
  } else if (pointers.size >= 2 && lastPinch) {
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

function syncControls() {
  document.querySelectorAll('[data-animal]').forEach((button) => {
    button.setAttribute('aria-pressed', button.dataset.animal === state.animal ? 'true' : 'false');
  });
  document.querySelectorAll('[data-eyes]').forEach((button) => {
    button.setAttribute('aria-pressed', button.dataset.eyes === state.eyes ? 'true' : 'false');
  });
  document.querySelector('#pet-cheeks').setAttribute('aria-pressed', state.cheeks ? 'true' : 'false');
  document.querySelector('#pet-hat').setAttribute('aria-pressed', state.hat ? 'true' : 'false');
  const colour = activeColor();
  const picker = document.querySelector('#pet-colour');
  picker.value = colour;
  document.querySelectorAll('.swatch').forEach((button) => {
    button.setAttribute('aria-pressed', button.dataset.colour.toLowerCase() === colour.toLowerCase() ? 'true' : 'false');
  });
  document.querySelector('#pet-height').value = String(state.height);
  document.querySelector('#pet-body').value = String(state.body);
}

function setAnimal(name) {
  if (!animals[name]) return;
  showAnimal(name);
}

function setColor(hex) {
  state.color = hex;
  applyColour();
  syncControls();
}

function setHeight(n) {
  state.height = clamp(Number(n), 0.75, 1.4);
  syncControls();
}

function setBody(n) {
  state.body = clamp(Number(n), 0.8, 1.3);
  syncControls();
}

function setEyes(style) {
  if (!current.eyeSets[style]) return;
  state.eyes = style;
  applyFace();
  syncControls();
}

function setCheeks(on) {
  state.cheeks = Boolean(on);
  applyFace();
  syncControls();
}

function setHat(on) {
  state.hat = Boolean(on);
  applyFace();
  syncControls();
}

function play(name) {
  state.paused = false;
  if (name === 'idle' || !DURATION[name]) {
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

function hatOffset() {
  applyPose();
  pom.updateWorldMatrix(true, true);
  current.hatMount.getWorldPosition(v3a);
  pom.getWorldPosition(v3b);
  return current.hatMount.worldToLocal(v3b).length();
}

function pixelScore() {
  applyPose();
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  const buf = new Uint8Array(4);
  let hits = 0;
  for (let y = 0.25; y <= 0.8; y += 0.07) {
    for (let x = 0.28; x <= 0.72; x += 0.07) {
      gl.readPixels(Math.floor(x * (w - 1)), Math.floor(y * (h - 1)), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      if (buf[0] + buf[1] + buf[2] > 40) hits += 1;
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

const swatchBox = document.querySelector('#swatches');
for (const colour of SWATCHES) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'swatch';
  button.style.background = colour;
  button.dataset.colour = colour;
  button.setAttribute('aria-label', `Colour ${colour}`);
  button.addEventListener('click', () => setColor(colour));
  swatchBox.append(button);
}

document.querySelectorAll('[data-animal]').forEach((button) => {
  button.addEventListener('click', () => setAnimal(button.dataset.animal));
});
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

animals.penguin = buildPenguin();
animals.cat = buildCat();
animals.bunny = buildBunny();
showAnimal('penguin');
resize();
requestAnimationFrame(frame);

window.__PETS = {
  setAnimal,
  setColor,
  setHeight,
  setBody,
  setEyes,
  setCheeks,
  setHat,
  play,
  pause,
  resume,
  fps,
  pixelScore,
  hatOffset,
  get animal() { return state.animal; },
  get mode() { return state.mode; },
  get hatVisible() { return state.hat; },
  get cheeks() { return state.cheeks; },
  get eyes() { return state.eyes; },
  get height() { return state.height; },
  get body() { return state.body; },
  get color() { return activeColor(); },
  get yaw() { return userYaw; },
  set yaw(value) {
    userYaw = Number(value);
    applyPose();
    renderer.render(scene, camera);
  },
  get zoom() { return camZ; },
  get timeScale() { return state.timeScale; },
  set timeScale(value) { state.timeScale = Number(value); },
  anchors() {
    return { head: current.anchors.head, hand: current.anchors.hand };
  },
};
