#!/usr/bin/env node
/**
 * Make a batch of unlock codes through the live Worker's admin API
 * (the /admin page in a browser does the same thing).
 *
 *   node scripts/generate-codes.js 20 "Etsy order 1234"
 *
 * Reads the admin key from a file, never from the command line, so it
 * doesn't end up in shell history:
 *   CALO_ADMIN_KEY_FILE   default ~/.calo/admin_key
 *   CALO_UNLOCK_URL       default https://calo-unlock.tyler467890.workers.dev
 * Writes the plain codes to ~/.calo/codes/calo-codes-<time>.csv (private,
 * mode 600, outside the repo). Add --print to also show them in the terminal.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2).filter((a) => a !== '--print');
const print = process.argv.includes('--print');
const count = Number(args[0] || 1);
const note = String(args[1] || '').slice(0, 200);
const base = (process.env.CALO_UNLOCK_URL || 'https://calo-unlock.tyler467890.workers.dev').replace(/\/+$/, '');
const keyFile = process.env.CALO_ADMIN_KEY_FILE || path.join(os.homedir(), '.calo', 'admin_key');

if (!(Number.isInteger(count) && count >= 1 && count <= 500)) {
  console.error('Usage: node scripts/generate-codes.js <count 1-500> ["note"] [--print]');
  process.exit(1);
}
let key;
try { key = fs.readFileSync(keyFile, 'utf8').trim(); } catch {
  console.error(`Can't read the admin key file: ${keyFile}`);
  process.exit(1);
}

const res = await fetch(`${base}/admin/api/generate`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
  body: JSON.stringify({ count, note }),
});
const data = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`The Worker said no (${res.status}): ${data.message || data.error || 'unknown error'}`);
  process.exit(1);
}

const dir = path.join(os.homedir(), '.calo', 'codes');
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const file = path.join(dir, `calo-codes-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
fs.writeFileSync(file, `${data.csv}\n`, { mode: 0o600 });
if (print) console.log(data.codes.map((c) => c.code).join('\n'));
console.log(`Made ${data.codes.length} code(s). Saved privately to ${file}`);
