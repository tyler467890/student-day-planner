/**
 * Calo unlock codes: format, checksum and generation.
 *
 * Shared by the app (to catch typos before going online), the Worker (to
 * reject junk fast) and the CLI generator. No DOM, no Node-only APIs.
 *
 * A code looks like CALO-7K2P-QX9M-4WTR-8HNC:
 *   - "CALO-" prefix (just branding, not secret)
 *   - 16 characters from a 32-letter alphabet with no 0/O/1/I
 *   - the first 15 are random (crypto.getRandomValues), the 16th is a
 *     Luhn mod 32 check character, so one wrong letter or two swapped
 *     neighbours are caught on the phone before anything is sent.
 * 15 random characters x 5 bits = 75 bits, about 3.8e22 possible codes.
 */

export const CODE_PREFIX = 'CALO';
export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 32 chars, no 0 O 1 I
export const CODE_BODY_LENGTH = 16; // 15 random + 1 check
export const CODE_RANDOM_LENGTH = CODE_BODY_LENGTH - 1;
export const CODE_GROUP = 4;

const N = CODE_ALPHABET.length;

function indexOf(ch) {
  return CODE_ALPHABET.indexOf(ch);
}

/** Luhn mod N check character for a string of alphabet characters. */
export function checkChar(body) {
  let factor = 2;
  let sum = 0;
  for (let i = body.length - 1; i >= 0; i -= 1) {
    const cp = indexOf(body[i]);
    if (cp < 0) throw new Error(`bad character ${body[i]}`);
    let addend = factor * cp;
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / N) + (addend % N);
    sum += addend;
  }
  return CODE_ALPHABET[(N - (sum % N)) % N];
}

function group(body) {
  const parts = [];
  for (let i = 0; i < body.length; i += CODE_GROUP) parts.push(body.slice(i, i + CODE_GROUP));
  return `${CODE_PREFIX}-${parts.join('-')}`;
}

/** Make one code with a CSPRNG. `random` is injectable for tests only. */
export function generateCode(random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))) {
  // 32 divides 256 exactly, so `byte % 32` has no bias.
  const bytes = random(CODE_RANDOM_LENGTH);
  let body = '';
  for (let i = 0; i < CODE_RANDOM_LENGTH; i += 1) body += CODE_ALPHABET[bytes[i] % N];
  return group(body + checkChar(body));
}

export function generateCodes(count, random) {
  const out = new Set();
  while (out.size < count) out.add(generateCode(random));
  return [...out];
}

/**
 * Turn whatever the buyer typed into the canonical form, or explain what's wrong.
 * Accepts lowercase, spaces, missing dashes and a missing CALO prefix.
 * Returns { ok: true, code } or { ok: false, reason: 'empty'|'chars'|'length'|'checksum' }.
 */
export function parseCode(input) {
  let s = String(input ?? '').toUpperCase().replace(/[\s\-_.]/g, '');
  if (!s) return { ok: false, reason: 'empty' };
  // Codes never contain O, so a leading "CALO" is always the prefix.
  if (s.startsWith(CODE_PREFIX)) s = s.slice(CODE_PREFIX.length);
  if ([...s].some((ch) => indexOf(ch) < 0)) return { ok: false, reason: 'chars' };
  if (s.length !== CODE_BODY_LENGTH) return { ok: false, reason: 'length' };
  const body = s.slice(0, CODE_RANDOM_LENGTH);
  if (checkChar(body) !== s[CODE_RANDOM_LENGTH]) return { ok: false, reason: 'checksum' };
  return { ok: true, code: group(s) };
}

export function isValidCode(input) {
  return parseCode(input).ok;
}

/** Friendly message for a parse failure (shown under the input). */
export function parseMessage(reason) {
  switch (reason) {
    case 'empty': return 'Type the code from your Etsy download.';
    case 'chars': return 'Codes never use 0, O, 1 or I. Check those letters and try again.';
    case 'length': return 'That code looks too short or too long. It has 16 letters and numbers after CALO.';
    case 'checksum': return 'That code has a typo somewhere. Check each letter and try again.';
    default: return 'That code doesn’t look right.';
  }
}
