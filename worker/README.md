# Calo unlock codes

This folder is a small Cloudflare Worker that checks Etsy unlock codes. It is
**not switched on yet**. Until you finish the steps below, Calo works exactly
as it does today for everyone.

## How it works (plain words)

1. Each Etsy buyer gets their own code, like `CALO-7K2P-QX9M-4WTR-8HNC`.
   It has 16 letters and numbers after `CALO`. Codes never use 0, O, 1 or I,
   so they're easy to read. The last character is a check letter, so a typo
   is caught on the phone right away.
2. The first time someone opens Calo, Calo the bunny says "Enter your code to
   get started!". They type the code once.
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

People who already use Calo (anyone with saved goals or a finished setup) stay
unlocked automatically when you switch the lock on, so your testers aren't
locked out. Set `UNLOCK_GRANDFATHER_EXISTING = false` in `js/config.js` if you
want everyone to enter a code.

## What you need

- A free Cloudflare account. The free plan is enough.
- **Node.js 22 or newer** from https://nodejs.org (the LTS button). Check with
  `node -v` in a terminal.
- About 30 minutes.

All commands below are typed in a terminal (VS Code: Terminal > New Terminal)
inside this `worker` folder: `cd worker`.

## Switch it on, step by step

### 1. Create a Cloudflare account and log in

1. Sign up at https://dash.cloudflare.com/sign-up and turn on two-step login.
2. In the terminal:

   ```
   npm install
   npx wrangler login
   ```

   A browser window opens. Click **Allow**.

### 2. Create the database

```
npx wrangler d1 create calo-unlock
```

It prints a `database_id`. Open `wrangler.toml` and paste it over
`replace-with-d1-database-id`. Then create the tables:

```
npx wrangler d1 migrations apply calo-unlock --remote
```

### 3. Make your keys and set the secrets

```
node scripts/generate-signing-key.js
```

It prints three things. **Save all of them in your password manager.**

1. The private key. Run `npx wrangler secret put UNLOCK_SIGNING_KEY` and
   paste the whole `{"kty":"EC",...,"d":"..."}` line.
2. The public key line, `export const UNLOCK_PUBLIC_KEY = {...};`. You'll paste
   it into `js/config.js` in step 5. It's fine for this one to be public.
3. A random pepper. Run `npx wrangler secret put CODE_PEPPER` and paste it.
   **If you lose or change the pepper, every code you've sold stops working.**

Then choose an admin password, at least 12 characters, different from your
other passwords:

```
npx wrangler secret put ADMIN_PASSWORD
```

### 4. Deploy the Worker

Check `ALLOWED_ORIGINS` in `wrangler.toml`. It lists the websites allowed to
unlock: your GitHub Pages address plus `calo.ca` and `www.calo.ca`. Add or
remove addresses with commas. Then:

```
npx wrangler deploy
```

It prints your Worker's address, like
`https://calo-unlock.<your-name>.workers.dev`. Open
`https://calo-unlock.<your-name>.workers.dev/health` in a browser. It should
show `{"ok":true}`.

### 5. Point the app at it (still off)

In `js/config.js`:

```js
export const UNLOCK_API_URL = 'https://calo-unlock.<your-name>.workers.dev';
export const UNLOCK_PUBLIC_KEY = { kty: 'EC', crv: 'P-256', x: '...', y: '...' }; // from step 3
export const UNLOCK_SUPPORT_CONTACT = 'your support email'; // optional
```

Leave `REQUIRE_UNLOCK = false` for now.

### 6. Make codes

**Easiest way, the admin page:** open
`https://calo-unlock.<your-name>.workers.dev/admin`, type your admin password,
choose how many codes and an optional note (like "Etsy batch Oct 9"), and
click **Make codes**. Click **Download CSV**. Codes are shown **only once**,
because the Worker only keeps the scrambled versions. Keep the CSV private.

**Or on your computer:**

```
CODE_PEPPER='your pepper' node scripts/generate-codes.js 20 "Etsy batch Oct 9"
npx wrangler d1 execute calo-unlock --remote --file=codes-out/<the .sql file it names>
```

(On Windows PowerShell: `$env:CODE_PEPPER='your pepper'; node scripts/generate-codes.js 20 "Etsy batch"`.)

The `codes-out` folder is ignored by git, so the codes never get uploaded.

Test one code yourself before selling. Put a code in the Etsy buyer PDF, or
paste one into each order message.

### 7. Turn the lock on

In `js/config.js` set:

```js
export const REQUIRE_UNLOCK = true;
```

Commit, open a pull request and merge it. GitHub Pages updates in a minute
or two. Open the app in a private/incognito window: you should see Calo
asking for a code. Your own phone, with its saved goals, stays unlocked.

**Safety net:** if `UNLOCK_API_URL` or `UNLOCK_PUBLIC_KEY` is empty, the app
stays open even with `REQUIRE_UNLOCK = true`, so a half-finished setup never
locks people out. To turn the lock off again, set it back to `false` and merge.

## Helping a buyer (admin page)

- **Look up:** type their code (or the `c_...` id from your CSV) to see how
  many devices use it.
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

**Recommended later (once sales are coming in): host on Cloudflare Pages at
calo.ca and make the GitHub repo private.** GitHub's free plan can't serve a
site from a private repo, but Cloudflare Pages can:

1. Buy `calo.ca` in Cloudflare (Domain Registration > Register Domains).
2. Cloudflare dashboard > **Workers & Pages** > **Create** > **Pages** >
   **Connect to Git**. Pick `student-day-planner`, branch `main`, and use the
   same copy step as the GitHub Pages workflow (the `models` folder is a link,
   so it has to be copied this way):
   - Build command:
     `mkdir -p _site && cp index.html manifest.webmanifest sw.js robots.txt _site/ && cp -r css js fonts icons pets-preview sounds items data _site/ && cp -aL models _site/models && cp -aL vendor _site/vendor`
   - Build output directory: `_site`
3. In the Pages project: **Custom domains** > add `calo.ca` and `www.calo.ca`.
4. Check the app works on `https://calo.ca`, then unlock it there with a code.
   (Each website address keeps its own data, so users moving from the
   github.io address would need to unlock again and won't see their old goals
   there. Do this move before you have many users.)
5. In GitHub: repo **Settings** > **Pages**: turn GitHub Pages off. Then
   **Settings** > **General** > **Danger Zone** > **Change visibility** >
   **Private**.
6. Remove `https://tyler467890.github.io` from `ALLOWED_ORIGINS` and run
   `npx wrangler deploy` again.

The app's files can still be downloaded from calo.ca, as with any website, but
they're no longer sitting in a public repo with history and comments, and the
lock is the only door.
