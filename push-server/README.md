# Dayli push server

Small Cloudflare Worker that stores a browser push subscription and up to 7 days of reminders, then sends each one with Web Push when it is due. The planner works with this server left undeployed: leave `PUSH_SERVER_URL` empty in `js/config.js` and closed-app push is skipped.

This folder was not deployed from the build environment (no Cloudflare account). The steps below are the exact commands to deploy it yourself.

## What it does

- `POST /subscribe` and `POST /sync` — save `{ subscription, reminders }`. Reminders more than 7 days out are dropped.
- `POST /unsubscribe` — delete that subscription and its reminders.
- `GET /health` — `{ "ok": true, "service": "dayli-push" }`.
- Cron `* * * * *` — about once a minute, send reminders whose fire time has arrived and is not older than 2 hours. At most 20 sends per run. A `404` or `410` from the push service deletes the subscription.
- `POST /tick` with header `x-dayli-tick: <TICK_SECRET>` — same send pass, if you want an external scheduler as well.

Delivery is “usually on time”, not to the second. Free-plan cron granularity is one minute.

Free-plan Workers have a short CPU budget on scheduled handlers. If the cron invocation errors, use the Workers Paid plan or call `POST /tick` from any minute scheduler.

## 1. Install Wrangler

From this directory:

```bash
npm install -g wrangler
# or, without a global install:
npx wrangler --version
```

Log in once:

```bash
npx wrangler login
```

## 2. Create the KV namespace

```bash
cd push-server
npx wrangler kv namespace create REMINDERS
```

Copy the `id` from the output into `wrangler.toml`, replacing `replace-with-kv-namespace-id`:

```toml
[[kv_namespaces]]
binding = "REMINDERS"
id = "paste-the-id-here"
```

## 3. Generate VAPID keys

From the repo root (Node 20+):

```bash
node push-server/scripts/generate-vapid.js
```

That prints:

- a base64url **public** key
- a one-line **private** JWK

## 4. Set secrets and the subject

Still in `push-server`:

```bash
npx wrangler secret put VAPID_PUBLIC_KEY
# paste the public key, then Enter

npx wrangler secret put VAPID_PRIVATE_KEY
# paste the one-line private JWK, then Enter

npx wrangler secret put TICK_SECRET
# optional. any long random string. only needed for POST /tick
```

Edit `wrangler.toml` and set a real contact address:

```toml
[vars]
VAPID_SUBJECT = "mailto:you@example.com"
```

`VAPID_SUBJECT` must be a `mailto:` or `https:` URL. Push services reject other values.

## 5. Deploy

```bash
npx wrangler deploy
```

Note the worker URL, for example `https://dayli-push.<account>.workers.dev`.

Check it:

```bash
curl https://dayli-push.<account>.workers.dev/health
```

## 6. Point the app at the worker

In `js/config.js` at the repo root:

```js
export const PUSH_SERVER_URL = 'https://dayli-push.<account>.workers.dev';
export const VAPID_PUBLIC_KEY = '<the same public key>';
```

Commit and push `main` so GitHub Pages picks up the new config. Closed-app reminders start working after a visitor taps **Turn on reminders** and the browser creates a push subscription.

The client only talks to the worker through `js/push.js` (`subscribe`, `syncReminders`, `unsubscribe`). If either the URL or the public key is empty, those functions do nothing.
