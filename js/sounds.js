/**
 * Lazy animal calls plus a light chime. Files load on the first play,
 * which is a task tap, so the browser's autoplay rule is already satisfied.
 */

const FILE = {
  dog: 'dog.mp3',
  cat: 'cat.mp3',
  bunny: 'bunny.mp3',
  penguin: 'penguin.mp3',
  monkey: 'monkey.mp3',
  tiger: 'tiger.mp3',
  pig: 'pig.mp3',
  lion: 'lion.mp3',
  panda: 'panda.mp3',
  fox: 'fox.mp3',
  koala: 'koala.mp3',
  chick: 'chick.mp3',
  chime: 'chime.mp3',
};

function urlFor(name) {
  return new URL(`../sounds/${FILE[name]}`, import.meta.url).href;
}

function playFile(name, volume) {
  if (!FILE[name]) return;
  const audio = new Audio(urlFor(name));
  audio.preload = 'auto';
  audio.volume = volume;
  audio.play().catch(() => {});
}

export function playCelebrationAudio(animal, { chime = true, voice = 0.55, bell = 0.22 } = {}) {
  playFile(FILE[animal] ? animal : 'penguin', voice);
  if (chime) playFile('chime', bell);
}

export function playChime(volume = 0.22) {
  playFile('chime', volume);
}
