#!/usr/bin/env node
/**
 * Make the key pair that signs unlock tokens. Run once:
 *   node scripts/generate-signing-key.js
 * - The PRIVATE key goes into the Worker as a secret (never into git or the app).
 * - The PUBLIC key goes into js/config.js as UNLOCK_PUBLIC_KEY.
 * Also prints a random CODE_PEPPER you can use.
 */
import { generateSigningKeys } from '../../js/unlock-token.js';

const { privateJwk, publicJwk } = await generateSigningKeys();
const pepper = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');

console.log(`
1) PRIVATE signing key (secret). Run:
     npx wrangler secret put UNLOCK_SIGNING_KEY
   and paste this whole line when it asks:

${JSON.stringify(privateJwk)}

2) PUBLIC key. In js/config.js replace "export const UNLOCK_PUBLIC_KEY = null;" with:

export const UNLOCK_PUBLIC_KEY = ${JSON.stringify(publicJwk)};

3) A random CODE_PEPPER (secret). Run:
     npx wrangler secret put CODE_PEPPER
   and paste:

${pepper}

Save the private key and pepper in your password manager. If you lose the
pepper, existing codes stop working. Don't post these anywhere.
`);
