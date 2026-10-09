# Calo

A no-account day planner for students. It runs as a static site (plain HTML, CSS and JavaScript) and keeps every plan on the device.

Calo is also the name of the bunny guide who greets new users, gives a short tour, and pops in now and then with a pep talk.

The app was first built under the working name *Dayli*. Internal storage names (the `dayli` IndexedDB database, `dayli.*` localStorage keys and the `dayli-v` service worker cache prefix) keep that old name on purpose so existing users keep their data. Do not rename them.

## Run it locally

Open a terminal in this folder and serve the files over HTTP. Opening `index.html` as a file will not work: the app uses ES modules, a service worker and IndexedDB.

```bash
python3 -m http.server 4173 --bind 127.0.0.1
```

Then open [http://127.0.0.1:4173/](http://127.0.0.1:4173/).

GitHub Pages serves the same files from a project site, so every path in the app is relative (`./`, not `/`).

## Tests

```bash
npm install
npm test
npx playwright test
```

`npm test` runs the model, push-server and Etsy file checks in Node. Playwright drives Chromium through the acceptance checks.

## Change the product name

The name lives in three places the running app reads:

1. `PRODUCT_NAME` in `js/config.js` — document title, first-run wordmark, About, and notification fallbacks.
2. `name` and `short_name` in `manifest.webmanifest`.
3. `apple-mobile-web-app-title` in `index.html` — iOS reads this before JavaScript runs.

Also update the PDFs in `etsy/` before a listing, if the name changes. The guide's name is `GUIDE_NAME` in `js/config.js`. Search the repo for the old name after editing so nothing visible still shows it (internal storage names excepted).

## Closed-app reminders

`PUSH_SERVER_URL` in `js/config.js` starts empty. The planner still works: reminders fire while the app is open, and missed ones show as “While you were away”.

To send reminders when the app is closed, deploy the Cloudflare Worker in `push-server/` and paste its URL and VAPID public key into `js/config.js`. Exact commands (Wrangler, KV, VAPID keys, secrets) are in [push-server/README.md](push-server/README.md).

## Unlock codes (paid access)

Calo can ask each new device for an Etsy unlock code (`CALO-XXXX-XXXX-XXXX-XXXX`, up to 3 devices per code). It's **off** until `REQUIRE_UNLOCK` in `js/config.js` is set to `true` after the Cloudflare Worker in `worker/` is deployed. Plans still stay on the device: only the code and a random device ID are sent, once. Devices that already have saved data stay unlocked (`UNLOCK_GRANDFATHER_EXISTING`). Step-by-step setup, the admin page, code generation and the honest limits are in [worker/README.md](worker/README.md). Worker tests: `cd worker && npm install && npm test` (Node 22+).

## Pages

Pushes to `main` deploy the static app with GitHub Actions (`.github/workflows/pages.yml`). The live site is [https://tyler467890.github.io/student-day-planner/](https://tyler467890.github.io/student-day-planner/).

The product spec is in `docs/spec.md`.
