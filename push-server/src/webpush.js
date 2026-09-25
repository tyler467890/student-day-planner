/**
 * Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) using Web Crypto only,
 * so it runs in a Cloudflare Worker and in Node's test runner.
 */

const encoder = new TextEncoder();

export function bytesToBase64Url(bytes) {
  const bin = String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToBytes(value) {
  const pad = '='.repeat((4 - (value.length % 4)) % 4);
  const b64 = (value + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts) {
  const len = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(len);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}

async function hkdf(salt, ikm, info, length) {
  const prk = await hmac(salt, ikm);
  const okm = await hmac(prk, concat(info, new Uint8Array([1])));
  return okm.slice(0, length);
}

/**
 * Encrypt a notification body for a subscription's p256dh and auth secrets.
 * Returns the aes128gcm body (header + ciphertext).
 */
export async function encryptPayload(userPublicKey, authSecret, payload) {
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const userKey = await crypto.subtle.importKey('raw', userPublicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: userKey }, local.privateKey, 256));
  const localPub = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyInfo = concat(encoder.encode('WebPush: info\0'), userPublicKey, localPub);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);
  const cekBytes = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);
  const cek = await crypto.subtle.importKey('raw', cekBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const padded = concat(payload, new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cek, padded));
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([localPub.length]), localPub, cipher);
}

/** Decrypt an aes128gcm body. Used by unit tests to prove the payload is readable. */
export async function decryptPayload(body, subscriberPrivateKey, subscriberPublicKey, authSecret) {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const senderPub = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const senderKey = await crypto.subtle.importKey('raw', senderPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: senderKey },
    subscriberPrivateKey,
    256,
  ));
  const keyInfo = concat(encoder.encode('WebPush: info\0'), subscriberPublicKey, senderPub);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);
  const cekBytes = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);
  const cek = await crypto.subtle.importKey('raw', cekBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, cek, cipher));
  let end = plain.length;
  while (end > 0 && plain[end - 1] === 0) end -= 1;
  if (plain[end - 1] !== 2) throw new Error('bad padding delimiter');
  return plain.slice(0, end - 1);
}

export async function vapidJwt(endpoint, privateJwk, subject, nowSec = Math.floor(Date.now() / 1000)) {
  const aud = new URL(endpoint).origin;
  const header = bytesToBase64Url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify({
    aud,
    exp: nowSec + 12 * 60 * 60,
    sub: subject,
  })));
  const data = `${header}.${payload}`;
  const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(data)));
  return `${data}.${bytesToBase64Url(sig)}`;
}

export async function vapidHeaders(endpoint, { publicKey, privateJwk, subject }) {
  const jwt = await vapidJwt(endpoint, privateJwk, subject);
  return {
    Authorization: `vapid t=${jwt}, k=${publicKey}`,
    'Crypto-Key': `p256ecdsa=${publicKey}`,
  };
}

export async function sendWebPush(subscription, payloadObj, vapid) {
  const body = await encryptPayload(
    base64UrlToBytes(subscription.p256dh),
    base64UrlToBytes(subscription.auth),
    encoder.encode(JSON.stringify(payloadObj)),
  );
  const headers = await vapidHeaders(subscription.endpoint, vapid);
  headers.TTL = '3600';
  headers['Content-Encoding'] = 'aes128gcm';
  headers['Content-Type'] = 'application/octet-stream';
  headers.Urgency = 'high';
  return fetch(subscription.endpoint, { method: 'POST', headers, body });
}
