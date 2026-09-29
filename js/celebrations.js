/**
 * Task-completion celebrations. The signature id plays the current animal's move.
 * General ids are shared. A save with no list gets the full set, signature included.
 */

export const GENERAL_CELEBRATIONS = [
  { id: 'dance', label: 'Dance' },
  { id: 'jump', label: 'Jump and spin' },
  { id: 'wiggle', label: 'Happy wiggle' },
  { id: 'confetti', label: 'Confetti' },
  { id: 'stars', label: 'Star pop' },
  { id: 'cheer', label: 'Cheer' },
];

export const SIGNATURES = {
  dog: { label: 'Tail wag' },
  cat: { label: 'Stretch' },
  bunny: { label: 'Hops' },
  penguin: { label: 'Waddle' },
  monkey: { label: 'Backflip' },
  tiger: { label: 'Pounce' },
  pig: { label: 'Oink bounce' },
  lion: { label: 'Roar' },
  panda: { label: 'Roll' },
  fox: { label: 'Pounce hop' },
  koala: { label: 'Hug sway' },
  chick: { label: 'Wing flap' },
};

const ALLOWED = new Set(['signature', ...GENERAL_CELEBRATIONS.map((item) => item.id)]);

export function defaultCelebrations() {
  return ['signature', ...GENERAL_CELEBRATIONS.map((item) => item.id)];
}

export function signatureLabel(animal) {
  return SIGNATURES[animal]?.label || 'Signature';
}

export function celebrationChoices(animal) {
  return [{ id: 'signature', label: signatureLabel(animal) }, ...GENERAL_CELEBRATIONS];
}

export function normalizeCelebrations(list) {
  if (!Array.isArray(list)) return defaultCelebrations();
  const out = [];
  for (const id of list) {
    if (ALLOWED.has(id) && !out.includes(id)) out.push(id);
  }
  return out.length ? out : ['signature'];
}

export function pickCelebration(list, random = Math.random) {
  const pool = normalizeCelebrations(list);
  const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
  return pool[index];
}
