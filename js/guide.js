/**
 * The guide bunny: a small transparent three.js canvas that hops over the
 * app, a speech card with typewriter text, the first-run walkthrough, and
 * short pop-ins on return visits. Name and app name come from config.js.
 */

import {
  Scene, PerspectiveCamera, WebGLRenderer, Group, HemisphereLight, DirectionalLight,
  SRGBColorSpace, NoToneMapping,
} from 'three';
import { GLTFLoader } from '../vendor/examples/jsm/loaders/GLTFLoader.js';
import { prepareCube, poseClip } from './cube-pet.js';
import {
  buildTour, finishTour, loadGuideState, needsTour, pickVisitLine, recordOpen,
  replayTour, saveGuideState, fillCopy,
} from './guide-logic.js';

const TYPE_MS = 26;
const HOP_MS = 430;
const VISIT_MS = 5600;

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function wait(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/* ---------- 3D bunny in its own small canvas ---------- */

function createBunnyActor(canvas, animal) {
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.1, 40);
  scene.add(new HemisphereLight(0xfff9ff, 0xe6def4, 1.15));
  const key = new DirectionalLight(0xfff6ef, 2.2);
  key.position.set(-2.4, 4.6, 3.4);
  scene.add(key);
  const fill = new DirectionalLight(0xf4f1ff, 1.0);
  fill.position.set(3, 2.2, 2.6);
  scene.add(fill);
  const squash = new Group();
  const turn = new Group();
  squash.add(turn);
  scene.add(squash);

  const st = {
    pet: null, mode: 'idle', token: 0, face: 0, faceGoal: 0,
    sx: 1, sy: 1, lift: 0, talk: false, t: 0, running: false, last: 0,
  };
  const ready = new GLTFLoader().loadAsync(new URL(`../models/${animal}.glb`, import.meta.url).href)
    .then((gltf) => {
      st.pet = prepareCube(gltf, animal);
      turn.add(st.pet.root);
      return true;
    });

  function frame() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Bunny is ~1.83 tall with ears. Leave room for stretch and the bob.
    // Feet sit near the bottom edge so he can stand on the speech card.
    camera.position.set(0.25, 1.2, 5.1);
    camera.lookAt(0, 1.15, 0);
    camera.updateProjectionMatrix();
  }

  function draw(now) {
    if (!st.running) return;
    const dt = st.last ? Math.min(0.05, (now - st.last) / 1000) : 0;
    st.last = now;
    st.t += dt;
    st.face += (st.faceGoal - st.face) * Math.min(1, dt * 10);
    turn.rotation.y = st.face;
    const talkBob = st.talk ? Math.abs(Math.sin(st.t * 11)) * 0.07 : 0;
    const talkTilt = st.talk ? Math.sin(st.t * 5.5) * 0.06 : 0;
    squash.scale.set(st.sx, st.sy * (1 + talkBob * 0.4), st.sx);
    squash.position.y = st.lift + talkBob;
    squash.rotation.z = talkTilt;
    if (st.pet) poseClip(st.pet, st.mode, dt, null, st.token);
    renderer.render(scene, camera);
    requestAnimationFrame(draw);
  }

  return {
    ready,
    start() {
      if (st.running) return;
      st.running = true;
      st.last = 0;
      frame();
      requestAnimationFrame(draw);
    },
    stop() { st.running = false; },
    resize: frame,
    pose(mode) { if (mode !== st.mode) { st.mode = mode; st.token += 1; } },
    face(angle) { st.faceGoal = angle; },
    shape(sx, sy, lift = 0) { st.sx = sx; st.sy = sy; st.lift = lift; },
    talk(on) { st.talk = on; },
    dispose() {
      st.running = false;
      renderer.dispose();
      try { renderer.forceContextLoss(); } catch { /* ignore */ }
    },
  };
}

/* ---------- soft hop blip (WebAudio, no files) ---------- */

let audioCtx = null;
function blip(freq = 520) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, audioCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(freq * 1.6, audioCtx.currentTime + 0.09);
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.035, audioCtx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.14);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.16);
  } catch { /* no audio */ }
}

/* ---------- the guide ---------- */

/**
 * opts: names {guide, app}, animal, storage, reducedMotion(), soundOn(),
 * context() -> {hour, streak, left, allDone}, actions {openPet, addGoal, describeWeek},
 * enabled (false skips everything, used under test automation).
 */
export function createGuide(opts) {
  const names = opts.names;
  const storage = opts.storage;
  let state = loadGuideState(storage);
  let root = null;
  let actor = null;
  let actorEl = null;
  let card = null;
  let spot = null;
  let block = null;
  let bunny = null;
  let pos = { x: -200, y: 0 };
  let size = 132;
  let busy = null; // 'greet' | 'tour' | 'visit' | 'handoff'
  let pendingTour = false;
  let visitShown = false;
  let petTipShown = false;
  let typing = null;
  let layoutFn = null;
  let runId = 0;

  const reduced = () => Boolean(opts.reducedMotion?.());
  const save = () => saveGuideState(storage, state);

  function ensureRoot(mode) {
    if (!root) {
      root = el('div', 'guide');
      root.id = 'guide';
      block = el('div', 'guide-block');
      spot = el('div', 'guide-spot');
      actorEl = el('div', 'guide-actor');
      actorEl.setAttribute('aria-hidden', 'true');
      const canvas = el('canvas', 'guide-canvas');
      actorEl.append(canvas);
      card = el('div', 'guide-card');
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-label', names.guide);
      root.append(block, spot, actorEl, card);
      document.body.append(root);
      size = window.innerWidth >= 700 ? 150 : 124;
      actorEl.style.width = `${size}px`;
      actorEl.style.height = `${size}px`;
      bunny = createBunnyActor(canvas, opts.animal || 'bunny');
      if (bunny) {
        bunny.start();
        bunny.ready.catch(() => actorEl.classList.add('is-fallback'));
      } else {
        actorEl.classList.add('is-fallback');
      }
      actorEl.append(el('span', 'guide-emoji', '🐰'));
      window.addEventListener('resize', onResize);
    }
    root.dataset.mode = mode;
    return root;
  }

  function onResize() {
    bunny?.resize();
    layoutFn?.(true);
  }

  function teardown() {
    runId += 1;
    stopTyping();
    layoutFn = null;
    window.removeEventListener('resize', onResize);
    bunny?.dispose();
    bunny = null;
    root?.remove();
    root = null;
    busy = null;
    document.body.classList.remove('guide-touring');
  }

  function placeActor(x, y) {
    pos = { x, y };
    actorEl.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  }

  /** Hop (or fade, with reduced motion) to x,y. */
  async function hopTo(x, y, { maxHop = 130 } = {}) {
    const id = runId;
    if (!actorEl) return;
    if (reduced()) {
      actorEl.style.opacity = '0';
      await wait(160);
      placeActor(x, y);
      actorEl.style.opacity = '1';
      await wait(160);
      return;
    }
    const sx = pos.x;
    const sy = pos.y;
    const dist = Math.hypot(x - sx, y - sy);
    const hops = Math.max(1, Math.ceil(dist / maxHop));
    const dir = x >= sx ? 1 : -1;
    if (dist > 4) bunny?.face(dir * 0.95);
    for (let i = 0; i < hops; i += 1) {
      if (id !== runId || !actorEl) return;
      const fx = sx + ((x - sx) * i) / hops;
      const fy = sy + ((y - sy) * i) / hops;
      const tx = sx + ((x - sx) * (i + 1)) / hops;
      const ty = sy + ((y - sy) * (i + 1)) / hops;
      const height = clamp(dist / hops * 0.45, 26, 64);
      if (opts.soundOn?.()) blip(480 + Math.random() * 80);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        const t0 = performance.now();
        const step = (now) => {
          if (id !== runId || !actorEl) { resolve(); return; }
          const p = clamp((now - t0) / HOP_MS, 0, 1);
          let sxv = 1;
          let syv = 1;
          let arc = 0;
          if (p < 0.16) { // crouch
            const k = p / 0.16;
            sxv = 1 + 0.16 * k; syv = 1 - 0.2 * k;
          } else if (p < 0.84) { // air
            const k = (p - 0.16) / 0.68;
            arc = Math.sin(Math.PI * k) * height;
            const s = Math.sin(Math.PI * k);
            sxv = 1.16 - 0.26 * Math.min(1, k * 3) + 0.0 * s;
            syv = 0.8 + 0.34 * Math.min(1, k * 3) - 0.14 * (k > 0.5 ? (k - 0.5) * 2 : 0);
            const m = k;
            placeActor(fx + (tx - fx) * m, fy + (ty - fy) * m - arc);
          } else { // land
            const k = (p - 0.84) / 0.16;
            const squashK = Math.sin(Math.PI * k);
            sxv = 1 + 0.18 * squashK; syv = 1 - 0.22 * squashK;
            placeActor(tx, ty);
          }
          bunny?.shape(sxv, syv);
          if (p < 1) requestAnimationFrame(step);
          else { bunny?.shape(1, 1); resolve(); }
        };
        requestAnimationFrame(step);
      });
    }
    bunny?.face(0);
  }

  function stopTyping() {
    if (typing) { clearInterval(typing.timer); typing = null; }
    bunny?.talk(false);
  }

  /** Typewriter. Resolves when the full line shows. */
  function say(textEl, text) {
    stopTyping();
    textEl.setAttribute('aria-label', text);
    if (reduced()) { textEl.textContent = text; return Promise.resolve(); }
    return new Promise((resolve) => {
      let i = 0;
      textEl.textContent = '';
      bunny?.talk(true);
      const chars = Array.from(text);
      typing = {
        finish() { textEl.textContent = text; stopTyping(); resolve(); },
        timer: setInterval(() => {
          i += 1;
          textEl.textContent = chars.slice(0, i).join('');
          if (i >= chars.length) typing.finish();
        }, TYPE_MS),
      };
    });
  }

  function fillCard({ text, step, total, primary, secondary, onPrimary, onSecondary, extra }) {
    card.replaceChildren();
    card.classList.toggle('is-visit', busy === 'visit');
    card.classList.remove('is-handoff', 'from-right');
    const name = el('p', 'guide-name', names.guide);
    const body = el('p', 'guide-text');
    body.setAttribute('aria-live', 'polite');
    card.append(name, body);
    const foot = el('div', 'guide-foot');
    if (total > 1) {
      const dots = el('div', 'guide-dots');
      dots.setAttribute('aria-label', `Step ${step + 1} of ${total}`);
      for (let i = 0; i < total; i += 1) {
        dots.append(el('span', `guide-dot${i === step ? ' is-on' : ''}`));
      }
      foot.append(dots);
    }
    const btns = el('div', 'guide-btns');
    if (secondary) {
      const b = el('button', 'guide-skip', secondary);
      b.type = 'button';
      b.addEventListener('click', onSecondary);
      btns.append(b);
    }
    if (extra) {
      const b = el('button', 'btn secondary guide-alt', extra.label);
      b.type = 'button';
      b.addEventListener('click', extra.onClick);
      btns.append(b);
    }
    if (primary) {
      const b = el('button', 'btn primary guide-next', primary);
      b.type = 'button';
      b.addEventListener('click', () => {
        if (typing) { typing.finish(); return; }
        onPrimary();
      });
      btns.append(b);
    }
    if (btns.childNodes.length) foot.append(btns);
    if (foot.childNodes.length) card.append(foot);
    return body;
  }

  function targetRect(selector) {
    if (!selector) return null;
    const node = document.querySelector(selector);
    if (!node) return null;
    const r = node.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { node, r };
  }

  /**
   * Card docks at the bottom (or the top when the target is low). The bunny
   * stands on the card's edge, lined up with the target.
   */
  function layout(target, { dim = true } = {}) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const hit = targetRect(target);
    const r = hit?.r;
    const low = r ? (r.top + r.height / 2) > H * 0.55 : false;
    card.classList.toggle('at-top', low);
    card.classList.toggle('at-bottom', !low);
    const cr = card.getBoundingClientRect();
    spot.classList.toggle('no-target', !r);
    if (r) {
      const pad = 8;
      spot.style.display = 'block';
      spot.style.left = `${r.left - pad}px`;
      spot.style.top = `${r.top - pad}px`;
      spot.style.width = `${r.width + pad * 2}px`;
      spot.style.height = `${r.height + pad * 2}px`;
    } else {
      spot.style.display = dim ? 'block' : 'none';
      spot.style.left = `${W / 2}px`;
      spot.style.top = `${H / 2}px`;
      spot.style.width = '0px';
      spot.style.height = '0px';
    }
    const cx = r ? r.left + r.width / 2 : W / 2;
    let x = clamp(cx - size / 2, 6, W - size - 6);
    let y;
    if (!low) {
      // Stand on the card's top edge, under the target.
      y = cr.top - size * 0.93;
      if (r && y < r.bottom - size * 0.35) {
        // Target reaches down to the card: stand at the side instead.
        x = cx > W / 2 ? 8 : W - size - 8;
      }
    } else {
      // Card is up top: stand on top of the target itself.
      y = r.top - 8 - size * 0.93;
      if (y < cr.bottom - size * 0.1) {
        y = clamp(r.top + r.height / 2 - size / 2, cr.bottom, H - size);
        x = cx > W / 2 ? clamp(r.left - size - 6, 6, W - size - 6) : clamp(r.right + 6, 6, W - size - 6);
      }
    }
    return { x, y };
  }

  /* ---------- greeting during setup ---------- */

  async function runGreeting() {
    busy = 'greet';
    ensureRoot('greet');
    document.body.classList.add('guide-touring');
    const lines = [
      fillCopy("Hi, I'm {guide}! Welcome to your new planner.", names),
      'First, let\u2019s set up your planner. I\u2019ll show you around after!',
    ];
    let i = 0;
    const show = async () => {
      const last = i === lines.length - 1;
      const body = fillCard({
        text: lines[i],
        step: i,
        total: lines.length,
        primary: last ? 'Let\u2019s go!' : 'Next',
        onPrimary: async () => {
          if (last) {
            state.greeted = true;
            save();
            await leave();
            return;
          }
          i += 1;
          void show();
        },
      });
      const spotPos = layout(null);
      if (i === 0) {
        placeActor(-size - 20, spotPos.y);
        await hopIn(spotPos);
        bunny?.pose('wave');
      }
      await say(body, lines[i]);
      bunny?.pose('idle');
    };
    root.classList.add('is-on');
    await show();
  }

  async function hopIn(target) {
    if (reduced()) { placeActor(target.x, target.y); actorEl.style.opacity = '1'; return; }
    actorEl.style.opacity = '1';
    await hopTo(target.x, target.y, { maxHop: 120 });
  }

  async function leave() {
    // Free the screen first so taps work right away.
    stopTyping();
    if (!root) return;
    const id = runId;
    root.classList.remove('is-on');
    root.classList.add('is-leaving');
    document.body.classList.remove('guide-touring');
    card.style.display = 'none';
    spot.style.display = 'none';
    if (!reduced() && actorEl) {
      const off = pos.x > window.innerWidth / 2 ? window.innerWidth + 30 : -size - 30;
      await hopTo(off, pos.y, { maxHop: 150 });
    } else if (actorEl) {
      actorEl.style.opacity = '0';
      await wait(220);
    }
    if (id === runId) {
      teardown();
      // Setup can finish while he is still hopping out after the greeting.
      // No render comes after that, so start the waiting tour from here.
      if (pendingTour && opts.enabled !== false && opts.screen?.() === 'today') {
        pendingTour = false;
        setTimeout(() => {
          if (!busy && opts.screen?.() === 'today') void runTour();
          else pendingTour = true;
        }, 450);
      }
    }
  }

  /* ---------- walkthrough ---------- */

  async function runTour() {
    pendingTour = false;
    busy = 'tour';
    ensureRoot('tour');
    document.body.classList.add('guide-touring');
    const steps = buildTour({
      has: (sel) => Boolean(targetRect(sel)),
      greeted: state.greeted,
      names,
    });
    let i = 0;
    const finish = async (handoff) => {
      state = finishTour(state);
      state.handoff = handoff;
      save();
      await leave();
      if (handoff === 'pet') opts.actions?.openPet?.();
    };
    const show = async (first) => {
      const step = steps[i];
      const total = steps.length;
      const body = fillCard({
        text: step.text,
        step: i,
        total,
        primary: step.end ? 'Dress up my pet' : 'Next',
        secondary: step.end ? 'Maybe later' : 'Skip tour',
        onPrimary: () => {
          if (step.end) { void finish('pet'); return; }
          i += 1;
          void show(false);
        },
        onSecondary: () => { void finish('done'); },
      });
      card.dataset.step = step.id;
      const node = step.target ? document.querySelector(step.target) : null;
      if (node) {
        const r = node.getBoundingClientRect();
        if (r.top < 0 || r.bottom > window.innerHeight) node.scrollIntoView({ block: 'center' });
      }
      const where = layout(step.target);
      layoutFn = (resized) => { const p = layout(step.target); if (resized) placeActor(p.x, p.y); };
      if (first) {
        placeActor(-size - 20, where.y);
        root.classList.add('is-on');
        await hopIn(where);
      } else {
        await hopTo(where.x, where.y);
      }
      if (step.id === 'hello') bunny?.pose('wave');
      else if (step.end) bunny?.pose('celebrate');
      else bunny?.pose('idle');
      await say(body, step.text);
    };
    await show(true);
  }

  /* ---------- pop-ins: return visits and after-tour nudges ---------- */

  async function popIn({ text, buttons, linger = VISIT_MS, kind = 'visit' }) {
    busy = kind;
    ensureRoot('visit');
    const id = runId;
    const W = window.innerWidth;
    // Phones: come in from the left so he never sits on the + button.
    const fromRight = kind === 'handoff' || (W >= 700 && Math.random() < 0.5);
    const H = window.innerHeight;
    const body = fillCard({ text, ...(buttons || {}) });
    let x;
    let y;
    if (kind === 'handoff') {
      // Docked card with real buttons, like the tour, but nothing dimmed.
      card.classList.remove('is-visit');
      card.classList.add('is-handoff');
      const p = layout(null, { dim: false });
      x = fromRight ? W - size - 24 : 24;
      ({ y } = p);
    } else {
      card.classList.add('is-visit');
      card.classList.toggle('from-right', fromRight);
      x = fromRight ? W - size - 10 : 10;
      y = H - size - 14;
      card.style.setProperty('--guide-y', `${H - y - 6}px`);
    }
    placeActor(fromRight ? W + 20 : -size - 20, y);
    root.classList.add('is-on');
    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      void leave();
    };
    const tapAway = () => close();
    actorEl.addEventListener('click', tapAway);
    if (!buttons) card.addEventListener('click', tapAway);
    card.style.visibility = 'hidden';
    await hopIn({ x, y });
    if (id !== runId) return;
    card.style.visibility = 'visible';
    bunny?.pose('wave');
    await say(body, text);
    bunny?.pose('idle');
    if (linger) {
      await wait(linger);
      if (id === runId && !done) close();
    }
    return close;
  }

  function showVisit() {
    const ctx = opts.context?.() || {};
    const text = pickVisitLine(ctx);
    return popIn({ text });
  }

  function showGoalsHandoff() {
    const finishHandoff = (fn) => {
      state.handoff = 'done';
      save();
      void leave();
      fn?.();
    };
    return popIn({
      kind: 'handoff',
      text: 'Looking good! Now let\u2019s add your first goal.',
      linger: 0,
      buttons: {
        primary: 'Add a goal',
        onPrimary: () => finishHandoff(opts.actions?.addGoal),
        extra: { label: 'Describe my week', onClick: () => finishHandoff(opts.actions?.describeWeek) },
        secondary: 'Later',
        onSecondary: () => finishHandoff(),
      },
    });
  }

  /* ---------- hooks from the app ---------- */

  const api = {
    get state() { return { ...state }; },
    get busy() { return busy; },
    /** Once per page load, after the first render. */
    onBoot({ setupComplete }) {
      if (opts.enabled === false) return;
      if (state.handoff === 'pet') petTipShown = true;
      if (!setupComplete) {
        if (!state.greeted) setTimeout(() => { if (!busy) void runGreeting(); }, 500);
        pendingTour = needsTour(state);
        return;
      }
      if (needsTour(state)) {
        pendingTour = true;
        return;
      }
      const res = recordOpen(state);
      state = res.state;
      save();
      if (res.show && !visitShown && state.handoff !== 'pet') {
        visitShown = true;
        setTimeout(() => {
          if (!busy && opts.screen?.() === 'today' && !document.body.classList.contains('sheet-open')) void showVisit();
        }, 1100);
      }
    },
    /** After every app render. */
    onRender({ screen, setupComplete }) {
      if (opts.enabled === false || !setupComplete) return;
      if (pendingTour && !busy && screen === 'today') {
        pendingTour = false;
        setTimeout(() => {
          if (!busy && opts.screen?.() === 'today') void runTour();
          else pendingTour = true;
        }, 450);
        return;
      }
      if (busy === 'tour') { layoutFn?.(true); return; }
      if (state.handoff === 'pet' && screen === 'pet' && !petTipShown && !busy) {
        petTipShown = true;
        setTimeout(() => {
          if (!busy && opts.screen?.() === 'pet') void popIn({ text: 'Pick an animal and colours. Shop has clothes!', linger: 3800 });
        }, 500);
      }
      if (state.handoff === 'pet' && screen === 'today' && petTipShown && busy !== 'handoff') {
        if (busy) teardown();
        setTimeout(() => { if (!busy && opts.screen?.() === 'today') void showGoalsHandoff(); }, 350);
      }
    },
    replayTour() {
      teardown();
      state = replayTour(state);
      save();
      pendingTour = true;
    },
    /** Debug and tests: pop in now. */
    visitNow() { if (!busy) return showVisit(); return null; },
    dismiss() { void leave(); },
  };
  return api;
}
