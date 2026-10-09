/**
 * Calo configuration.
 *
 * PRODUCT NAME
 * Internal storage names (the 'dayli' IndexedDB database, 'dayli.*'
 * localStorage keys and the 'dayli-v' cache prefix) keep the old working
 * name on purpose so existing users keep their data. Do not rename them.
 * Change it in BOTH of these places:
 *   1. PRODUCT_NAME below — the running app reads this for the document
 *      title, the first-run heading, About, and notification fallbacks.
 *   2. "name" and "short_name" in manifest.webmanifest (and the
 *      apple-mobile-web-app-title meta tag in index.html, which iOS reads
 *      before JavaScript runs).
 * The Etsy PDFs in /etsy also print the name. Update those before listing
 * if the name changes.
 *
 * CLOSED-APP REMINDERS
 * Leave PUSH_SERVER_URL as an empty string and the app works normally:
 * reminders still fire while Calo is open, and missed ones show up as
 * "While you were away". Closed-app push is skipped.
 * After you deploy /push-server, paste the worker URL and the VAPID public
 * key here. Steps are in push-server/README.md.
 */

export const PRODUCT_NAME = 'Calo';

/**
 * GUIDE (the bunny who gives the tour and pops in with pep talks).
 * Rename him here: one line. If the app is renamed after him, change
 * PRODUCT_NAME above too (plus the manifest and index.html, as listed).
 */
export const GUIDE_NAME = 'Calo';
export const APP_VERSION = '1.4.0';

/** @type {string} Empty string disables closed-app push. */
export const PUSH_SERVER_URL = '';

/** Base64url uncompressed P-256 public key. Empty when push is off. */
export const VAPID_PUBLIC_KEY = '';

/**
 * UNLOCK CODES (paid access). Off until the unlock Worker is deployed.
 * Steps are in worker/README.md. While REQUIRE_UNLOCK is false, nothing
 * changes for anyone. If it's true but UNLOCK_API_URL or UNLOCK_PUBLIC_KEY
 * is still empty, the app stays open (so a half-finished setup can't lock
 * people out).
 */
export const REQUIRE_UNLOCK = false;

/** The Worker's address, e.g. 'https://calo-unlock.yourname.workers.dev'. No trailing slash. */
export const UNLOCK_API_URL = '';

/**
 * The public half of the signing key, printed by
 *   node worker/scripts/generate-signing-key.js
 * Paste the object it prints, e.g. { kty: 'EC', crv: 'P-256', x: '...', y: '...' }.
 * It's safe to be public: it can only CHECK unlock tokens, not make them.
 */
export const UNLOCK_PUBLIC_KEY = null;

/**
 * Devices that already have saved planner data (finished setup or any goal)
 * the first time they open a version with REQUIRE_UNLOCK on stay unlocked
 * for good, so current testers aren't locked out. Set to false to make
 * everyone enter a code.
 */
export const UNLOCK_GRANDFATHER_EXISTING = true;

/** Shown in the "already on 3 devices" message, e.g. 'hello@calo.ca'. Optional. */
export const UNLOCK_SUPPORT_CONTACT = '';
