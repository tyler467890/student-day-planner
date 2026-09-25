/**
 * Generate a VAPID key pair for Dayli.
 * Run from the repo root or from push-server:
 *   node push-server/scripts/generate-vapid.js
 *
 * Put the public key in js/config.js (VAPID_PUBLIC_KEY).
 * Put the private JWK in the Worker secret VAPID_PRIVATE_KEY (one line).
 * Put the same public key in the Worker secret VAPID_PUBLIC_KEY.
 */

const { subtle } = globalThis.crypto;

const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const privateJwk = await subtle.exportKey('jwk', pair.privateKey);
const publicRaw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
const publicKey = Buffer.from(publicRaw).toString('base64url');

console.log('VAPID public key (js/config.js and Worker secret VAPID_PUBLIC_KEY):');
console.log(publicKey);
console.log('');
console.log('VAPID private JWK (Worker secret VAPID_PRIVATE_KEY, paste as one line):');
console.log(JSON.stringify(privateJwk));
