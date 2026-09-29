/**
 * Embedded 3D pet for the Today screen.
 * Kenney Cube Pets live under /models. /pets-preview/ stays a separate page.
 */

import {
  Scene, PerspectiveCamera, WebGLRenderer, Group, Mesh,
  SphereGeometry, ConeGeometry, CylinderGeometry, PlaneGeometry,
  MeshPhysicalMaterial, ShadowMaterial, Sprite, SpriteMaterial, CanvasTexture,
  HemisphereLight, DirectionalLight,
  SRGBColorSpace, NoToneMapping, PCFSoftShadowMap,
} from 'three';
import { GLTFLoader } from '../vendor/examples/jsm/loaders/GLTFLoader.js';
import { prepareCube, poseClip, tintMaterials, limitLightness, NATURAL, applyFlourish, restoreBinds } from './cube-pet.js';

const DURATION = {
  wave: 1.55,
  jump: 1.35,
  spin: 1.35,
  celebrate: 2.2,
  sleepy: 2.8,
  dance: 1.7,
  wiggle: 1.5,
  confetti: 1.6,
  stars: 1.35,
  cheer: 1.45,
  signature: 1.75,
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

export function createPetStage(canvas) {
  const scene = new Scene();
  const camera = new PerspectiveCamera(32, 1, 0.1, 40);
  const lookX = 0.08;
  const lookY = 0.86;
  const camY = 1.08;
  const camZ = 4.7;
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
    poseToken: 0,
    frozen: false,
  };

  let current = null;
  const cache = new Map();
  const inflight = new Map();
  const loader = new GLTFLoader();

  function modelUrl(name) {
    return new URL(`../models/${name}.glb`, import.meta.url).href;
  }

  function ensure(name) {
    if (cache.has(name)) return Promise.resolve(cache.get(name));
    if (inflight.has(name)) return inflight.get(name);
    const task = loader.loadAsync(modelUrl(name)).then((gltf) => {
      const pet = prepareCube(gltf, name);
      cache.set(name, pet);
      inflight.delete(name);
      return pet;
    });
    inflight.set(name, task);
    return task;
  }

  function applyColors(pet) {
    tintMaterials(pet.materials, state.color || NATURAL);
  }

  function restingMode() {
    if (state.ambient === 'sleepy' || state.idleFor > 20) return 'sleepy';
    return 'idle';
  }

  function applyPose(dt) {
    if (!current) return;
    const pet = current;
    pet.root.scale.set(state.body, state.height, state.body);
    restoreBinds(pet);
    poseClip(pet, state.mode, dt, null, state.poseToken);
    if (pet.blush) pet.blush.visible = state.cheeks;
    hat.visible = state.hat;
    const mode = state.mode;
    const t = state.modeT;
    zzz.visible = mode === 'sleepy';
    if (mode === 'sleepy') {
      zzz.position.set(0.42, pet.hatAnchor.position.y + 0.12, 0.12);
      zzz.position.y += Math.sin(state.time * 1.6) * 0.04;
    }
    const fx = applyFlourish(pet, mode, t);
    holder.position.set(fx.x, fx.y, fx.z);
    holder.rotation.set(fx.rx, 0, fx.rz);
    turntable.rotation.y = -0.38 + fx.spin;
    camera.position.set(lookX, camY, camZ);
    camera.lookAt(lookX, lookY, 0);
  }

  function present(pet) {
    if (current && current !== pet) holder.remove(current.root);
    current = pet;
    if (!pet.root.parent) holder.add(pet.root);
    pet.hatAnchor.add(hat);
    if (pet.body) pet.body.add(zzz);
    applyColors(pet);
    applyPose(0);
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

  let raf = 0;
  let last = performance.now();
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!state.active || !current) return;
    if (state.frozen) {
      applyPose(0);
      renderer.render(scene, camera);
      return;
    }
    state.time += dt;
    if (state.mode === 'idle' || state.mode === 'sleepy') {
      state.idleFor += dt;
      const next = restingMode();
      if (next !== state.mode) state.poseToken += 1;
      state.mode = next;
      state.modeT = 0;
    } else {
      state.modeT += dt;
      const limit = DURATION[state.mode] || 1.2;
      if (state.modeT >= limit) {
        state.mode = restingMode();
        state.modeT = 0;
        state.idleFor = 0;
        state.poseToken += 1;
      }
    }
    applyPose(dt);
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
      if (state.mode === 'idle' || state.mode === 'sleepy') {
        const next = restingMode();
        if (next !== state.mode) state.poseToken += 1;
        state.mode = next;
      }
    },
    react(kind) {
      const known = DURATION[kind] ? kind : 'wave';
      state.mode = known;
      state.modeT = 0;
      state.idleFor = 0;
      state.poseToken += 1;
      state.frozen = false;
    },
    poseAt(mode, t) {
      const known = DURATION[mode] ? mode : 'wave';
      if (state.mode !== known) state.poseToken += 1;
      state.mode = known;
      state.modeT = t;
      state.active = true;
      state.frozen = true;
      applyPose(0);
      renderer.render(scene, camera);
    },
    calm() {
      state.mode = restingMode();
      state.modeT = 0;
      state.poseToken += 1;
    },
    poke() {
      state.idleFor = 0;
      if (state.mode === 'sleepy' && state.ambient !== 'sleepy') {
        state.mode = 'idle';
        state.poseToken += 1;
      }
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
