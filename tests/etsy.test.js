import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, stat, readFile } from 'node:fs/promises';
import path from 'node:path';

const dir = path.resolve('etsy');
const allowed = new Set(['.pdf', '.zip', '.png', '.jpg', '.jpeg']);

test('Etsy download files stay within listing limits', async () => {
  const names = await readdir(dir);
  assert.ok(names.length > 0 && names.length <= 5);
  for (const name of names) {
    assert.match(name, /^[A-Za-z0-9._-]+$/);
    assert.ok(name.length <= 70, name);
    const ext = path.extname(name).toLowerCase();
    assert.ok(allowed.has(ext), name);
    const info = await stat(path.join(dir, name));
    assert.ok(info.size <= 20 * 1024 * 1024, name);
  }
});

test('Start-Here PDF links to the app and has no QR code or upsell', async () => {
  const bytes = await readFile(path.join(dir, 'Start-Here.pdf'));
  const text = bytes.toString('latin1');
  assert.match(text, /https:\/\/tyler467890\.github\.io\/student-day-planner\//);
  assert.doesNotMatch(text, /QR/i);
  assert.doesNotMatch(text, /upsell|buy now|shop now|subscribe/i);
  assert.match(text, /\/URI/);
});
