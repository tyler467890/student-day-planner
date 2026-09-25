/**
 * Closed-app reminders. One module talks to the push server.
 * If the server URL or VAPID key is empty, every function no-ops and the
 * rest of the app keeps working.
 *
 *   subscribe()       — PushManager.subscribe + register with the server
 *   syncReminders()   — send the next 7 days of reminder text and fire times
 *   unsubscribe()     — drop the server copy and the browser subscription
 */

import { PUSH_SERVER_URL, VAPID_PUBLIC_KEY } from './config.js';

export function getPushConfig() {
  const override = globalThis.__DAYLI_PUSH_CONFIG;
  return {
    serverUrl: (override?.serverUrl ?? PUSH_SERVER_URL).replace(/\/$/, ''),
    vapidPublicKey: override?.vapidPublicKey ?? VAPID_PUBLIC_KEY,
  };
}

export function pushConfigured() {
  const { serverUrl, vapidPublicKey } = getPushConfig();
  return Boolean(serverUrl && vapidPublicKey);
}

export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function post(path, body) {
  const { serverUrl } = getPushConfig();
  if (!serverUrl) return { ok: false, skipped: true };
  const res = await fetch(`${serverUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Push server ${res.status} ${text}`.trim());
  }
  return res.json().catch(() => ({ ok: true }));
}

export async function subscribe() {
  if (!pushConfigured()) return { ok: false, skipped: true, reason: 'not-configured' };
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, skipped: true, reason: 'unsupported' };
  }
  const reg = await navigator.serviceWorker.ready;
  const { vapidPublicKey } = getPushConfig();
  const existing = await reg.pushManager.getSubscription();
  const sub = existing || await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });
  const json = sub.toJSON();
  return { ok: true, subscription: json };
}

export async function syncReminders(subscription, reminders) {
  if (!pushConfigured()) return { ok: false, skipped: true };
  if (!subscription?.endpoint) return { ok: false, skipped: true, reason: 'no-subscription' };
  const safe = (reminders || []).map((item) => ({
    id: item.id,
    fireAtUTC: item.fireAtUTC,
    title: item.title,
    body: item.body,
    taskId: item.taskId || null,
    date: item.date || null,
  }));
  return post('/sync', { subscription, reminders: safe });
}

export async function unsubscribe(subscription) {
  if (subscription?.endpoint && pushConfigured()) {
    try {
      await post('/unsubscribe', { endpoint: subscription.endpoint });
    } catch {
      /* still drop the local subscription */
    }
  }
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
    } catch {
      /* ignore */
    }
  }
  return { ok: true };
}
