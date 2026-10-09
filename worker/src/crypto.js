/** Small crypto helpers shared by the Worker and the CLI scripts (Web Crypto only). */

const enc = new TextEncoder();

export function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

/** The only form a code is ever stored in. `code` must be canonical (parseCode().code). */
export function hashCode(pepper, code) {
  return hmacHex(pepper, `calo-code:${code}`);
}

/** Constant-time string comparison (compares HMACs so lengths never leak). */
export async function safeEqual(a, b) {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const [x, y] = await Promise.all([
    crypto.subtle.sign('HMAC', k, enc.encode(String(a))),
    crypto.subtle.sign('HMAC', k, enc.encode(String(b))),
  ]);
  const xa = new Uint8Array(x);
  const ya = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < xa.length; i += 1) diff |= xa[i] ^ ya[i];
  return diff === 0;
}

const ID_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function newCodeId() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let s = 'c_';
  for (const b of bytes) s += ID_ALPHABET[b % 32];
  return s;
}
