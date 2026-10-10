# Calo unlock codes

This folder is a small Cloudflare Worker that checks Etsy unlock codes. It
runs at **https://api.caloplanner.com** and the lock is **on** (since
Oct 10, 2026): new devices on caloplanner.com need a code.

## Give a buyer their code (the everyday job)

1. Open **https://api.caloplanner.com/admin** (phone or computer).
2. The first time on that device, type the admin password and keep
   "Remember on this device" ticked. It's saved only in that browser, for that
   site. **Sign out** forgets it.
3. Optionally type the Etsy order number or the buyer's name as a note.
4. Tap **New code**, then **Copy message**. It copies a friendly message with
   the code, the link https://caloplanner.com and "works on up to 3 of your
   devices".
5. In Etsy: Orders & Shipping, open the order, message the buyer, paste, send.

The code is shown only once (the Worker keeps a scrambled version), so copy
it before leaving the page. The **Issued codes** list shows each code's note,
date and devices used, with **Reset devices** (buyer got a new phone) and
**Block** (refund or a code shared online).

The admin password is stored on the box in `/home/box/.calo/admin_key`
(mode 600). Keep a copy in your password manager.

## How it works (plain words)

1. Each Etsy buyer gets their own code, like `CALO-7K2P-QX9M-4WTR-8HNC`.
   It has 16 letters and numbers after `CALO`. Codes never use 0, O, 1 or I,
   so they're easy to read. The last character is a check letter, so a typo
   is caught on the phone right away.
2. The first time someone opens Calo, Calo the bunny hops in, waves and says
   "Hi! I'm Calo. Enter your code to open your planner." (about 2 seconds;
   no animation with reduced motion; a tap skips it). They type the code once.
3. The app sends the code and a random device ID (made on that phone) to this
   Worker. The Worker checks the code and remembers the device. One code works
   on up to **3 devices**. The 4th gets: "This code is already on 3 devices.
   Contact support to reset it."
4. The Worker sends back a signed "unlock ticket". The app checks the signature
   with a public key that's built into the app, saves the ticket, and stays
   unlocked on that device for good, even offline.

What's stored online: a scrambled version of each code (HMAC-SHA-256 with a
secret "pepper"), how many devices use it, and the random device IDs. No names,
emails or plain codes. Wrong guesses are limited: **5 wrong tries per 15
minutes** per internet address, and a code that keeps hitting its device limit
is paused for 15 minutes too. With about 38,000,000,000,000,000,000,000
possible codes, guessing one is not realistic.

People who already used Calo (anyone with saved goals or a finished setup on
that website address) stayed unlocked automatically when the lock went on, so
your testers aren't locked out. Set `UNLOCK_GRANDFATHER_EXISTING = false` in `js/config.js` if you
want everyone to enter a code.

## What you need

- A free Cloudflare account. The free plan is enough.
- **Node.js 22 or newer** from https://nodejs.org (the LTS button). Check with
  `node -v` in a terminal.

All commands below are typed in a terminal (VS Code: Terminal > New Terminal)
inside this `worker` folder: `cd worker`.

## Current state (Oct 10, 2026)

Everything below is **done** and the lock is on:

- Worker: `https://api.caloplanner.com` (custom domain, in `wrangler.toml`
  `routes`). The old `https://calo-unlock.tyler467890.workers.dev` address
  still works. `/health` shows `{"ok":true}`.
- App: `https://caloplanner.com` (Cloudflare Pages project `calo`) and the
  older GitHub Pages copy. Both have `REQUIRE_UNLOCK = true`.
- Storage: one SQLite-backed Durable Object (`CaloStore`, free plan). Not KV
  and not D1: KV is eventually consistent, so two phones unlocking at the same
  moment could both get slot 3, and the Cloudflare API token on the box can't
  create D1 databases. The Durable Object handles one request at a time, so the
  3-device limit and the wrong-guess counters are exact.
- Secrets `CODE_PEPPER`, `UNLOCK_SIGNING_KEY` and `ADMIN_PASSWORD` are set on
  the Worker. Copies live only on the box in `/home/box/.calo/` (mode 600):
  `code_pepper`, `signing_key_private.jwk`, `signing_key_public.jwk`,
  `admin_key` (this is the admin password). Save them in your password manager.
  **If the pepper or signing key is lost, sold codes stop working.**
- `js/config.js` has `REQUIRE_UNLOCK = true`,
  `UNLOCK_API_URL = 'https://api.caloplanner.com'`, `UNLOCK_PUBLIC_KEY` and
  `UNLOCK_GRANDFATHER_EXISTING = true`.
- All test codes made during setup are blocked.

## Redo or change the setup

Commands run inside this `worker` folder with Node 22+ and Wrangler logged in.

1. Keys (only for a brand-new setup; changing them breaks sold codes):
   `node scripts/generate-signing-key.js`, then
   `npx wrangler secret put UNLOCK_SIGNING_KEY`, `CODE_PEPPER` and
   `ADMIN_PASSWORD` (12+ characters). Put the public key in `js/config.js`.
2. `ALLOWED_ORIGINS` in `wrangler.toml` lists the sites allowed to unlock:
   `https://tyler467890.github.io`, `https://caloplanner.com` and
   `https://www.caloplanner.com`. After the move, remove the github.io one and
   run `npx wrangler deploy`.
3. (Done.) The Worker's own address is in `wrangler.toml`:

   ```toml
   routes = [{ pattern = "api.caloplanner.com", custom_domain = true }]
   ```

   run `npx wrangler deploy` (Cloudflare makes the DNS record and certificate),
   check `https://api.caloplanner.com/health`, then set
   `UNLOCK_API_URL = 'https://api.caloplanner.com'` in `js/config.js`. Keep the
   workers.dev address working too: devices that are already unlocked never
   call it again, but anyone mid-setup on an old cached version still might.

## Make codes

**Admin page:** see "Give a buyer their code" at the top. For a batch, open
**More** on the admin page, choose how many codes and a note, click **Make
codes + CSV**, then **Download CSV**. Codes are shown **only once**, because
the Worker only keeps scrambled versions.

**Or from a terminal** (reads the admin key from `~/.calo/admin_key`, never
from the command line):

```
node scripts/generate-codes.js 20 "Etsy batch Oct 10"
```

The codes are saved to `~/.calo/codes/calo-codes-<time>.csv` (private, outside
the repo). Add `--print` to show them in the terminal too.

Etsy gives every buyer the same download files, so a per-buyer code can't go
inside the PDF. Send each buyer their code in the Etsy order message.

### The lock switch

`REQUIRE_UNLOCK` in `js/config.js` is `true`. After changing anything in the
app, bump `CACHE` in `sw.js`, merge to `main` (GitHub Pages updates itself)
and redeploy Cloudflare Pages (below). Open the app in a private window: you
should see Calo's greeting and the code field. A device with saved goals
stays unlocked.

### Deploy caloplanner.com (Cloudflare Pages project `calo`)

From a clean checkout of `main`, with Node 22+ and a Cloudflare API token:

```
mkdir -p _site && cp index.html manifest.webmanifest sw.js robots.txt _site/ && cp -r css js fonts icons pets-preview sounds items data _site/ && cp -aL models _site/models && cp -aL vendor _site/vendor
npx wrangler pages deploy _site --project-name calo --branch main
```

**Safety net:** if `UNLOCK_API_URL` or `UNLOCK_PUBLIC_KEY` is empty, the app
stays open even with `REQUIRE_UNLOCK = true`, so a half-finished setup never
locks people out. To turn the lock off again, set it back to `false` and merge.

## Helping a buyer (admin page)

- **Find them:** search the Issued codes list by the note (order number or
  name), or use **More > Look up** with their code or the `c_...` id.
- **Reset devices:** frees all 3 slots so they can unlock new devices. Their
  old devices stay unlocked, because tickets are checked offline.
- **Block code:** for refunds or a code posted online. It stops the code from
  unlocking any *new* devices. Devices already unlocked keep working.

Wrong admin passwords are limited to 5 per 15 minutes.

Good to know: on iPhone, Safari and the home-screen app keep separate storage.
If a buyer unlocks in Safari and then adds Calo to the home screen, that uses
2 of their 3 slots. Suggest in the PDF: "Add Calo to your home screen first,
then open it and enter your code."

## Tests

```
npm test          # Worker tests in a local Cloudflare runtime (no account needed)
```

From the main folder: `npm test` (unit tests) and `npx playwright test`
(app tests, including the unlock screen with a pretend server).

## Honest limits, and the next step

This stops casual sharing: someone can't just Google the site and use it, and
codes can't be guessed. It is **not** uncrackable:

- **The app's code is public.** The repo is public and the site is on GitHub
  Pages, so a skilled person could download the app and remove the lock from
  their own copy. No web app can fully prevent this, but you can make it much
  harder.
- Someone could copy the saved ticket and device ID from an unlocked browser
  to another one. That takes developer tools and only moves an existing unlock.
- Resetting or blocking a code doesn't re-lock devices that already unlocked.
- Rate limits are per internet address. A determined attacker with many
  addresses gets more tries, but the number of codes makes guessing hopeless
  anyway.

**Recommended later (once sales are coming in): make the GitHub repo
private.** caloplanner.com is already on Cloudflare Pages (steps 1 to 4 below are done). GitHub's free plan can't serve a
site from a private repo, but Cloudflare Pages can:

1. caloplanner.com is registered at Porkbun (Oct 10, 2026). Add it to
   Cloudflare and switch its nameservers at Porkbun to the two Cloudflare gives you.
2. Cloudflare dashboard > **Workers & Pages** > **Create** > **Pages** >
   **Connect to Git**. Pick `student-day-planner`, branch `main`, and use the
   same copy step as the GitHub Pages workflow (the `models` folder is a link,
   so it has to be copied this way):
   - Build command:
     `mkdir -p _site && cp index.html manifest.webmanifest sw.js robots.txt _site/ && cp -r css js fonts icons pets-preview sounds items data _site/ && cp -aL models _site/models && cp -aL vendor _site/vendor`
   - Build output directory: `_site`
3. In the Pages project: **Custom domains** > add `caloplanner.com` and `www.caloplanner.com`.
4. Check the app works on `https://caloplanner.com`, then unlock it there with a code.
   (Each website address keeps its own data, so users moving from the
   github.io address would need to unlock again and won't see their old goals
   there. Do this move before you have many users.)
5. In GitHub: repo **Settings** > **Pages**: turn GitHub Pages off. Then
   **Settings** > **General** > **Danger Zone** > **Change visibility** >
   **Private**.
6. Remove `https://tyler467890.github.io` from `ALLOWED_ORIGINS` and run
   `npx wrangler deploy` again.

The app's files can still be downloaded from caloplanner.com, as with any website, but
they're no longer sitting in a public repo with history and comments, and the
lock is the only door.
