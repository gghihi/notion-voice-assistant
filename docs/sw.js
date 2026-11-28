// 讓 APP 可以加入主畫面。不快取任何資料，只快取畫面檔案。
const VERSION = 58;
const CACHE = 'shell-v' + VERSION;
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'fields.js', 'manifest.json', 'icon-192.png', 'icon-512.png', 'logo.png', 'theme.js', 'sound.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // 後端請求不經過快取
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});

// 收到提醒推播 → 顯示通知（APP 沒開也會顯示）
self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch {}
  e.waitUntil(self.registration.showNotification(m.title || 'Notion 請助手🫰', { body: m.body || '', tag: m.tag, data: { url: m.url || '' }, requireInteraction: true }));
});
// 點通知 → 打開 Notion 那一筆（只允許 notion 網址），否則打開 APP
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data && e.notification.data.url;
  const safe = url && /^https:\/\/(www\.|app\.)?notion\.(so|com)\//.test(url) ? url : self.registration.scope;
  e.waitUntil(clients.openWindow(safe));
});
