/**
 * Dayli push worker.
 * Stores a subscription and up to 7 days of reminders in KV, and sends
 * each one with Web Push when a cron tick finds it due. Sent reminders
 * are deleted. Unsubscribe deletes the whole record.
 */

import { partitionDue, clampReminders } from './schedule.js';
import { sendWebPush } from './webpush.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function cors(response) {
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-headers', 'content-type, x-dayli-tick');
  headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
  return new Response(response.body, { status: response.status, headers });
}

function json(data, status = 200) {
  return cors(new Response(JSON.stringify(data), { status, headers: JSON_HEADERS }));
}

async function endpointKey(endpoint) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `sub:${hex.slice(0, 40)}`;
}

function cleanReminder(item) {
  if (!item || !item.id || !item.fireAtUTC) return null;
  return {
    id: String(item.id).slice(0, 200),
    fireAtUTC: String(item.fireAtUTC).slice(0, 40),
    title: String(item.title || 'Coming up').slice(0, 120),
    body: String(item.body || '').slice(0, 240),
    taskId: item.taskId ? String(item.taskId).slice(0, 80) : null,
    date: item.date ? String(item.date).slice(0, 10) : null,
  };
}

function readSubscription(body) {
  const sub = body?.subscription || {};
  const endpoint = sub.endpoint;
  const p256dh = sub.keys?.p256dh;
  const auth = sub.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    const error = new Error('Subscription needs an endpoint, p256dh key and auth secret.');
    error.status = 400;
    throw error;
  }
  const reminders = clampReminders(
    (Array.isArray(body.reminders) ? body.reminders : []).slice(0, 200).map(cleanReminder).filter(Boolean),
    Date.now(),
  );
  return { endpoint: String(endpoint), p256dh: String(p256dh), auth: String(auth), reminders };
}

async function saveSubscription(env, record) {
  const key = await endpointKey(record.endpoint);
  await env.REMINDERS.put(key, JSON.stringify({
    endpoint: record.endpoint,
    p256dh: record.p256dh,
    auth: record.auth,
    reminders: record.reminders,
    updatedAt: new Date().toISOString(),
  }));
  return key;
}

export async function dispatchDue(env, nowMs = Date.now()) {
  const vapid = vapidFromEnv(env);
  let cursor;
  let sent = 0;
  let removed = 0;
  const limit = 20;
  do {
    const page = await env.REMINDERS.list({ prefix: 'sub:', cursor });
    for (const entry of page.keys) {
      if (sent >= limit) break;
      const raw = await env.REMINDERS.get(entry.name);
      if (!raw) continue;
      const record = JSON.parse(raw);
      const { due, keep } = partitionDue(record.reminders || [], nowMs);
      if (!due.length) continue;
      const stillDue = [];
      let gone = false;
      for (const reminder of due) {
        if (sent >= limit) {
          stillDue.push(reminder);
          continue;
        }
        const response = await sendWebPush(
          { endpoint: record.endpoint, p256dh: record.p256dh, auth: record.auth },
          {
            title: reminder.title || 'Coming up',
            body: reminder.body || '',
            tag: reminder.id,
            id: reminder.id,
            taskId: reminder.taskId || null,
            date: reminder.date || null,
          },
          vapid,
        );
        if (response.status === 404 || response.status === 410) {
          await env.REMINDERS.delete(entry.name);
          removed += 1;
          gone = true;
          break;
        }
        if (response.ok || response.status === 201) {
          sent += 1;
        } else {
          stillDue.push(reminder);
        }
      }
      if (!gone) {
        const next = keep.concat(stillDue);
        await env.REMINDERS.put(entry.name, JSON.stringify({ ...record, reminders: next }));
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && sent < limit);
  return { sent, removed };
}

function vapidFromEnv(env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    const error = new Error('Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY secrets.');
    error.status = 500;
    throw error;
  }
  const privateJwk = typeof env.VAPID_PRIVATE_KEY === 'string'
    ? JSON.parse(env.VAPID_PRIVATE_KEY)
    : env.VAPID_PRIVATE_KEY;
  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateJwk,
    subject: env.VAPID_SUBJECT || 'mailto:dayli@example.com',
  };
}

export async function handleFetch(request, env) {
  if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
  const url = new URL(request.url);
  try {
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return json({ ok: true, service: 'dayli-push' });
    }
    if (request.method === 'POST' && url.pathname === '/tick') {
      if (!env.TICK_SECRET || request.headers.get('x-dayli-tick') !== env.TICK_SECRET) {
        return json({ error: 'unauthorized' }, 401);
      }
      return json(await dispatchDue(env));
    }
    if (request.method === 'POST' && (url.pathname === '/sync' || url.pathname === '/subscribe')) {
      const record = readSubscription(await request.json());
      await saveSubscription(env, record);
      return json({ ok: true, stored: record.reminders.length });
    }
    if (request.method === 'POST' && url.pathname === '/unsubscribe') {
      const body = await request.json();
      const endpoint = body.endpoint || body.subscription?.endpoint;
      if (!endpoint) return json({ error: 'endpoint required' }, 400);
      await env.REMINDERS.delete(await endpointKey(endpoint));
      return json({ ok: true });
    }
    return json({ error: 'not found' }, 404);
  } catch (error) {
    return json({ error: error.message || 'error' }, error.status || 500);
  }
}

export default {
  fetch(request, env) {
    return handleFetch(request, env);
  },
  scheduled(_event, env, ctx) {
    ctx.waitUntil(dispatchDue(env));
  },
};
