// 推播訂閱與準時提醒
import { sendPush } from './webpush.js';

export async function saveSubscription(env, sub) {
  const endpoint = sub?.endpoint, p256dh = sub?.keys?.p256dh, auth = sub?.keys?.auth;
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || endpoint.length > 1000) return false;
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || p256dh.length > 200 || auth.length > 100) return false;
  await env.DB.prepare('INSERT INTO push_subs (endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth')
    .bind(endpoint, p256dh, auth, Date.now()).run();
  return true;
}

export async function addReminder(env, { title, remindAt, eventAt, pageUrl }) {
  await env.DB.prepare('INSERT INTO reminders (title, remind_at, event_at, page_url) VALUES (?, ?, ?, ?)')
    .bind(title, remindAt, eventAt, pageUrl || null).run();
}

export async function pushAll(env, message) {
  const { results } = await env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subs').all();
  let ok = 0;
  for (const sub of results) {
    const r = await sendPush(sub, message, env);
    if (r === 'ok') ok++;
    if (r === 'gone') await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(sub.endpoint).run();
  }
  return { devices: results.length, ok };
}

function hhmm(ts) {
  const t = new Date(ts + 8 * 3600000);
  return String(t.getUTCHours()).padStart(2, '0') + ':' + String(t.getUTCMinutes()).padStart(2, '0');
}

// 每分鐘由 Cloudflare 叫一次：把到時間的提醒送出去
export async function runDueReminders(env, now = Date.now()) {
  const { results } = await env.DB.prepare('SELECT id, title, event_at, page_url FROM reminders WHERE sent = 0 AND remind_at <= ? ORDER BY remind_at LIMIT 20').bind(now).all();
  for (const r of results) {
    // 先標記已送，避免下一分鐘重複發
    const { meta } = await env.DB.prepare('UPDATE reminders SET sent = 1 WHERE id = ? AND sent = 0').bind(r.id).run();
    if (!meta.changes) continue;
    await pushAll(env, { title: '⏰ ' + r.title, body: hhmm(r.event_at) + ' 的行程', url: r.page_url || '', tag: 'reminder-' + r.id });
  }
  // 清掉 30 天前送過的紀錄
  await env.DB.prepare('DELETE FROM reminders WHERE sent = 1 AND remind_at < ?').bind(now - 30 * 86400000).run();
  return results.length;
}
