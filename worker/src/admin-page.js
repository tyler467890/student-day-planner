/** The admin page. The password is typed each visit and only kept in memory. */

const PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Calo codes admin</title>
<style>
  body { font: 16px/1.45 system-ui, sans-serif; margin: 0; background: #F3F0FF; color: #2A1860; }
  main { max-width: 640px; margin: 0 auto; padding: 20px 16px 60px; }
  h1 { font-size: 24px; } h2 { font-size: 18px; margin: 0 0 8px; }
  section { background: #fff; border-radius: 16px; padding: 16px; margin: 14px 0; box-shadow: 0 2px 8px rgba(0,0,0,.06); }
  label { display: block; font-weight: 700; margin: 8px 0 4px; }
  input { width: 100%; box-sizing: border-box; font: inherit; padding: 10px; border: 2px solid #CFC5FF; border-radius: 10px; }
  button { font: inherit; font-weight: 700; padding: 10px 16px; margin-top: 10px; border: 0; border-radius: 10px; background: #6D4AFF; color: #fff; cursor: pointer; }
  button.alt { background: #EDE8FF; color: #2A1860; }
  pre { white-space: pre-wrap; word-break: break-all; background: #F7F5FF; padding: 10px; border-radius: 10px; font-size: 14px; }
  .err { color: #A3173A; font-weight: 700; }
  .warn { background: #FFF3DD; padding: 10px; border-radius: 10px; }
</style></head>
<body><main>
<h1>Calo codes admin</h1>
<section>
  <label for="pw">Admin password</label>
  <input id="pw" type="password" autocomplete="current-password">
</section>
<section>
  <h2>Make new codes</h2>
  <label for="count">How many</label><input id="count" type="number" min="1" max="500" value="10">
  <label for="note">Note (optional, e.g. "Etsy batch Oct 9")</label><input id="note" maxlength="200">
  <button id="gen">Make codes</button>
  <p class="warn">Codes are shown <b>once</b>. Download the CSV and keep it somewhere safe. Calo only stores scrambled versions.</p>
  <div id="genOut"></div>
</section>
<section>
  <h2>Look up or reset a code</h2>
  <label for="code">Code (CALO-…) or id (c_…)</label><input id="code" autocapitalize="characters" spellcheck="false">
  <button id="look" class="alt">Look up</button>
  <button id="reset">Reset devices</button>
  <button id="revoke" class="alt">Block code</button>
  <button id="unrevoke" class="alt">Unblock code</button>
  <pre id="lookOut" hidden></pre>
</section>
</main>
<script nonce="__NONCE__">
const $ = (id) => document.getElementById(id);
async function call(action, body) {
  const res = await fetch('/admin/api/' + action, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + $('pw').value },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || ('Error ' + res.status));
  return data;
}
function show(el, text, isErr) { el.hidden = false; el.textContent = text; el.className = isErr ? 'err' : ''; }
$('gen').onclick = async () => {
  const out = $('genOut');
  out.textContent = 'Working…';
  try {
    const data = await call('generate', { count: Number($('count').value), note: $('note').value });
    out.textContent = '';
    const pre = document.createElement('pre');
    pre.textContent = data.codes.map((c) => c.code).join('\\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data.csv + '\\n'], { type: 'text/csv' }));
    a.download = 'calo-codes-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.textContent = 'Download CSV (' + data.codes.length + ' codes)';
    out.append(a, pre);
  } catch (e) { out.textContent = e.message; out.className = 'err'; }
};
async function codeAction(action, extra) {
  const out = $('lookOut');
  if (action === 'reset' && !confirm('Free all device slots for this code?')) return;
  try { show(out, JSON.stringify(await call(action, { code: $('code').value, ...extra }), null, 2)); }
  catch (e) { show(out, e.message, true); }
}
$('look').onclick = () => codeAction('lookup');
$('reset').onclick = () => codeAction('reset');
$('revoke').onclick = () => codeAction('revoke', { revoked: true });
$('unrevoke').onclick = () => codeAction('revoke', { revoked: false });
</script>
</body></html>`;

export function adminPage() {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  return new Response(PAGE.replace('__NONCE__', nonce), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    },
  });
}
