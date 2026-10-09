/*
 * Fixed home layout helpers.
 *
 * The page itself never scrolls. Each screen scrolls inside #app, and on the
 * home screen only the goals list (#day-list) scrolls while the header and pet
 * stay put. These helpers keep that true on phones:
 *  - forwardHomeScroll: a vertical swipe or wheel over the header or pet moves
 *    the goals list instead of doing nothing.
 *  - installKeyboardFit: while the on-screen keyboard is open, sheets fit the
 *    visible area and the focused field stays in view.
 */

const FIELD = 'input, textarea, select, [contenteditable="true"]';

function isField(el) {
  return Boolean(el && el.matches && el.matches(FIELD));
}

/** Let swipes and wheel turns anywhere on the fixed home area scroll the list. */
export function forwardHomeScroll(shell, list) {
  if (!shell || !list) return;
  const skip = (target) => !target || list.contains(target) || isField(target);

  shell.addEventListener('wheel', (event) => {
    if (skip(event.target) || event.ctrlKey) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    list.scrollBy({ top: event.deltaY });
  }, { passive: true });

  let touch = null;
  shell.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1 || skip(event.target)) { touch = null; return; }
    const t = event.touches[0];
    touch = { x: t.clientX, y: t.clientY, top: list.scrollTop, mode: null, lastY: t.clientY, lastT: event.timeStamp, v: 0 };
  }, { passive: true });

  shell.addEventListener('touchmove', (event) => {
    if (!touch || event.touches.length !== 1) return;
    const t = event.touches[0];
    const dx = t.clientX - touch.x;
    const dy = t.clientY - touch.y;
    if (!touch.mode) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      // Sideways drags belong to the pet (turning) and day swipes.
      touch.mode = Math.abs(dy) > Math.abs(dx) ? 'scroll' : 'ignore';
    }
    if (touch.mode !== 'scroll') return;
    const dt = Math.max(1, event.timeStamp - touch.lastT);
    touch.v = (t.clientY - touch.lastY) / dt;
    touch.lastY = t.clientY;
    touch.lastT = event.timeStamp;
    list.scrollTop = touch.top - dy;
  }, { passive: true });

  const end = () => {
    if (touch && touch.mode === 'scroll' && Math.abs(touch.v) > 0.3) {
      // A short glide so a flick feels like a normal scroll.
      list.scrollBy({ top: -touch.v * 260, behavior: 'smooth' });
    }
    touch = null;
  };
  shell.addEventListener('touchend', end, { passive: true });
  shell.addEventListener('touchcancel', () => { touch = null; }, { passive: true });
}

/** Keep sheets and focused fields above the on-screen keyboard. */
export function installKeyboardFit() {
  const root = document.documentElement;
  const vv = window.visualViewport;

  const sync = () => {
    if (!vv) return;
    const hidden = window.innerHeight - vv.height;
    if (hidden > 80 && isField(document.activeElement)) {
      root.style.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`);
      root.style.setProperty('--vv-height', `${Math.round(vv.height)}px`);
      root.dataset.keyboard = 'open';
    } else {
      root.style.removeProperty('--vv-top');
      root.style.removeProperty('--vv-height');
      delete root.dataset.keyboard;
    }
  };
  if (vv) {
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
  }

  document.addEventListener('focusin', (event) => {
    if (!isField(event.target)) return;
    // Wait for the keyboard to finish opening before bringing the field into view.
    setTimeout(() => {
      sync();
      if (document.activeElement === event.target) event.target.scrollIntoView({ block: 'nearest' });
    }, 320);
  });
  document.addEventListener('focusout', () => {
    setTimeout(() => {
      sync();
      // iOS can leave the page nudged up after the keyboard closes.
      if (!isField(document.activeElement) && (window.scrollY || window.scrollX)) window.scrollTo(0, 0);
    }, 120);
  });
  // The page has nothing to scroll; undo any stray shift unless a field needs it.
  window.addEventListener('scroll', () => {
    if (!isField(document.activeElement) && (window.scrollY || window.scrollX)) window.scrollTo(0, 0);
  }, { passive: true });
  sync();
}

/** Remember where each screen's scroll area was, so redraws don't jump to the top. */
export function captureScroll(root) {
  return {
    app: root.scrollTop,
    list: root.querySelector('#day-list')?.scrollTop || 0,
  };
}

export function restoreScroll(root, saved) {
  if (!saved) return;
  root.scrollTop = saved.app;
  const list = root.querySelector('#day-list');
  if (list) list.scrollTop = saved.list;
}
