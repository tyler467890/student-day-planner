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
