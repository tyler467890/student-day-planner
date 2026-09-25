# Dayli

A no-account day planner for students. It runs as a static site (plain HTML, CSS and JavaScript) and keeps every plan on the device.

The name **Dayli** is a working title. It is not final.

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

The working name lives in three places the running app reads:

1. `PRODUCT_NAME` in `js/config.js` — document title, first-run wordmark, About, and notification fallbacks.
2. `name` and `short_name` in `manifest.webmanifest`.
3. `apple-mobile-web-app-title` in `index.html` — iOS reads this before JavaScript runs.

Also update the PDFs in `etsy/` before a listing, if the name changes. Search the repo for `Dayli` after editing those three so nothing else still shows the old name.

## Closed-app reminders

`PUSH_SERVER_URL` in `js/config.js` starts empty. The planner still works: reminders fire while the app is open, and missed ones show as “While you were away”.

To send reminders when the app is closed, deploy the Cloudflare Worker in `push-server/` and paste its URL and VAPID public key into `js/config.js`. Exact commands (Wrangler, KV, VAPID keys, secrets) are in [push-server/README.md](push-server/README.md).

## Pages

Pushes to `main` deploy the static app with GitHub Actions (`.github/workflows/pages.yml`). The live site is [https://tyler467890.github.io/student-day-planner/](https://tyler467890.github.io/student-day-planner/).

The product spec is in `docs/spec.md`.
