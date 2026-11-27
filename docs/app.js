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

// 語音輸入：用瀏覽器內建的語音辨識，聲音不經過我們的後端
const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
$('micBtn').onclick = () => {
  if (!Speech) return msg('這個瀏覽器不支援語音輸入，請改用打字（iPhone 可用鍵盤上的麥克風）');
  if (rec) { rec.stop(); return; }
  rec = new Speech();
  rec.lang = 'zh-TW'; rec.interimResults = true; rec.continuous = true;
  const before = $('text').value;
  rec.onresult = (e) => { $('text').value = before + Array.from(e.results).map((r) => r[0].transcript).join(''); };
  rec.onerror = (e) => msg(e.error === 'not-allowed' ? '請允許使用麥克風' : '語音辨識中斷，可以再按一次');
  rec.onend = () => { rec = null; $('micBtn').classList.remove('recording'); $('micBtn').textContent = '🎤 說話'; };
  rec.start(); $('micBtn').classList.add('recording'); $('micBtn').textContent = '⏹ 停止'; msg('');
};

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
show();
