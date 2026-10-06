import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POINTS_PER_COIN, bindPet, buy, coinsFromPoints, earnedCoins, grantQualified, itemById,
  keepLegacyHat, normalizeWardrobe, previewOutfit, qualifies, resetOutfit, saveLook,
  walletBalance, wear,
} from '../js/shop.js';
import { levelForPoints, migrateSettings } from '../js/model.js';
import { HEAD_TOP, anchorFor, anchorFromFit, fitFor, mergeFit } from '../js/pet-fit.js';

test('coins are points divided by one rate', () => {
  assert.equal(POINTS_PER_COIN, 5);
  assert.equal(coinsFromPoints(5), 1);
  assert.equal(coinsFromPoints(10), 2);
  assert.equal(coinsFromPoints(20), 4);
  assert.equal(coinsFromPoints(10), 2);
  const earned = earnedCoins(
    [{ points: 5 }, { points: 10 }, { points: 20 }],
    [{ points: 10 }, { points: 5 }],
  );
  assert.equal(earned, 1 + 2 + 4 + 2 + 1);
});

test('the wallet never goes below zero when coins were already spent', () => {
  assert.equal(walletBalance([{ points: 20 }], [], 0), 4);
  assert.equal(walletBalance([{ points: 20 }], [], 4), 0);
  assert.equal(walletBalance([], [], 10), 0);
  assert.equal(walletBalance([{ points: 5 }], [{ points: 10 }], 9), 0);
});

test('buying spends coins and wearing does not change the level wallet', () => {
  const start = normalizeWardrobe({});
  const first = buy(start, 'top_hat', 135);
  assert.equal(first.ok, true);
  assert.equal(first.left, 15);
  assert.equal(first.wardrobe.spent, 120);
  assert.equal(first.wardrobe.owned.top_hat.source, 'buy');
  const worn = wear(first.wardrobe, 'top_hat');
  assert.equal(worn.outfit.hat, 'top_hat');
  assert.equal(worn.spent, 120);
  const poor = buy(start, 'top_hat', 40);
  assert.equal(poor.ok, false);
  assert.equal(poor.reason, 'coins');
  assert.equal(poor.need, 80);
});

test('rares unlock from best streak and level and stay free', () => {
  assert.equal(qualifies(itemById('sprout'), { level: 3, best: 0 }), true);
  assert.equal(qualifies(itemById('sprout'), { level: 2, best: 20 }), false);
  assert.equal(qualifies(itemById('flame_band'), { level: 1, best: 7 }), true);
  assert.equal(qualifies(itemById('crown'), { level: 10, best: 0 }), true);
  assert.equal(qualifies(itemById('golden_wings'), { level: 12, best: 99 }), false);
  const quiet = grantQualified(normalizeWardrobe({}), { level: 10, best: 14 }, { celebrate: true });
  assert.deepEqual(quiet.newly, []);
  assert.ok(quiet.wardrobe.owned.sprout);
  assert.ok(quiet.wardrobe.owned.crown);
  assert.ok(quiet.wardrobe.owned.flame_band);
  assert.ok(quiet.wardrobe.owned.star_medal);
  assert.equal(quiet.wardrobe.owned.rainbow_aura, undefined);
  const again = grantQualified(quiet.wardrobe, { level: 10, best: 30 }, { celebrate: true });
  assert.deepEqual(again.newly, ['rainbow_aura']);
  assert.equal(again.wardrobe.spent, 0);
});

test('a saved party hat is kept and old animals still resolve', () => {
  const settings = migrateSettings({
    schemaVersion: 3,
    pet: { animal: 'horse', hat: true },
  });
  assert.equal(settings.pet.animal, 'dog');
  assert.equal(settings.wardrobe.owned.party_hat.source, 'kept');
  assert.equal(settings.wardrobe.outfit.hat, 'party_hat');
  const again = migrateSettings(settings);
  assert.equal(again.wardrobe.outfit.hat, 'party_hat');
});

test('spending coins never spends a level', () => {
  assert.equal(coinsFromPoints(4), 0);
  assert.equal(coinsFromPoints(9), 1);
  const completions = [{ points: 700 }];
  const bonuses = [{ points: 10 }];
  const points = 710;
  const level = levelForPoints(points);
  const balance = walletBalance(completions, bonuses, 0);
  assert.equal(balance, 140 + 2);
  const bought = buy(normalizeWardrobe({}), 'top_hat', balance);
  assert.equal(bought.ok, true);
  assert.equal(bought.wardrobe.spent, 120);
  assert.equal(levelForPoints(points), level);
  assert.equal(walletBalance(completions, bonuses, bought.wardrobe.spent), balance - 120);
  assert.equal(bought.wardrobe.outfit.hat, null);
});

test('one item per slot, and each pet keeps its own closet', () => {
  const owned = {
    beanie: { source: 'buy' },
    cap: { source: 'buy' },
    scarf: { source: 'buy' },
    sunglasses: { source: 'buy' },
  };
  let wardrobe = bindPet(normalizeWardrobe({ owned }), 'dog');
  wardrobe = wear(wardrobe, 'beanie');
  wardrobe = wear(wardrobe, 'cap');
  assert.equal(wardrobe.outfit.hat, 'cap');
  wardrobe = wear(wardrobe, 'scarf');
  wardrobe = saveLook(wardrobe, 'Cozy').wardrobe;
  wardrobe = bindPet(wardrobe, 'cat');
  assert.equal(wardrobe.pet, 'cat');
  assert.equal(wardrobe.outfit.hat, null);
  assert.equal(wardrobe.outfit.neck, null);
  assert.equal(wardrobe.looks.length, 0);
  wardrobe = wear(wardrobe, 'sunglasses');
  wardrobe = bindPet(wardrobe, 'dog');
  assert.equal(wardrobe.outfit.hat, 'cap');
  assert.equal(wardrobe.outfit.neck, 'scarf');
  assert.equal(wardrobe.looks.length, 1);
  assert.equal(wardrobe.looks[0].name, 'Cozy');
  wardrobe = bindPet(wardrobe, 'cat');
  assert.equal(wardrobe.outfit.face, 'sunglasses');
  assert.equal(wardrobe.outfit.hat, null);
  const again = migrateSettings({
    schemaVersion: 4,
    pet: { animal: 'cat' },
    wardrobe,
  });
  assert.equal(again.wardrobe.pet, 'cat');
  assert.equal(again.wardrobe.outfit.face, 'sunglasses');
  assert.equal(again.wardrobe.outfits.dog.hat, 'cap');
});

test('hat seats stay on the Dayli 1.3.2 fits and a fits file can nudge one pet', () => {
  const hats = {
    dog: 0, cat: 0, bunny: -0.02, penguin: 0, monkey: 0, tiger: 0,
    pig: 0, lion: 0, panda: 0, fox: 0, koala: 0, chick: 0,
  };
  for (const [animal, hat] of Object.entries(hats)) {
    assert.equal(fitFor(animal).hat, hat, animal);
  }
  assert.equal(anchorFor('lion', 'hat').brimY, anchorFor('dog', 'hat').brimY);
  assert.equal(anchorFor('lion', 'hat').brimY, HEAD_TOP);
  assert.equal(anchorFor('lion', 'hat').scale, 1);
  assert.equal(anchorFor('penguin', 'hat').brimZ, -0.03);
  assert.equal(anchorFor('chick', 'hat').brimZ, -0.03);
  assert.equal(anchorFor('monkey', 'hat').brimZ, -0.03);
  const bunny = anchorFor('bunny', 'hat');
  assert.ok(bunny.tilt > 0.2);
  assert.ok(bunny.brimZ > 0.3);
  const nudged = mergeFit('lion', { _comment: 'drop-in', lion: { hat: 0.15, hatScale: 0.9 } });
  assert.equal(nudged.hat, 0.15);
  assert.equal(nudged.hatScale, 0.9);
  assert.equal(fitFor('lion').hat, 0);
  assert.equal(anchorFromFit(nudged, 'hat').brimY, HEAD_TOP + 0.15);
  assert.equal(mergeFit('dog', { lion: { hat: 0.15 } }).hat, 0);
});

test('looks stop at three and a try-on does not replace the saved outfit', () => {
  let wardrobe = wear(normalizeWardrobe({ owned: { beanie: { source: 'buy' }, scarf: { source: 'buy' }, cap: { source: 'buy' } } }), 'beanie');
  wardrobe = saveLook(wardrobe, 'Cozy').wardrobe;
  wardrobe = wear(wardrobe, 'scarf');
  wardrobe = saveLook(wardrobe, 'Neck').wardrobe;
  wardrobe = wear(wardrobe, 'cap');
  wardrobe = saveLook(wardrobe, 'Cap').wardrobe;
  const full = saveLook(wardrobe, 'Nope');
  assert.equal(full.ok, false);
  assert.equal(full.wardrobe.looks.length, 3);
  const cleared = resetOutfit(wardrobe);
  assert.equal(cleared.outfit.hat, null);
  const preview = previewOutfit(cleared, 'top_hat');
  assert.equal(preview.hat, 'top_hat');
  assert.equal(cleared.outfit.hat, null);
});
