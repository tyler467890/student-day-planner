/**
 * Where shop items sit on each Cube Pet.
 * The head cube's flat top is y = 1.431. Ears, tufts and the lion mane
 * rise above that, so each animal can lift, scale or tip a slot.
 * +Z is toward the camera (the face). Accessories hang off the body,
 * so these offsets follow idle, dance and the buy spin.
 *
 * A polished GLB dropped in items/overrides.json is parented to the same
 * slot anchor, so it inherits this fit. Build hat files with the brim
 * near y = 1.431.
 */

export const HEAD_TOP = 1.431;

export const PETS = ['dog', 'cat', 'bunny', 'penguin', 'monkey', 'tiger', 'pig', 'lion', 'panda', 'fox', 'koala', 'chick'];

/** Base of each slot before the per-animal nudge. Matches the mesh builders. */
export const SLOT_ANCHOR = {
  hat: { y: HEAD_TOP, z: 0 },
  face: { y: 0.78, z: 0 },
  neck: { y: 0.4, z: 0 },
  body: { y: 0.32, z: 0 },
  back: { y: 0.72, z: -0.72 },
  effect: { y: 1.2, z: 0 },
};

/**
 * hat: extra brim height above HEAD_TOP.
 * hatZ / hatScale / hatTilt: slide, shrink and tip hats around ears.
 * face / faceZ: eye height and how far glasses sit off the snout.
 * neck / neckZ: collar height and forward shift.
 * backY / backZ: packs and wings clear of tails.
 * winged: penguin and chick wings replace arms, so skirts open at the sides.
 */
export const PET_FIT = {
  dog: { hat: 0, face: 0.78, faceZ: 0.04, neck: 0.4, top: 1.62, wide: 0.82 },
  cat: { hat: 0.02, face: 0.72, faceZ: 0.02, neck: 0.38, top: 1.68, wide: 0.84, hatScale: 0.9 },
  bunny: { hat: -0.02, face: 0.78, neck: 0.4, top: 2.12, wide: 0.9, hatZ: 0.5, hatScale: 0.66, hatTilt: 0.38 },
  penguin: { hat: 0.2, face: 0.8, neck: 0.5, top: 1.82, wide: 1.15, hatZ: 0, hatScale: 0.86, backY: 0.08, backZ: -0.08, winged: true },
  monkey: { hat: 0.02, face: 0.76, neck: 0.44, top: 1.7, wide: 1.2, hatZ: -0.04, hatScale: 0.88 },
  tiger: { hat: 0.02, face: 0.8, faceZ: 0.04, neck: 0.4, top: 1.64, wide: 0.9, hatScale: 0.9 },
  pig: { hat: 0, face: 0.88, faceZ: 0.16, neck: 0.44, neckZ: 0.06, top: 1.62, wide: 0.84 },
  lion: { hat: 0.15, face: 0.8, faceZ: 0.02, neck: 0.44, top: 1.95, wide: 1.15, hatScale: 0.9 },
  panda: { hat: 0.02, face: 0.78, faceZ: 0.04, neck: 0.4, top: 1.58, wide: 0.9, hatScale: 0.88 },
  fox: { hat: 0.04, face: 0.84, faceZ: 0.12, neck: 0.42, top: 1.78, wide: 0.88, hatScale: 0.86 },
  koala: { hat: 0, face: 0.74, neck: 0.38, top: 1.56, wide: 1.05, hatScale: 0.82 },
  chick: { hat: 0.2, face: 0.8, neck: 0.5, top: 1.82, wide: 1.12, hatZ: 0, hatScale: 0.86, backY: 0.08, backZ: -0.08, winged: true },
};

export function fitFor(animal) {
  return PET_FIT[animal] || PET_FIT.dog;
}

/** World pose of a slot anchor for one animal. Hats scale around the brim. */
export function anchorFor(animal, slot) {
  const fit = fitFor(animal);
  if (slot === 'hat') {
    const scale = fit.hatScale || 1;
    const tilt = fit.hatTilt || 0;
    const brimY = HEAD_TOP + (fit.hat || 0);
    const brimZ = fit.hatZ || 0;
    return {
      x: 0,
      y: brimY - scale * HEAD_TOP * Math.cos(tilt),
      z: brimZ - scale * HEAD_TOP * Math.sin(tilt),
      scale,
      tilt,
      brimY,
      brimZ,
    };
  }
  if (slot === 'face') {
    return {
      x: 0,
      y: (fit.face || SLOT_ANCHOR.face.y) - SLOT_ANCHOR.face.y,
      z: fit.faceZ || 0,
      scale: fit.faceScale || 1,
      tilt: 0,
    };
  }
  if (slot === 'neck') {
    return {
      x: 0,
      y: (fit.neck || SLOT_ANCHOR.neck.y) - SLOT_ANCHOR.neck.y,
      z: fit.neckZ || 0,
      scale: 1,
      tilt: 0,
    };
  }
  if (slot === 'back') {
    return { x: 0, y: fit.backY || 0, z: fit.backZ || 0, scale: fit.backScale || 1, tilt: 0 };
  }
  if (slot === 'body') {
    return { x: 0, y: fit.bodyY || 0, z: 0, scale: fit.bodyScale || 1, tilt: 0 };
  }
  return { x: 0, y: fit.effectY || 0, z: 0, scale: 1, tilt: 0 };
}
