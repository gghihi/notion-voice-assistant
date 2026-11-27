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
  try { setToken((await api('/api/login', { password: $('pw').value })).token); $('pw').value = ''; msg(''); show(); loadTemplates('projects'); }
  catch (e) { msg(e.message); }
};
$('pw').onkeydown = (e) => { if (e.key === 'Enter') $('loginBtn').click(); };
$('logoutBtn').onclick = (e) => { e.preventDefault(); setToken(null); show(); msg('已登出'); };

$('checkBtn').onclick = async (e) => {
  e.preventDefault(); msg('檢查中…');
  try { const r = await api('/api/health'); msg(Object.entries(r.notion).map(([k, v]) => `${k}：${v === 'ok' ? '✅ 已連上' : '❌ ' + v}`).join('\n')); }
  catch (err) { msg(err.message); }
};

// 專案庫：先跳出確認卡（標題、欄位、範本），確認後才送出
$('noteNextBtn').onclick = () => {
  const text = $('text').value.trim();
  if (!text) return msg('先寫點東西吧');
  $('noteTitle').value = text.split('\n')[0].slice(0, 40);
  $('noteForm').hidden = false;
  panel('projects'); loadTemplates('projects');
  msg('選好欄位後按「確認送出」');
};
$('saveBtn').onclick = async () => {
  const text = $('text').value.trim();
  if (!text) return msg('先寫點東西吧');
  $('saveBtn').disabled = true; msg(tplWait('projects'));
  try { await api('/api/note', { text, title: $('noteTitle').value, props: panels.projects ? panels.projects.collect() : undefined, templateId: $('tpl-projects').value }); $('text').value = ''; $('noteForm').hidden = true; panels.projects?.reset(); msg('✅ 已存到「專案庫」（工作專案規劃 新版），打開 Notion 就看得到'); }
  catch (e) { msg(e.message); }
  finally { $('saveBtn').disabled = false; }
};

// 欄位面板：第一次用到時才向後端讀取選項
const panels = {};
function panel(db) {
  const defaults = { projects: { 專案狀態: '點子階段' }, tasks: {}, knowledge: { 知識庫性質: '課堂筆記', 觀看性質: '想看' } }[db];
  return (panels[db] ||= FieldPanel(db, $('fields-' + db), defaults));
}

// 分頁切換
document.querySelectorAll('.tab').forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === t));
    $('tab-note').hidden = t.dataset.tab !== 'note';
    $('tab-plan').hidden = t.dataset.tab !== 'plan';
    $('tab-video').hidden = t.dataset.tab !== 'video';
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
  if (!text) return msg('先說或打一句任務吧');
  msg('讀取中…');
  try {
    const r = await api('/api/schedule/parse', { text });
    $('planTitle').value = r.title;
    $('planAt').value = r.at ? toLocalInput(r.at) : '';
    $('planForm').hidden = false;
    panel('tasks'); loadTemplates('tasks');
    msg(r.at ? '選好欄位後按「確認送出」' : '沒聽出時間，請在「時間」欄自己選');
  } catch (e) { msg(e.message); }
};

$('planSaveBtn').onclick = async () => {
  const at = $('planAt').value ? new Date($('planAt').value).getTime() : NaN;
  if (!Number.isFinite(at)) return msg('請選擇時間');
  const before = Number($('planBefore').value);
  $('planSaveBtn').disabled = true; msg(tplWait('tasks'));
  try {
    await api('/api/schedule', { title: $('planTitle').value, at, remind: before >= 0, remindBefore: Math.max(before, 0), props: panel('tasks').collect(), templateId: $('tpl-tasks').value });
    panel('tasks').reset();
    $('planText').value = ''; $('planForm').hidden = true;
    msg('✅ 已存到「任務庫」（所有任務清單）' + (before >= 0 ? '，時間到會通知你' : ''));
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

// 影片：抓資料 → 確認 → 存到知識庫
function openTab(name) { document.querySelector(`.tab[data-tab="${name}"]`).click(); }
$('videoPreviewBtn').onclick = async () => {
  const url = $('videoUrl').value.trim();
  if (!url) return msg('先貼上影片網址');
  $('videoDone').hidden = true; msg('抓影片資料中…（約 3 秒）');
  try {
    const r = await api('/api/video/preview', { url });
    $('videoTitle').value = r.title || '';
    $('videoThumb').hidden = !r.thumbnail;
    if (r.thumbnail) $('videoThumb').src = r.thumbnail;
    $('videoMeta').textContent = [r.platform, r.author && '頻道：' + r.author, r.uploadDate && '上傳：' + r.uploadDate].filter(Boolean).join('　');
    $('videoForm').hidden = false;
    const kp = panel('knowledge'); await kp.ready; kp.reset();
    // 抓到的影片資料蓋過範本預設；抓不到就保留範本的值
    if (r.author) kp.set('作者', [r.author.replace(/,/g, ' ')]);
    if (r.uploadDate) kp.set('上傳日期', r.uploadDate);
    kp.set('課堂筆記通路', r.platform === 'IG' ? 'IG' : 'YouTube');
    kp.set('相關連結', r.url);
    msg(r.title ? '選好欄位後按「確認送出」' : '抓不到標題（IG 常擋），可以自己填，或直接存');
  } catch (e) { msg(e.message); }
};
// 範本清單：每個資料庫第一次用到時讀取。知識庫預設「課堂筆記模板」，其他用 Notion 設的預設範本
const tplLoaded = {};
async function loadTemplates(db) {
  if (tplLoaded[db]) return;
  tplLoaded[db] = true;
  const sel = $('tpl-' + db);
  try {
    const { templates } = await api('/api/templates?db=' + db);
    sel.innerHTML = '';
    sel.add(new Option('不用範本', ''));
    for (const t of templates) sel.add(new Option(t.name, t.id));
    const pick = (db === 'knowledge' && templates.find((t) => t.name.includes('課堂筆記'))) || templates.find((t) => t.isDefault);
    if (pick) sel.value = pick.id;
    applyTemplate(db);
  } catch { tplLoaded[db] = false; sel.innerHTML = ''; sel.add(new Option('不用範本（範本讀取失敗）', '')); }
}
document.querySelector('.tab[data-tab="video"]').addEventListener('click', () => loadTemplates('knowledge'));
document.querySelector('.tab[data-tab="note"]').addEventListener('click', () => loadTemplates('projects'));
document.querySelector('.tab[data-tab="plan"]').addEventListener('click', () => loadTemplates('tasks'));
// 選了範本 → 讀出範本已填好的欄位，當成確認卡的預設值（還是可以改）
async function applyTemplate(db) {
  const id = $('tpl-' + db).value;
  let values = {};
  if (id) {
    msg('讀取範本預設值…');
    try {
      values = (await api(`/api/template-values?db=${db}&id=${encodeURIComponent(id)}`)).values;
      const keys = Object.keys(values);
      msg(keys.length ? '已帶入範本預設：' + keys.join('、') : '這個範本沒有預先填好的欄位');
    } catch (e) { msg('範本預設值讀取失敗：' + e.message); }
  }
  if ($('tpl-' + db).value === id) await panel(db).useTemplate(id ? values : null);
}
['projects', 'tasks', 'knowledge'].forEach((db) => { $('tpl-' + db).onchange = () => applyTemplate(db); });

const tplWait = (db) => ($('tpl-' + db).value ? '存檔中…（套用範本約需 5 秒）' : '存檔中…');

$('videoSaveBtn').onclick = async () => {
  $('videoSaveBtn').disabled = true; msg(tplWait('knowledge'));
  try {
    const r = await api('/api/video', { url: $('videoUrl').value.trim(), title: $('videoTitle').value, props: panel('knowledge').collect(), templateId: $('tpl-knowledge').value });
    $('videoForm').hidden = true; $('videoUrl').value = '';
    $('videoOpen').href = r.url; $('videoDone').hidden = false;
    msg('✅ 已存到「知識庫」，點下面打開 Notion 看看');
  } catch (e) { msg(e.message); }
  finally { $('videoSaveBtn').disabled = false; }
};
// 從其他 APP「分享」過來時，網址會放在網址列參數裡
(function handleShare() {
  const q = new URLSearchParams(location.search);
  const shared = [q.get('url'), q.get('text'), q.get('title')].find((x) => x && /https?:\/\//.test(x));
  if (!shared) return;
  history.replaceState(null, '', location.pathname);
  openTab('video');
  $('videoUrl').value = shared.match(/https?:\/\/\S+/)[0];
  if (getToken()) $('videoPreviewBtn').click();
})();

if (getToken()) loadTemplates('projects');

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
show();
