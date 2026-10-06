import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { itemById } from '../js/shop.js';

const fits = JSON.parse(readFileSync(new URL('../items/v2/fits.json', import.meta.url)));
const shipped = new Set(readdirSync(new URL('../items/v2/', import.meta.url)).filter((name) => name.endsWith('.glb')));

test('v2 fits keep the 1.3.2 hat seats and skip the designer sweater', () => {
  assert.equal(fits.items.sweater, undefined);
  assert.equal(shipped.has('sweater.glb'), false);
  assert.equal([...shipped].some((name) => name.startsWith('sweater')), false);
  const party = fits.items.party_hat;
  assert.equal(party.default.file, 'party_hat.glb');
  assert.deepEqual(party.pets.dog.position, [0, 1.431, 0]);
  assert.deepEqual(party.pets.bunny.position, [0, 1.411, 0.5]);
  assert.deepEqual(party.pets.bunny.rotation, [0.38, 0, 0]);
  assert.equal(party.pets.bunny.scale, 0.66);
  assert.equal(party.pets.penguin.position[2], -0.03);
  assert.equal(party.pets.chick.position[2], -0.03);
  assert.equal(party.pets.monkey.position[2], -0.03);
  // Lion hats sit on the mane: lifted, tipped up, and a hair larger than 1.3.2.
  assert.deepEqual(party.pets.lion.position, [0, 1.561, 0]);
  assert.deepEqual(party.pets.lion.rotation, [-0.06, 0, 0]);
  assert.equal(party.pets.lion.scale, 1.04);
  assert.equal(fits.items.top_hat.default.file, null);
  for (const name of shipped) assert.equal(name.startsWith('sweater'), false);
});

test('every v2 fit file is on disk and shop framing matches the new hats', () => {
  for (const [id, entry] of Object.entries(fits.items)) {
    const files = new Set();
    if (entry.default?.file) files.add(entry.default.file);
    for (const pet of Object.values(entry.pets || {})) {
      if (pet.file) files.add(pet.file);
    }
    if (id === 'top_hat') {
      assert.equal(files.size, 0);
      continue;
    }
    assert.ok(files.size > 0, id);
    for (const file of files) assert.equal(existsSync(new URL(`../items/v2/${file}`, import.meta.url)), true, file);
  }
  assert.equal(itemById('party_hat').rise, 0.96);
  assert.equal(itemById('wizard_hat').rise, 1.06);
  assert.equal(itemById('beanie').rise, 0.74);
  assert.equal(itemById('sprout').rise, 0.54);
  assert.equal(itemById('flame_band').rise, 0.4);
  assert.equal(itemById('crown').rise, 0.37);
  assert.equal(itemById('cap').rise, 0.28);
  assert.equal(itemById('grad_cap').rise, 0.26);
  assert.equal(itemById('flower_crown').rise, 0.12);
});
