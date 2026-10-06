/**
 * Pet shop catalogue, coin wallet, and wardrobe.
 * Coins are lifetime points divided by POINTS_PER_COIN. Levels stay on points.
 */

export const POINTS_PER_COIN = 5;

export const SLOTS = ['hat', 'face', 'neck', 'body', 'back', 'effect'];

export const SLOT_TABS = [
  ['all', 'All'],
  ['hat', 'Hats'],
  ['face', 'Face'],
  ['neck', 'Neck'],
  ['body', 'Body'],
  ['back', 'Back'],
  ['effect', 'Effects'],
];

/** @type {Array<object>} */
export const ITEMS = [
  { id: 'party_hat', name: 'Party Hat', short: 'Party Hat', slot: 'hat', price: 10, art: 'model', rise: 0.96 },
  { id: 'round_glasses', name: 'Round Glasses', short: 'Glasses', slot: 'face', price: 15, art: 'kenney', rise: 0 },
  { id: 'bow_tie', name: 'Bow Tie', short: 'Bow Tie', slot: 'neck', price: 15, art: 'model', rise: 0 },
  { id: 'beanie', name: 'Beanie', short: 'Beanie', slot: 'hat', price: 20, art: 'model', rise: 0.74 },
  { id: 'heart_cheeks', name: 'Heart Cheeks', short: 'Hearts', slot: 'face', price: 25, art: 'kenney', rise: 0 },
  { id: 'bell_collar', name: 'Bell Collar', short: 'Bell', slot: 'neck', price: 35, art: 'model', rise: 0 },
  { id: 'cap', name: 'Baseball Cap', short: 'Cap', slot: 'hat', price: 40, art: 'model', rise: 0.28 },
  { id: 'backpack', name: 'School Backpack', short: 'Backpack', slot: 'back', price: 45, art: 'model', rise: 0.2 },
  { id: 'sunglasses', name: 'Sunglasses', short: 'Sunglasses', slot: 'face', price: 50, art: 'kenney', rise: 0 },
  { id: 'scarf', name: 'Cozy Scarf', short: 'Scarf', slot: 'neck', price: 60, art: 'model', rise: 0 },
  { id: 'flower_crown', name: 'Flower Crown', short: 'Flowers', slot: 'hat', price: 70, art: 'model', rise: 0.12 },
  { id: 'tutu', name: 'Tutu', short: 'Tutu', slot: 'body', price: 80, art: 'model', rise: 0 },
  { id: 'hero_mask', name: 'Hero Mask', short: 'Mask', slot: 'face', price: 90, art: 'model', rise: 0 },
  { id: 'hearts', name: 'Floating Hearts', short: 'Hearts', slot: 'effect', price: 90, art: 'kenney', rise: 0.4 },
  { id: 'sweater', name: 'Striped Sweater', short: 'Sweater', slot: 'body', price: 110, art: 'model', rise: 0 },
  { id: 'top_hat', name: 'Top Hat', short: 'Top Hat', slot: 'hat', price: 120, art: 'kenney', rise: 0.85 },
  { id: 'sparkles', name: 'Star Sparkles', short: 'Sparkles', slot: 'effect', price: 130, art: 'kenney', rise: 0.4 },
  { id: 'cape', name: 'Hero Cape', short: 'Cape', slot: 'back', price: 140, art: 'model', rise: 0.15 },
  { id: 'grad_cap', name: 'Graduation Cap', short: 'Grad Cap', slot: 'hat', price: 160, art: 'model', rise: 0.26 },
  { id: 'snowfall', name: 'Snowfall', short: 'Snowfall', slot: 'effect', price: 180, art: 'kenney', rise: 0.35 },
  { id: 'wings', name: 'Butterfly Wings', short: 'Wings', slot: 'back', price: 200, art: 'model', rise: 0.2 },
  { id: 'wizard_hat', name: 'Wizard Hat', short: 'Wizard Hat', slot: 'hat', price: 250, art: 'model', rise: 1.06 },
  { id: 'jetpack', name: 'Rocket Jetpack', short: 'Jetpack', slot: 'back', price: 300, art: 'model', rise: 0.35 },
  { id: 'sprout', name: 'Little Sprout', short: 'Sprout', slot: 'hat', price: null, art: 'model', rise: 0.54, rare: { kind: 'level', n: 3, label: 'Level 3' } },
  { id: 'flame_band', name: 'Streak Flame Headband', short: 'Flame Band', slot: 'hat', price: null, art: 'model', rise: 0.4, rare: { kind: 'streak', n: 7, label: '🔥 7 days' } },
  { id: 'star_medal', name: 'Star Medal', short: 'Star Medal', slot: 'neck', price: null, art: 'model', rise: 0, rare: { kind: 'streak', n: 14, label: '🔥 14 days' } },
  { id: 'rainbow_aura', name: 'Rainbow Aura', short: 'Aura', slot: 'effect', price: null, art: 'model', rise: 0.2, rare: { kind: 'streak', n: 30, label: '🔥 30 days' } },
  { id: 'crown', name: 'Golden Crown', short: 'Crown', slot: 'hat', price: null, art: 'model', rise: 0.37, rare: { kind: 'level', n: 10, label: 'Level 10' } },
  { id: 'golden_wings', name: 'Golden Wings', short: 'Gold Wings', slot: 'back', price: null, art: 'model', rise: 0.2, rare: { kind: 'streak', n: 100, label: '🔥 100 days' } },
];

const BY_ID = new Map(ITEMS.map((item) => [item.id, item]));

export function itemById(id) {
  return BY_ID.get(id) || null;
}

export function itemsInSlot(slot) {
  if (!slot || slot === 'all') return ITEMS;
  return ITEMS.filter((item) => item.slot === slot);
}

export function coinsFromPoints(points) {
  const n = Number(points) || 0;
  if (!n) return 0;
  return Math.trunc(n / POINTS_PER_COIN);
}

export function earnedCoins(completions, bonuses) {
  let total = 0;
  for (const row of completions || []) total += coinsFromPoints(row.points);
  for (const row of bonuses || []) total += coinsFromPoints(row.points);
  return total;
}

/** Spendable coins. Never negative, even if more was spent than remains. */
export function walletBalance(completions, bonuses, spent) {
  return Math.max(0, earnedCoins(completions, bonuses) - (Number(spent) || 0));
}

export function emptyOutfit() {
  return { hat: null, face: null, neck: null, body: null, back: null, effect: null };
}

export const PET_IDS = ['dog', 'cat', 'bunny', 'penguin', 'monkey', 'tiger', 'pig', 'lion', 'panda', 'fox', 'koala', 'chick'];

export function defaultWardrobe() {
  return {
    spent: 0,
    owned: {},
    outfit: emptyOutfit(),
    outfits: {},
    looks: [],
    looksByPet: {},
    pet: null,
    raresReady: false,
    keptHat: false,
  };
}

function cleanSlot(id) {
  const item = itemById(id);
  return item ? item.id : null;
}

function readOutfit(src) {
  const outfit = emptyOutfit();
  if (!src || typeof src !== 'object') return outfit;
  for (const slot of SLOTS) {
    const item = itemById(src[slot]);
    if (item && item.slot === slot) outfit[slot] = item.id;
  }
  return outfit;
}

function cleanLooks(list, owned) {
  const looks = [];
  for (const look of Array.isArray(list) ? list : []) {
    if (looks.length >= 3 || !look || typeof look !== 'object') continue;
    const next = emptyOutfit();
    for (const slot of SLOTS) {
      const item = itemById(look.outfit?.[slot]);
      if (item && item.slot === slot && owned[item.id]) next[slot] = item.id;
    }
    const name = String(look.name || '').trim().slice(0, 24);
    looks.push({
      id: String(look.id || `look-${looks.length + 1}`),
      name: name || `Look ${looks.length + 1}`,
      outfit: next,
    });
  }
  return looks;
}

function petId(animal) {
  return PET_IDS.includes(animal) ? animal : null;
}

/** Keep the active pet's outfit and named looks in the per-pet maps. */
function remember(next) {
  if (!next.pet) return next;
  next.outfits[next.pet] = { ...next.outfit };
  next.looksByPet[next.pet] = next.looks;
  return next;
}

export function normalizeWardrobe(saved) {
  const base = defaultWardrobe();
  if (!saved || typeof saved !== 'object') return base;
  const owned = {};
  const rawOwned = saved.owned && typeof saved.owned === 'object' ? saved.owned : {};
  for (const [id, rec] of Object.entries(rawOwned)) {
    if (!itemById(id)) continue;
    owned[id] = {
      at: typeof rec?.at === 'string' ? rec.at : null,
      source: rec?.source === 'unlock' || rec?.source === 'kept' ? rec.source : 'buy',
    };
  }
  const outfits = {};
  const rawOutfits = saved.outfits && typeof saved.outfits === 'object' ? saved.outfits : {};
  for (const [animal, fit] of Object.entries(rawOutfits)) {
    if (!petId(animal)) continue;
    outfits[animal] = readOutfit(fit);
  }
  const looksByPet = {};
  const rawLooks = saved.looksByPet && typeof saved.looksByPet === 'object' ? saved.looksByPet : {};
  for (const [animal, list] of Object.entries(rawLooks)) {
    if (!petId(animal)) continue;
    looksByPet[animal] = cleanLooks(list, owned);
  }
  const pet = petId(saved.pet);
  const spent = Number(saved.spent);
  return {
    spent: Number.isFinite(spent) && spent > 0 ? Math.round(spent) : 0,
    owned,
    outfit: readOutfit(saved.outfit),
    outfits,
    looks: cleanLooks(saved.looks, owned),
    looksByPet,
    pet,
    raresReady: Boolean(saved.raresReady),
    keptHat: Boolean(saved.keptHat),
  };
}

/**
 * The worn outfit and up to three saved looks belong to one animal.
 * Switching pets puts the previous look away and brings the next one out.
 */
export function bindPet(wardrobe, animal) {
  const next = normalizeWardrobe(wardrobe);
  const id = petId(animal) || 'penguin';
  if (!next.pet) {
    if (!next.outfits[id]) next.outfits[id] = { ...next.outfit };
    if (!next.looksByPet[id]) next.looksByPet[id] = next.looks;
    next.pet = id;
    next.outfit = { ...emptyOutfit(), ...next.outfits[id] };
    next.looks = next.looksByPet[id];
    return next;
  }
  if (next.pet === id) return next;
  next.outfits[next.pet] = { ...next.outfit };
  next.looksByPet[next.pet] = next.looks;
  next.pet = id;
  next.outfit = { ...emptyOutfit(), ...(next.outfits[id] || emptyOutfit()) };
  next.looks = next.looksByPet[id] || [];
  if (!next.outfits[id]) next.outfits[id] = { ...next.outfit };
  if (!next.looksByPet[id]) next.looksByPet[id] = next.looks;
  return next;
}

export function qualifies(item, stats) {
  if (!item?.rare) return false;
  if (item.rare.kind === 'level') return (stats.level || 1) >= item.rare.n;
  if (item.rare.kind === 'streak') return (stats.best || 0) >= item.rare.n;
  return false;
}

export function isOwned(wardrobe, id) {
  return Boolean(wardrobe?.owned?.[id]);
}

/**
 * Grant rares the student already earned. The first pass is silent.
 * Later passes return the new gifts so the app can celebrate them.
 */
export function grantQualified(wardrobe, stats, { celebrate = false, at = null } = {}) {
  const next = normalizeWardrobe(wardrobe);
  const newly = [];
  for (const item of ITEMS) {
    if (!item.rare || next.owned[item.id]) continue;
    if (!qualifies(item, stats)) continue;
    next.owned[item.id] = { at, source: 'unlock' };
    if (celebrate && next.raresReady) newly.push(item.id);
  }
  if (!next.raresReady) next.raresReady = true;
  return { wardrobe: next, newly };
}

/** People who had the old party-hat toggle keep that hat, already worn. */
export function keepLegacyHat(wardrobe, hadHat) {
  const next = normalizeWardrobe(wardrobe);
  if (!hadHat || next.keptHat) return next;
  next.keptHat = true;
  if (!next.owned.party_hat) next.owned.party_hat = { at: null, source: 'kept' };
  if (!next.outfit.hat) next.outfit.hat = 'party_hat';
  return next;
}

export function canAfford(balance, item) {
  if (!item || item.price == null) return false;
  return balance >= item.price;
}

export function coinsShort(balance, item) {
  if (!item || item.price == null) return 0;
  return Math.max(0, item.price - balance);
}

export function buy(wardrobe, itemId, balance, at) {
  const item = itemById(itemId);
  const next = normalizeWardrobe(wardrobe);
  if (!item || item.price == null) return { ok: false, reason: 'missing', wardrobe: next };
  if (next.owned[item.id]) return { ok: false, reason: 'owned', wardrobe: next };
  if (balance < item.price) return { ok: false, reason: 'coins', need: item.price - balance, wardrobe: next };
  next.owned[item.id] = { at: at || null, source: 'buy' };
  next.spent += item.price;
  return { ok: true, wardrobe: next, left: balance - item.price };
}

export function wear(wardrobe, itemId) {
  const item = itemById(itemId);
  const next = normalizeWardrobe(wardrobe);
  if (!item || !next.owned[item.id]) return next;
  next.outfit[item.slot] = item.id;
  return remember(next);
}

export function removeWorn(wardrobe, itemId) {
  const item = itemById(itemId);
  const next = normalizeWardrobe(wardrobe);
  if (!item) return next;
  if (next.outfit[item.slot] === item.id) next.outfit[item.slot] = null;
  return remember(next);
}

export function resetOutfit(wardrobe) {
  const next = normalizeWardrobe(wardrobe);
  next.outfit = emptyOutfit();
  return remember(next);
}

export function saveLook(wardrobe, name) {
  const next = normalizeWardrobe(wardrobe);
  if (next.looks.length >= 3) return { ok: false, reason: 'full', wardrobe: next };
  const label = String(name || '').trim().slice(0, 24) || `Look ${next.looks.length + 1}`;
  next.looks.push({
    id: `look-${Date.now().toString(36)}-${next.looks.length}`,
    name: label,
    outfit: { ...next.outfit },
  });
  return { ok: true, wardrobe: remember(next) };
}

export function deleteLook(wardrobe, id) {
  const next = normalizeWardrobe(wardrobe);
  next.looks = next.looks.filter((look) => look.id !== id);
  return remember(next);
}

export function applyLook(wardrobe, id) {
  const next = normalizeWardrobe(wardrobe);
  const look = next.looks.find((row) => row.id === id);
  if (!look) return next;
  const outfit = emptyOutfit();
  for (const slot of SLOTS) {
    const itemId = look.outfit[slot];
    if (itemId && next.owned[itemId]) outfit[slot] = itemId;
  }
  next.outfit = outfit;
  return remember(next);
}

/** Outfit shown on the pet. A try-on replaces one slot and is not saved. */
export function previewOutfit(wardrobe, tryId) {
  const outfit = { ...(wardrobe?.outfit || emptyOutfit()) };
  const item = itemById(tryId);
  if (item) outfit[item.slot] = item.id;
  return outfit;
}

export function thumbUrl(id) {
  return `items/thumbs/thumb_${id}.png`;
}

export { cleanSlot };
