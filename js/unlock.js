/**
 * The unlock screen. Shown before the planner when js/config.js has
 * REQUIRE_UNLOCK = true and this device isn't unlocked yet.
 * Calo the bunny says hello; the buyer types the code from their Etsy PDF.
 */

import { activate } from './unlock-gate.js';

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

async function mountBunny(holder, reducedMotion) {
  const canvas = el('canvas', 'unlock-canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const emoji = el('div', 'unlock-emoji', '🐰');
  emoji.setAttribute('aria-hidden', 'true');
  holder.append(canvas, emoji);
  try {
    const { createBunnyActor } = await import('./guide.js');
    const actor = createBunnyActor(canvas, 'bunny');
    if (!actor) throw new Error('no webgl');
    await actor.ready;
    actor.pose(reducedMotion ? 'idle' : 'wave');
    actor.start();
    holder.classList.add('has-3d');
    return actor;
  } catch {
    holder.classList.add('is-fallback');
    return null;
  }
}

/**
 * Show the screen and resolve once the device is unlocked.
 * opts: { cfg, storage, guideName, appName, reducedMotion, fetchImpl }
 */
export function showUnlockScreen(opts) {
  const { cfg, storage, guideName = 'Calo', appName = 'Calo' } = opts;
  return new Promise((resolve) => {
    const root = el('div', 'unlock');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'unlock-title');
    root.dataset.state = 'enter';

    const stage = el('div', 'unlock-bunny');
    const bubble = el('div', 'unlock-bubble');
    const who = el('p', 'unlock-name', guideName);
    const say = el('p', 'unlock-say', 'Enter your code to get started!');
    say.id = 'unlock-title';
    say.setAttribute('aria-live', 'polite');
    bubble.append(who, say);

    const form = el('form', 'unlock-form');
    form.noValidate = true;
    const label = el('label', 'field-label', 'Your unlock code');
    label.htmlFor = 'unlock-code';
    const input = el('input', 'unlock-input');
    Object.assign(input, {
      id: 'unlock-code', type: 'text', autocomplete: 'one-time-code', spellcheck: false,
      placeholder: 'CALO-XXXX-XXXX-XXXX-XXXX', inputMode: 'text', maxLength: 40,
    });
    input.setAttribute('autocapitalize', 'characters');
    input.setAttribute('autocorrect', 'off');
    const msg = el('p', 'unlock-msg');
    msg.id = 'unlock-msg';
    msg.setAttribute('role', 'alert');
    input.setAttribute('aria-describedby', 'unlock-msg unlock-help');
    const submit = el('button', 'btn primary block unlock-submit', 'Unlock');
    submit.type = 'submit';
    const help = el('p', 'unlock-help', `Your code is in the PDF that came with your ${appName} order on Etsy. One code works on up to 3 of your devices.`);
    help.id = 'unlock-help';
    form.append(label, input, msg, submit, help);

    const done = el('div', 'unlock-done');
    const go = el('button', 'btn primary block unlock-go', `Open ${appName}`);
    go.type = 'button';
    done.append(go);

    const card = el('div', 'unlock-card');
    card.append(form, done);
    root.append(stage, bubble, card);
    document.body.append(root);
    document.documentElement.classList.add('is-locked');

    let actor = null;
    void mountBunny(stage, opts.reducedMotion?.()).then((a) => { actor = a; });

    function setState(state, text, detail = '') {
      root.dataset.state = state;
      say.textContent = text;
      msg.textContent = detail;
      input.setAttribute('aria-invalid', state === 'error' || state === 'too-many' ? 'true' : 'false');
    }

    // Tidy as they type: upper case, CALO- prefix, groups of four.
    // Only when the cursor is at the end, so editing the middle isn't jumpy.
    input.addEventListener('input', () => {
      if (root.dataset.state !== 'enter' && root.dataset.state !== 'busy') setState('enter', 'Enter your code to get started!');
      if (input.selectionStart !== input.value.length) return;
      const raw = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if ('CALO'.startsWith(raw)) { input.value = raw; return; }
      const body = raw.startsWith('CALO') ? raw.slice(4) : raw;
      input.value = ['CALO', ...(body.match(/.{1,4}/g) || [])].join('-');
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (root.dataset.state === 'busy') return;
      root.dataset.state = 'busy';
      submit.disabled = true;
      submit.textContent = 'Checking…';
      say.textContent = 'Let me check that for you…';
      msg.textContent = '';
      actor?.talk(true);
      const result = await activate({ cfg, storage, input: input.value, fetchImpl: opts.fetchImpl });
      actor?.talk(false);
      submit.disabled = false;
      submit.textContent = 'Unlock';
      if (result.ok) {
        setState('success', `You’re all set! Welcome to ${appName}!`);
        actor?.pose('celebrate');
        go.focus();
        return;
      }
      if (result.kind === 'too_many') {
        setState('too-many', 'Hmm, this code is already in use.', result.message);
      } else {
        setState('error', result.kind === 'format' ? 'Almost! Let’s fix a small typo.' : 'Hmm, that didn’t work.', result.message);
      }
      input.focus();
    });

    go.addEventListener('click', () => {
      actor?.dispose();
      root.remove();
      document.documentElement.classList.remove('is-locked');
      resolve();
    });

    setTimeout(() => input.focus(), 50);
  });
}
