/**
 * Wear items/v2 GLBs from fits.json. A pose with no file still seats a built-in
 * mesh (the top hat). Drop a new GLB in under the same filename and it replaces
 * the builder, including a future sweater.
 */
import { Group } from 'three';

const BASE = new URL('../items/v2/', import.meta.url).href;   // file lives in js/, so ../items/v2/
let fitsTask = null;

export function loadFits() {
  if (!fitsTask) fitsTask = fetch(`${BASE}fits.json`).then((r) => r.json());
  return fitsTask;
}

/** Merge the item's default entry with the per-animal entry. Includes items that have a pose but no GLB yet. */
export function poseFor(fits, id, animal) {
  const entry = fits?.items?.[id];
  if (!entry) return null;
  return { ...(entry.default || {}), ...(entry.pets?.[animal] || entry.pets?.dog || {}) };
}

/** Merge the item's default entry with the per-animal entry. Returns null if the item has no GLB. */
export function fitFor(fits, id, animal) {
  const fit = poseFor(fits, id, animal);
  return fit?.file ? fit : null;
}

/** One group under anchors.root (model space, identity) that holds every GLB item. */
export function glbGroup(anchors) {
  if (!anchors.glb) {
    anchors.glb = new Group();
    anchors.glb.name = 'glb_items';
    anchors.root.add(anchors.glb);
  }
  return anchors.glb;
}

/** Remove every GLB item, including parts that were parented to the pet's legs (sweater sleeves). */
export function clearGlbItems(anchors) {
  glbGroup(anchors).clear();
  for (const n of anchors.glbLegParts || []) n.removeFromParent();
  anchors.glbLegParts = [];
}

/**
 * Nodes tagged with extras.attachTo (e.g. the sweater's 'sleeve_pivot' -> 'leg-front-left') are moved onto that
 * leg so they swing with the walk cycle. Their mesh is modelled around the leg pivot, so they sit at the leg origin.
 */
function attachLegParts(anchors, obj, scale) {
  const pet = anchors.root.parent?.parent;   // accessory_root -> body -> pet root
  if (!pet) return;
  const tagged = [];
  obj.traverse((n) => { if (n.userData?.attachTo) tagged.push(n); });
  for (const n of tagged) {
    const leg = pet.getObjectByName(n.userData.attachTo);
    if (!leg) { n.removeFromParent(); continue; }   // pet has no such leg: drop the part
    leg.add(n);
    n.position.set(0, 0, 0); n.rotation.set(0, 0, 0); n.scale.setScalar(scale);
    (anchors.glbLegParts ||= []).push(n);
  }
}

/**
 * Load and place one item. `loadScene(url)` is accessories.js's cached GLTF loader.
 * glTF extras become userData, so the existing tickAccessories() fx (flame, bob, snow) keep working.
 */
export async function placeItemGlb(anchors, id, animal, loadScene) {
  const fits = await loadFits();
  const fit = fitFor(fits, id, animal);
  if (!fit) return null;
  const src = await loadScene(BASE + fit.file);
  const obj = src.clone(true);
  obj.position.fromArray(fit.position || [0, 0, 0]);
  const r = fit.rotation || [0, 0, 0];
  obj.rotation.set(r[0], r[1], r[2]);
  obj.scale.setScalar(fit.scale ?? 1);
  obj.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  obj.userData.itemId = id;
  glbGroup(anchors).add(obj);
  attachLegParts(anchors, obj, fit.scale ?? 1);
  return obj;
}
