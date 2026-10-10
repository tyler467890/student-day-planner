/**
 * The admin page (GET /admin, e.g. https://api.caloplanner.com/admin).
 *
 * Made for one job: an Etsy order comes in, tap "New code", tap "Copy
 * message", paste it into the Etsy conversation. The admin password is typed
 * once; with "Remember on this device" ticked it's kept in this browser's
 * localStorage for this site only (never sent anywhere but this Worker).
 * "Sign out" forgets it.
 */

export const APP_LINK = 'https://caloplanner.com';

const PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#6D4AFF">
<title>Calo codes</title>
<style>
  * { box-sizing: border-box; }
  body { font: 16px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; background: #F3F0FF; color: #2A1860; }
  main { max-width: 640px; margin: 0 auto; padding: 16px 14px calc(60px + env(safe-area-inset-bottom, 0px)); }
  header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  h1 { font-size: 22px; margin: 6px 0; } h2 { font-size: 18px; margin: 0 0 10px; }
  section { background: #fff; border-radius: 18px; padding: 16px; margin: 14px 0; box-shadow: 0 2px 10px rgba(30,20,60,.07); }
  label { display: block; font-weight: 700; margin: 8px 0 4px; }
  input { width: 100%; font: inherit; padding: 12px; border: 2px solid #CFC5FF; border-radius: 12px; background: #FBFAFF; color: inherit; }
  input:focus { outline: none; border-color: #6D4AFF; }
  .check { display: flex; align-items: center; gap: 8px; font-weight: 400; }
  .check input { width: auto; }
  button { font: inherit; font-weight: 700; min-height: 46px; padding: 10px 16px; border: 0; border-radius: 12px; background: #6D4AFF; color: #fff; cursor: pointer; }
  button:disabled { opacity: .6; cursor: default; }
  button.alt { background: #EDE8FF; color: #2A1860; }
  button.danger { background: #FFE8EC; color: #A3173A; }
  button.small { min-height: 38px; padding: 6px 12px; font-size: 14px; }
  button.big { width: 100%; font-size: 18px; min-height: 54px; margin-top: 12px; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
  .row > button { flex: 1 1 140px; }
  .code { font: 700 20px/1.3 ui-monospace, Menlo, Consolas, monospace; letter-spacing: .04em; text-align: center; background: #F7F5FF; border: 2px dashed #CFC5FF; border-radius: 12px; padding: 12px 8px; margin: 12px 0 0; word-break: break-all; user-select: all; }
  textarea { width: 100%; min-height: 230px; font: 15px/1.45 system-ui, sans-serif; padding: 10px; border: 2px solid #E4DEFF; border-radius: 12px; background: #FBFAFF; color: inherit; resize: vertical; }
  .muted { color: #6B5A99; font-size: 14px; }
  .err { color: #A3173A; font-weight: 700; }
  .ok { color: #1D7A45; font-weight: 700; }
  .warn { background: #FFF3DD; color: #6B3D00; padding: 10px 12px; border-radius: 12px; font-size: 14px; }
  .list { list-style: none; margin: 10px 0 0; padding: 0; }
  .list li { border-top: 1px solid #EEE9FF; padding: 12px 0; }
  .list li:first-child { border-top: 0; }
  .note { font-weight: 700; word-break: break-word; }
  .meta { font-size: 14px; color: #6B5A99; }
  .chip { display: inline-block; font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: #EDE8FF; margin-left: 6px; vertical-align: 1px; }
  .chip.blocked { background: #FFE8EC; color: #A3173A; }
  .chip.full { background: #FFF3DD; color: #8A4A00; }
  details summary { cursor: pointer; font-weight: 700; }
  pre { white-space: pre-wrap; word-break: break-all; background: #F7F5FF; padding: 10px; border-radius: 10px; font-size: 13px; }
  [hidden] { display: none !important; }
</style></head>
<body><main>
<header><h1>🐰 Calo codes</h1><button id="out" class="alt small" hidden>Sign out</button></header>

<section id="signin">
  <h2>Sign in</h2>
  <label for="pw">Admin password</label>
  <input id="pw" type="password" autocomplete="current-password">
  <label class="check"><input id="remember" type="checkbox" checked> Remember on this device</label>
  <button id="go" class="big">Sign in</button>
  <p id="signErr" class="err" role="alert"></p>
</section>

<div id="app" hidden>
<section>
  <h2>New code for a buyer</h2>
  <label for="note">Note (optional): Etsy order # or buyer name</label>
  <input id="note" maxlength="200" placeholder="e.g. #3456789012 Sarah">
  <button id="new" class="big">New code</button>
  <p id="newErr" class="err" role="alert"></p>
  <div id="made" hidden>
    <p class="code" id="madeCode"></p>
    <p class="warn">Copy it now. For safety the code can't be shown again later (only its note and devices).</p>
    <label for="msg">Message for the buyer</label>
    <textarea id="msg"></textarea>
    <div class="row">
      <button id="copyMsg">Copy message</button>
      <button id="copyCode" class="alt">Copy code only</button>
    </div>
    <p id="copied" class="ok" role="status"></p>
    <p class="muted">Paste it into the buyer's Etsy order conversation (Etsy: Orders &amp; Shipping, open the order, Message buyer).</p>
  </div>
</section>

<section>
  <h2>Issued codes <span id="count" class="muted"></span></h2>
  <input id="filter" type="search" placeholder="Search notes or ids" aria-label="Search notes or ids">
  <ul id="list" class="list"></ul>
  <p id="listErr" class="err" role="alert"></p>
</section>

<section>
  <details>
    <summary>More: many codes at once, look up a code</summary>
    <label for="count2">How many codes</label><input id="count2" type="number" min="1" max="500" value="10">
    <label for="note2">Note (optional)</label><input id="note2" maxlength="200">
    <button id="gen" class="alt" style="margin-top:10px">Make codes + CSV</button>
    <div id="genOut"></div>
    <label for="code">Look up a code (CALO-…) or id (c_…)</label><input id="code" autocapitalize="characters" spellcheck="false">
    <button id="look" class="alt" style="margin-top:10px">Look up</button>
    <pre id="lookOut" hidden></pre>
  </details>
</section>
</div>
</main>
<script nonce="__NONCE__">
const LINK = '__LINK__';
const KEY = 'calo-admin-key';
const NL = String.fromCharCode(10);
const $ = (id) => document.getElementById(id);
let pw = '';
try { pw = localStorage.getItem(KEY) || ''; } catch (e) { pw = ''; }
let codes = [];

async function call(action, body) {
  const res = await fetch('/admin/api/' + action, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + pw },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { signOut(); $('signErr').textContent = 'Wrong admin password.'; }
  if (!res.ok) throw new Error(data.message || data.error || ('Error ' + res.status));
  return data;
}

function signOut() {
  pw = '';
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  $('app').hidden = true; $('out').hidden = true; $('signin').hidden = false;
  $('made').hidden = true; $('msg').value = ''; $('madeCode').textContent = '';
}

async function signIn(remember) {
  $('signErr').textContent = '';
  try {
    await load();
    if (remember) { try { localStorage.setItem(KEY, pw); } catch (e) { /* private mode */ } }
    $('signin').hidden = true; $('app').hidden = false; $('out').hidden = false; $('pw').value = '';
  } catch (e) {
    if (pw) $('signErr').textContent = e.message;
  }
}

function message(code) {
  return [
    'Hi! Thank you so much for ordering Calo 💜',
    '',
    'Your unlock code:',
    code,
    '',
    'How to start:',
    '1. Open ' + LINK,
    '   (iPhone: tap Share, then Add to Home Screen first, and open Calo from your home screen.)',
    '2. Calo the bunny will say hi. Type your code and tap Unlock.',
    '',
    'Your code works on up to 3 of your devices, and Calo keeps working offline after that.',
    'If anything goes wrong, just reply here and I will help.',
    '',
    'Happy planning! 🐰',
  ].join(NL);
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {
    const t = $('msg'); const old = t.value; t.value = text; t.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
    t.value = old; return ok;
  }
}

function when(iso) {
  return new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function render() {
  const q = $('filter').value.trim().toLowerCase();
  const list = $('list');
  list.textContent = '';
  const shown = codes.filter((c) => !q || (c.note || '').toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
  for (const c of shown) {
    const li = document.createElement('li');
    li.dataset.id = c.id;
    const top = document.createElement('div');
    const note = document.createElement('span'); note.className = 'note'; note.textContent = c.note || 'No note';
    top.append(note);
    if (c.revoked) { const b = document.createElement('span'); b.className = 'chip blocked'; b.textContent = 'Blocked'; top.append(b); }
    else if (c.devicesUsed >= c.maxDevices) { const b = document.createElement('span'); b.className = 'chip full'; b.textContent = 'All devices used'; top.append(b); }
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = when(c.createdAt) + ' · ' + c.devicesUsed + '/' + c.maxDevices + ' devices · ' + c.id;
    const row = document.createElement('div'); row.className = 'row';
    const reset = document.createElement('button'); reset.className = 'alt small'; reset.textContent = 'Reset devices';
    reset.disabled = !c.devicesUsed;
    reset.onclick = () => act(c, 'reset', {}, 'Free all ' + c.maxDevices + ' device slots for "' + (c.note || c.id) + '"? Devices already unlocked keep working.');
    const block = document.createElement('button'); block.className = c.revoked ? 'alt small' : 'danger small';
    block.textContent = c.revoked ? 'Unblock' : 'Block';
    block.onclick = () => act(c, 'revoke', { revoked: !c.revoked }, c.revoked ? null : 'Block "' + (c.note || c.id) + '"? It will stop unlocking new devices (for refunds or a leaked code).');
    row.append(reset, block);
    li.append(top, meta, row);
    list.append(li);
  }
  $('count').textContent = codes.length ? '(' + codes.length + ')' : '';
  if (!codes.length) { const li = document.createElement('li'); li.className = 'muted'; li.textContent = 'No codes yet.'; list.append(li); }
}

async function load() {
  const data = await call('list', { limit: 500 });
  codes = data.codes || [];
  $('listErr').textContent = '';
  render();
}

async function act(c, action, extra, question) {
  if (question && !confirm(question)) return;
  try { await call(action, Object.assign({ code: c.id }, extra)); await load(); }
  catch (e) { $('listErr').textContent = e.message; }
}

$('go').onclick = () => { pw = $('pw').value.trim(); if (pw) signIn($('remember').checked); };
$('pw').onkeydown = (e) => { if (e.key === 'Enter') $('go').click(); };
$('out').onclick = signOut;
$('filter').oninput = render;

$('new').onclick = async () => {
  const btn = $('new'); btn.disabled = true; $('newErr').textContent = ''; $('copied').textContent = '';
  try {
    const data = await call('generate', { count: 1, note: $('note').value.trim() });
    const code = data.codes[0].code;
    $('madeCode').textContent = code;
    $('msg').value = message(code);
    $('made').hidden = false;
    $('note').value = '';
    await load();
  } catch (e) { $('newErr').textContent = e.message; }
  btn.disabled = false;
};
$('copyMsg').onclick = async () => { $('copied').textContent = (await copy($('msg').value)) ? 'Message copied. Paste it into Etsy.' : 'Copy didn\\'t work. Select the text and copy it.'; };
$('copyCode').onclick = async () => { $('copied').textContent = (await copy($('madeCode').textContent)) ? 'Code copied.' : 'Copy didn\\'t work. Select the code and copy it.'; };

$('gen').onclick = async () => {
  const out = $('genOut');
  out.textContent = 'Working…'; out.className = '';
  try {
    const data = await call('generate', { count: Number($('count2').value), note: $('note2').value });
    out.textContent = '';
    const pre = document.createElement('pre');
    pre.textContent = data.codes.map((c) => c.code).join(NL);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data.csv + NL], { type: 'text/csv' }));
    a.download = 'calo-codes-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.textContent = 'Download CSV (' + data.codes.length + ' codes)';
    out.append(a, pre);
    await load();
  } catch (e) { out.textContent = e.message; out.className = 'err'; }
};
$('look').onclick = async () => {
  const out = $('lookOut'); out.hidden = false;
  try { out.textContent = JSON.stringify(await call('lookup', { code: $('code').value }), null, 2); out.className = ''; }
  catch (e) { out.textContent = e.message; out.className = 'err'; }
};

if (pw) signIn(true);
</script>
</body></html>`;

export function adminPage() {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  return new Response(PAGE.replace('__NONCE__', nonce).replace('__LINK__', APP_LINK), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    },
  });
}
