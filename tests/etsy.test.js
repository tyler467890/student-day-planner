import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, stat, readFile } from 'node:fs/promises';
import path from 'node:path';

const dir = path.resolve('etsy');
const src = path.resolve('tools/etsy');
const allowed = new Set(['.pdf', '.zip', '.png', '.jpg', '.jpeg']);

test('Etsy download files stay within listing limits', async () => {
  const names = await readdir(dir);
  assert.ok(names.length > 0 && names.length <= 5);
  assert.ok(names.includes('Calo-Start-Here.pdf'));
  assert.ok(names.includes('Calo-Quick-Guide.pdf'));
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
  const pdf = (await readFile(path.join(dir, 'Calo-Start-Here.pdf'))).toString('latin1');
  assert.match(pdf, /\/URI \(https:\/\/caloplanner\.com\/?\)/);
  assert.doesNotMatch(pdf, /github\.io/);
  // The PDF text is compressed, so check the source it is built from.
  const html = await readFile(path.join(src, 'start-here.html'), 'utf8');
  assert.match(html, /href="https:\/\/caloplanner\.com"/);
  assert.match(html, /up to 3 of your devices/);
  assert.match(html, /within 24 hours/);
  assert.match(html, /Message seller/);
  assert.match(html, /don't share it/);
  assert.match(html, /reset your code/);
  assert.match(html, /don't sync/);
  assert.match(html, /Back up now/);
  assert.match(html, /Add Calo to your Home Screen first/);
  assert.doesNotMatch(html, /github\.io/);
  assert.doesNotMatch(html, /QR/i);
  assert.doesNotMatch(html, /upsell|buy now|shop now|subscribe/i);
});

test('Quick Guide does not overpromise reminders', async () => {
  const html = await readFile(path.join(src, 'quick-guide.html'), 'utf8');
  assert.doesNotMatch(html, /usually arrive on time/i);
  assert.match(html, /Reminders work while Calo is open/);
});
