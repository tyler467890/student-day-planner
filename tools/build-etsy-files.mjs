#!/usr/bin/env node
/**
 * Rebuild the Etsy download PDFs in etsy/ from the HTML in tools/etsy/.
 *
 *   node tools/build-etsy-files.mjs
 *
 * Edit tools/etsy/start-here.html or quick-guide.html (shared styles in
 * etsy.css), run this, look at the PDFs, and commit them. Uses the Playwright
 * Chromium that the UI tests already install (npx playwright install chromium).
 * Add --png to also write page previews next to the PDFs in /tmp/etsy-previews.
 * The wallpaper zip is built separately.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'tools', 'etsy');
const out = path.join(root, 'etsy');
const files = [
  ['start-here.html', 'Calo-Start-Here.pdf'],
  ['quick-guide.html', 'Calo-Quick-Guide.pdf'],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [html, pdf] of files) {
  await page.goto(pathToFileURL(path.join(src, html)).href);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth));
  await page.pdf({ path: path.join(out, pdf), format: 'Letter', printBackground: true, preferCSSPageSize: true });
  console.log('Wrote', path.join('etsy', pdf));
}
if (process.argv.includes('--png')) {
  const dir = '/tmp/etsy-previews';
  mkdirSync(dir, { recursive: true });
  const shot = await browser.newPage({ viewport: { width: 816, height: 1056 }, deviceScaleFactor: 2 });
  for (const [html] of files) {
    await shot.goto(pathToFileURL(path.join(src, html)).href);
    await shot.evaluate(() => document.fonts.ready);
    await shot.screenshot({ path: path.join(dir, html.replace('.html', '.png')), fullPage: true });
  }
}
await browser.close();
