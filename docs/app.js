// 網頁主程式。這裡沒有任何金鑰：只存一張 30 天到期的通行證在這台裝置。
const API = location.hostname === 'localhost' ? 'http://localhost:8787' : window.APP_CONFIG.API;
const $ = (id) => document.getElementById(id);
const msg = (t) => { $('msg').textContent = t; };

function getToken() { try { return localStorage.getItem('token'); } catch { return null; } }
function setToken(t) { try { t ? localStorage.setItem('token', t) : localStorage.removeItem('token'); } catch {} }

async function api(path, body) {
  const res = await fetch(API + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (getToken() || '') },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') { setToken(null); show(); }
  if (!res.ok) throw new Error(data.error || '發生錯誤');
  return data;
}

function show() {
  const logged = !!getToken();
  $('login').hidden = logged;
  $('app').hidden = !logged;
}

$('loginBtn').onclick = async () => {
  msg('登入中…');
  try { setToken((await api('/api/login', { password: $('pw').value })).token); $('pw').value = ''; msg(''); show(); }
  catch (e) { msg(e.message); }
};
$('pw').onkeydown = (e) => { if (e.key === 'Enter') $('loginBtn').click(); };
$('logoutBtn').onclick = (e) => { e.preventDefault(); setToken(null); show(); msg('已登出'); };

$('checkBtn').onclick = async (e) => {
  e.preventDefault(); msg('檢查中…');
  try { const r = await api('/api/health'); msg(Object.entries(r.notion).map(([k, v]) => `${k}：${v === 'ok' ? '✅ 已連上' : '❌ ' + v}`).join('\n')); }
  catch (err) { msg(err.message); }
};

$('saveBtn').onclick = async () => {
  const text = $('text').value.trim();
  if (!text) return msg('先寫點東西吧');
  $('saveBtn').disabled = true; msg('存檔中…');
  try { await api('/api/note', { text }); $('text').value = ''; msg('✅ 已存到「工作專案規劃 新版」，打開 Notion 就看得到'); }
  catch (e) { msg(e.message); }
  finally { $('saveBtn').disabled = false; }
};

// 分頁切換
document.querySelectorAll('.tab').forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === t));
    $('tab-note').hidden = t.dataset.tab !== 'note';
    $('tab-plan').hidden = t.dataset.tab !== 'plan';
    msg('');
  };
});

// 語音輸入：用瀏覽器內建的語音辨識，聲音不經過我們的後端
const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
document.querySelectorAll('.mic').forEach((btn) => {
  btn.onclick = () => {
    if (!Speech) return msg('這個瀏覽器不支援語音輸入，請改用打字（也可以用鍵盤上的麥克風）');
    if (rec) { rec.stop(); return; }
    const box = $(btn.dataset.for);
    rec = new Speech();
    rec.lang = 'zh-TW'; rec.interimResults = true; rec.continuous = true;
    const before = box.value;
    rec.onresult = (e) => { box.value = before + Array.from(e.results).map((r) => r[0].transcript).join(''); };
    rec.onerror = (e) => msg(e.error === 'not-allowed' ? '請允許使用麥克風' : '語音辨識中斷，可以再按一次');
    rec.onend = () => { rec = null; btn.classList.remove('recording'); btn.textContent = '🎤 說話'; };
    rec.start(); btn.classList.add('recording'); btn.textContent = '⏹ 停止'; msg('');
  };
});

// 日程：先看懂句子，讓使用者確認時間，再存
const pad = (n) => String(n).padStart(2, '0');
function toLocalInput(ts) { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }

$('parseBtn').onclick = async () => {
  const text = $('planText').value.trim();
  if (!text) return msg('先說或打一句行程吧');
  msg('理解中…');
  try {
    const r = await api('/api/schedule/parse', { text });
    $('planTitle').value = r.title;
    $('planAt').value = r.at ? toLocalInput(r.at) : '';
    $('planForm').hidden = false;
    msg(r.at ? '請確認內容，沒問題就按「存到 Notion」' : '沒聽出時間，請在「時間」欄自己選');
  } catch (e) { msg(e.message); }
};

$('planSaveBtn').onclick = async () => {
  const at = $('planAt').value ? new Date($('planAt').value).getTime() : NaN;
  if (!Number.isFinite(at)) return msg('請選擇時間');
  const before = Number($('planBefore').value);
  $('planSaveBtn').disabled = true; msg('存檔中…');
  try {
    await api('/api/schedule', { title: $('planTitle').value, at, remind: before >= 0, remindBefore: Math.max(before, 0) });
    $('planText').value = ''; $('planForm').hidden = true;
    msg('✅ 已存到「所有任務清單」' + (before >= 0 ? '，時間到會通知你' : ''));
  } catch (e) { msg(e.message); }
  finally { $('planSaveBtn').disabled = false; }
};

// 推播通知
function b64ToBytes(s) { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); }
async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('這個瀏覽器不支援通知（iPhone 要先加入主畫面再從主畫面打開）');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('通知被拒絕了，請到瀏覽器設定裡允許這個網站的通知');
  const { key } = await api('/api/vapid');
  if (!key) throw new Error('後端還沒設定推播鑰匙');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) }));
  await api('/api/push/subscribe', sub.toJSON());
}
$('pushBtn').onclick = async () => {
  msg('設定中…');
  try { await enablePush(); msg('✅ 通知已開啟'); $('pushBtn').textContent = '🔔 通知已開啟'; }
  catch (e) { msg(e.message); }
};
$('pushTestBtn').onclick = async (e) => {
  e.preventDefault(); msg('送出中…');
  try { const r = await api('/api/push/test', {}); msg(r.devices ? `已送出到 ${r.ok}/${r.devices} 台裝置` : '還沒有裝置開啟通知，請先按「開啟提醒通知」'); }
  catch (err) { msg(err.message); }
};
if (window.Notification && Notification.permission === 'granted') $('pushBtn').textContent = '🔔 通知已開啟（按一下重新連結）';

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
show();
