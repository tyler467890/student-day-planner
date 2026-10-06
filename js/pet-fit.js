/**
 * Where shop items sit on each Cube Pet.
 * The head cube's flat top is y = 1.431. Ears, tufts and the lion mane
 * rise above that, so each animal can lift, scale or tip a slot.
 * +Z is toward the camera (the face). Accessories hang off the body,
 * so these offsets follow idle, dance and the buy spin.
 *
 * Hat numbers are the Dayli 1.3.2 seats (the brim already rests on the
 * cube top). A positive hat lift opens a gap under the brim, so these
 * stay at 0. Penguin, chick and monkey shift back a hair so the hat
 * sits over the front tuft. The bunny hat sits on the front of the head,
 * in front of the ears, tipped forward. The lion's brim sinks into the
 * mane because the mane rises above the cube.
 *
 * A polished GLB dropped in items/overrides.json is parented to the same
 * slot anchor, so it inherits this fit. Build hat files with the brim
 * near y = 1.431. Per-pet nudges belong in items/fits.json, not here.
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
 * eyeY / eyeZ: centre of the eyes, in front of the face. Glasses sit here.
 * eyeSep: distance between the two eye centres. eyeH: eye height.
 * face: kept so older fits.json files still parse. The face anchor
 * itself stays put; glasses read eyeY and eyeZ.
 * neck / neckZ: collar height and forward shift.
 * backY / backZ: packs and wings clear of tails.
 * winged: penguin and chick wings replace arms, so skirts open at the sides.
 */
export const PET_FIT = {
  dog: { hat: 0, face: 0.78, neck: 0.4, top: 1.62, wide: 0.82, eyeY: 0.96, eyeZ: 0.635, eyeSep: 0.39, eyeH: 0.18 },
  cat: { hat: 0, face: 0.72, neck: 0.38, top: 1.68, wide: 0.84, eyeY: 0.97, eyeZ: 0.635, eyeSep: 0.48, eyeH: 0.26 },
  bunny: { hat: -0.02, face: 0.78, neck: 0.4, top: 2.12, wide: 0.9, hatZ: 0.5, hatScale: 0.66, hatTilt: 0.38, eyeY: 0.96, eyeZ: 0.635, eyeSep: 0.39, eyeH: 0.18 },
  penguin: { hat: 0, face: 0.8, neck: 0.5, top: 1.7, wide: 1.15, hatZ: -0.03, winged: true, eyeY: 0.96, eyeZ: 0.635, eyeSep: 0.38, eyeH: 0.18 },
  monkey: { hat: 0, face: 0.76, neck: 0.44, top: 1.7, wide: 1.2, hatZ: -0.03, eyeY: 0.96, eyeZ: 0.634, eyeSep: 0.38, eyeH: 0.22 },
  tiger: { hat: 0, face: 0.74, neck: 0.4, top: 1.64, wide: 0.9, eyeY: 0.99, eyeZ: 0.634, eyeSep: 0.39, eyeH: 0.22 },
  pig: { hat: 0, face: 0.8, neck: 0.44, top: 1.62, wide: 0.84, eyeY: 0.96, eyeZ: 0.634, eyeSep: 0.39, eyeH: 0.22 },
  lion: { hat: 0, face: 0.76, neck: 0.42, top: 1.9, wide: 1.05, eyeY: 0.99, eyeZ: 0.635, eyeSep: 0.39, eyeH: 0.22 },
  panda: { hat: 0, face: 0.74, neck: 0.4, top: 1.58, wide: 0.9, eyeY: 0.98, eyeZ: 0.635, eyeSep: 0.52, eyeH: 0.26 },
  fox: { hat: 0, face: 0.74, neck: 0.4, top: 1.78, wide: 0.88, eyeY: 0.96, eyeZ: 0.634, eyeSep: 0.39, eyeH: 0.22 },
  koala: { hat: 0, face: 0.72, neck: 0.38, top: 1.56, wide: 1.05, eyeY: 0.94, eyeZ: 0.634, eyeSep: 0.39, eyeH: 0.22 },
  chick: { hat: 0, face: 0.8, neck: 0.5, top: 1.7, wide: 1.12, hatZ: -0.03, winged: true, eyeY: 0.96, eyeZ: 0.634, eyeSep: 0.38, eyeH: 0.22 },
};

export function fitFor(animal) {
  return PET_FIT[animal] || PET_FIT.dog;
}

/** Copy the built-in seat, then apply items/fits.json for that animal. */
export function mergeFit(animal, overrides) {
  const fit = { ...(PET_FIT[animal] || PET_FIT.dog) };
  const extra = overrides?.[animal];
  if (extra && typeof extra === 'object') {
    for (const [key, value] of Object.entries(extra)) {
      if (key.startsWith('_')) continue;
      fit[key] = value;
    }
  }
  return fit;
}

/** World pose of a slot anchor. Hats scale around the brim. */
export function anchorFromFit(fit, slot) {
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
    return { x: 0, y: 0, z: 0, scale: fit.faceScale || 1, tilt: 0 };
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

export function anchorFor(animal, slot) {
  return anchorFromFit(fitFor(animal), slot);
}
