#!/usr/bin/env node
/**
 * Make unlock codes on your own computer (the admin page can do this too).
 *
 *   CODE_PEPPER='same value as the Worker secret' node scripts/generate-codes.js 20 "Etsy batch Oct 9"
 *
 * Writes two files into worker/codes-out/ (ignored by git):
 *   calo-codes-<time>.csv   the plain codes, to paste into Etsy orders. Keep private.
 *   calo-codes-<time>.sql   only the hashes, to load into the database with:
 *     npx wrangler d1 execute calo-unlock --remote --file=codes-out/calo-codes-<time>.sql
 * Add --print to also show the codes in the terminal.
 */
import fs from 'node:fs';
import path from 'node:path';
import { generateCodes } from '../../js/unlock-code.js';
import { hashCode, newCodeId } from '../src/crypto.js';

const args = process.argv.slice(2).filter((a) => a !== '--print');
const print = process.argv.includes('--print');
const count = Number(args[0] || 10);
const note = String(args[1] || '').slice(0, 200);
const pepper = process.env.CODE_PEPPER;
const maxDevices = Number(process.env.MAX_DEVICES || 3);

if (!pepper || pepper.length < 16) {
  console.error('Set CODE_PEPPER to the same value as the Worker secret (16+ characters).');
  process.exit(1);
}
if (!(Number.isInteger(count) && count >= 1 && count <= 5000)) {
  console.error('Usage: node scripts/generate-codes.js <count 1-5000> ["note"]');
  process.exit(1);
}

const sql = (s) => `'${String(s).replace(/'/g, "''")}'`;
const csvCell = (s) => (/[",\n\r]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
const now = Math.floor(Date.now() / 1000);
const created = new Date(now * 1000).toISOString();
const csv = ['code,id,note,created'];
const inserts = [];
for (const code of generateCodes(count)) {
  const id = newCodeId();
  csv.push([code, id, note, created].map(csvCell).join(','));
  inserts.push(`INSERT INTO codes (id, hash, created_at, note, max_devices) VALUES (${sql(id)}, ${sql(await hashCode(pepper, code))}, ${now}, ${sql(note)}, ${maxDevices});`);
}

const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'codes-out');
fs.mkdirSync(dir, { recursive: true });
const stamp = created.replace(/[:.]/g, '-');
const csvPath = path.join(dir, `calo-codes-${stamp}.csv`);
const sqlPath = path.join(dir, `calo-codes-${stamp}.sql`);
fs.writeFileSync(csvPath, `${csv.join('\n')}\n`, { mode: 0o600 });
fs.writeFileSync(sqlPath, `${inserts.join('\n')}\n`);
if (print) console.log(csv.slice(1).map((l) => l.split(',')[0]).join('\n'));
console.log(`Made ${count} codes.
  Codes (private): ${csvPath}
  Hashes for the database: ${sqlPath}
Load them with:
  npx wrangler d1 execute calo-unlock --remote --file=${path.relative(process.cwd(), sqlPath)}`);
