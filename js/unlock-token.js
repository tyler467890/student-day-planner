/**
 * Signed unlock tokens. Shared by the app (verify) and the Worker (sign).
 *
 * Token = base64url(JSON payload) + "." + base64url(ECDSA P-256 signature)
 * payload = { v: 1, cid: <code id>, did: <device id>, iat: <unix seconds> }
 *
 * Only the Worker has the private key, so only the Worker can make a token.
 * The app holds the public key (js/config.js) and checks the signature and
 * that the token belongs to this device's ID. That check is local, so an
 * unlocked phone stays unlocked offline.
 * ECDSA P-256 is used (not Ed25519) because every browser Calo supports has it.
 */

const ALG = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };
const enc = new TextEncoder();
const dec = new TextDecoder();

export function bytesToB64u(bytes) {
  let bin = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 1) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64uToBytes(s) {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** Random device ID: 16 bytes from the CSPRNG, base64url (22 chars). */
export function newDeviceId() {
  return bytesToB64u(globalThis.crypto.getRandomValues(new Uint8Array(16)));
}

export function isDeviceId(s) {
  return typeof s === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(s);
}

export async function importPublicKey(jwk) {
  const { kty, crv, x, y } = jwk || {};
  return globalThis.crypto.subtle.importKey('jwk', { kty, crv, x, y, ext: true }, ALG, false, ['verify']);
}

export async function importPrivateKey(jwk) {
  const parsed = typeof jwk === 'string' ? JSON.parse(jwk) : jwk;
  return globalThis.crypto.subtle.importKey('jwk', parsed, ALG, false, ['sign']);
}

export async function signToken(privateKey, payload) {
  const body = bytesToB64u(enc.encode(JSON.stringify(payload)));
  const sig = await globalThis.crypto.subtle.sign(SIGN, privateKey, enc.encode(body));
  return `${body}.${bytesToB64u(sig)}`;
}

/**
 * Check a token. Returns the payload when the signature is valid and it was
 * issued for `deviceId`, otherwise null. Never throws.
 */
export async function verifyToken(publicKeyOrJwk, token, deviceId) {
  try {
    if (typeof token !== 'string' || !isDeviceId(deviceId)) return null;
    const [body, sig, extra] = token.split('.');
    if (!body || !sig || extra !== undefined) return null;
    const key = publicKeyOrJwk?.type === 'public' ? publicKeyOrJwk : await importPublicKey(publicKeyOrJwk);
    const ok = await globalThis.crypto.subtle.verify(SIGN, key, b64uToBytes(sig), enc.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(b64uToBytes(body)));
    if (payload?.v !== 1 || payload.did !== deviceId || typeof payload.cid !== 'string') return null;
    return payload;
  } catch {
    return null;
  }
}

/** Make a fresh signing key pair (used by worker/scripts/generate-signing-key.js and tests). */
export async function generateSigningKeys() {
  const pair = await globalThis.crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
  const priv = await globalThis.crypto.subtle.exportKey('jwk', pair.privateKey);
  const pub = await globalThis.crypto.subtle.exportKey('jwk', pair.publicKey);
  return {
    privateJwk: { kty: priv.kty, crv: priv.crv, x: priv.x, y: priv.y, d: priv.d },
    publicJwk: { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y },
  };
}
