// 網頁主程式。這裡沒有任何金鑰：只存一張 30 天到期的通行證在這台裝置。
const API = location.hostname === 'localhost' ? 'http://localhost:8787' : window.APP_CONFIG.API;
const $ = (id) => document.getElementById(id);
// 訊息小卡：從下方滑出，幾秒後自動收起；成功（✅）時放個小慶祝
let msgTimer;
const msg = (t) => {
  const m = $('msg');
  clearTimeout(msgTimer);
  if (!t) { m.classList.remove('show'); return; }
  m.textContent = t;
  m.classList.toggle('ok', t.startsWith('✅'));
  m.classList.add('show');
  if (t.startsWith('✅')) { celebrate(); navigator.vibrate?.(30); Sound.play('success'); }
  if (!/中…/.test(t)) msgTimer = setTimeout(() => m.classList.remove('show'), t.startsWith('✅') ? 4000 : 6000);
};
function celebrate(n = 14) {
  const pool = ['🎉', '✨', '🌟', '💛', '🥳', '👏', '🍀', '🎈'];
  const box = $('burst');
  for (let i = 0; i < n; i++) {
    const e = document.createElement('i');
    e.textContent = pool[Math.floor(Math.random() * pool.length)];
    e.style.left = 10 + Math.random() * 80 + '%';
    e.style.setProperty('--x', (Math.random() * 160 - 80) + 'px');
    e.style.setProperty('--r', (Math.random() * 360 - 180) + 'deg');
    e.style.animationDelay = Math.random() * .25 + 's';
    box.append(e);
    setTimeout(() => e.remove(), 1700);
  }
}

// 打招呼：依時段換一句，每次打開都不太一樣
(function greet() {
  const h = new Date().getHours();
  const sets = h < 5 ? ['夜深了，記完就去睡吧 🌙', '熬夜的靈感最珍貴 ✨']
    : h < 11 ? ['早安！今天也要元氣滿滿 ☀️', '早安，先把腦中的點子倒出來吧 🍳', '新的一天，從記一筆開始 🌱']
    : h < 14 ? ['午安！吃飽了嗎？🍱', '中午好，休息一下也能記點子 🍵']
    : h < 18 ? ['下午好，來點靈感吧 🍰', '午後時光，整理一下想法 📚', '加油，今天快完成了 💪']
    : ['晚安～今天辛苦了 🌆', '晚上好，回顧一下今天吧 🛋️', '收工前，把待辦交給我 ✅'];
  $('greet').textContent = sets[Math.floor(Math.random() * sets.length)];
})();
// 戳一下圖示：晃一晃，噴出小貼紙
$('pageIcon').onclick = () => {
  const el = $('pageIcon');
  el.classList.remove('spin'); void el.offsetWidth; el.classList.add('spin');
  celebrate(5); Sound.play('pop');
};

// 存好後問要不要打開 Notion（等寫字聲和彩帶跑完再跳出來）
// AI 小幫手：預設開啟，設定裡可以關掉
const aiEnabled = () => { try { return localStorage.getItem('ai') !== '0'; } catch { return true; } };
// 把 AI 建議填進確認卡：AI 有給的欄位，以 AI 為準（蓋過範本預設）；AI 沒給的欄位保留範本的值
const lastAi = {};
async function applyAi(db, props) {
  const p = panel(db); await p.ready;
  await tplJobs[db]; // 等範本預設值先套好，AI 再蓋上去
  lastAi[db] = props || {};
  for (const [k, v] of Object.entries(lastAi[db])) p.set(k, v);
}
// 確認卡最上面那行：顯示 AI 做了什麼，或為什麼沒做
function aiNote(db, text, kind = 'ok') {
  const el = $('ai-' + db); if (!el) return;
  el.hidden = !text; el.textContent = text || ''; el.dataset.kind = kind;
}
async function aiSuggest(db, text, onTitle, wantTitle = false) {
  if (!aiEnabled()) return aiNote(db, '');
  if (!text) return;
  aiNote(db, '✨ AI 整理中…', 'wait');
  try {
    const r = await api('/api/ai/suggest', { db, text, wantTitle });
    if (r.notice) return aiNote(db, '🤖 ' + r.notice, 'warn');
    if (r.title && onTitle) onTitle(r.title);
    await applyAi(db, r.props);
    const filled = Object.keys(r.props || {});
    if (r.title && onTitle) filled.unshift('標題');
    aiNote(db, filled.length ? '✨ AI 幫你填了：' + filled.join('、') + '（都可以改）' : '🤖 AI 看過了，沒有找到適合的分類', filled.length ? 'ok' : 'warn');
  } catch (e) { aiNote(db, '🤖 AI 沒回應：' + e.message, 'warn'); }
}

// 預設開啟；在設定裡可以關掉
const askEnabled = () => { try { return localStorage.getItem('askOpen') !== '0'; } catch { return true; } };
function askOpen(url, where) {
  loadBoard();
  if (!askEnabled() || !url || !/^https:\/\/([\w-]+\.)?notion\.(so|com|site)\//.test(url)) return;
  setTimeout(() => {
    $('askText').textContent = `已經放進「${where}」了，要打開 Notion 看看嗎？`;
    $('askYes').href = url;
    $('ask').hidden = false; $('askBg').hidden = false;
  }, 900);
}
function closeAsk() { $('ask').hidden = true; $('askBg').hidden = true; }
$('askNo').onclick = closeAsk;
$('askBg').onclick = closeAsk;
$('askYes').onclick = () => { Sound.play('tap'); setTimeout(closeAsk, 300); };

// ===== 整理庫 =====
const ORG_GROUPS = [['todo', '🔴 還沒整理'], ['doing', '🟡 整理中'], ['done', '🟢 已完成']];
const ORG_LABEL = { todo: '還沒整理', doing: '整理中', done: '完成' };
let orgItems = [];
function isToday(ts) { const a = new Date(ts), b = new Date(); return a.toDateString() === b.toDateString(); }
function paintOrganize() {
  const count = (st) => orgItems.filter((i) => i.status === st).length;
  $('orgToday').textContent = orgItems.filter((i) => isToday(i.savedAt)).length;
  $('orgTodo').textContent = count('todo'); $('orgDoing').textContent = count('doing'); $('orgDone').textContent = count('done');
  const list = $('orgList'); list.innerHTML = '';
  if (!orgItems.length) { list.innerHTML = '<p class="empty-org">最近 7 天還沒存知識～去知識庫存一筆吧 📚</p>'; return; }
  for (const [st, label] of ORG_GROUPS) {
    const items = orgItems.filter((i) => (i.status === 'unknown' ? 'todo' : i.status) === st);
    if (!items.length) continue;
    const g = document.createElement('section'); g.className = 'org-group g-' + st;
    const h = document.createElement('h3'); h.textContent = `${label}（${items.length}）`; g.append(h);
    for (const it of items) {
      const row = document.createElement('div'); row.className = 'org-item';
      const title = document.createElement('a'); title.className = 'org-title'; title.textContent = it.title;
      if (it.url && /^https:\/\/([\w-]+\.)?notion\.(so|com|site)\//.test(it.url)) { title.href = it.url; title.target = '_blank'; title.rel = 'noopener'; }
      const meta = document.createElement('span'); meta.className = 'org-meta';
      meta.textContent = (isToday(it.savedAt) ? '今天 ' : fmtDate(it.savedAt).split(' ')[0] + ' ') + `· 剩 ${daysLeft(it.savedAt)} 天`;
      const seg = document.createElement('div'); seg.className = 'seg';
      for (const s2 of ['todo', 'doing', 'done']) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = ORG_LABEL[s2]; b.classList.add('segb');
        if (s2 === it.status) b.classList.add('on');
        b.onclick = async () => {
          if (s2 === it.status) return;
          const old = it.status; it.status = s2; paintOrganize();
          try { await api('/api/organize/status', { id: it.id, status: s2 }); if (s2 === 'done') { celebrate(8); Sound.play('success'); } }
          catch (e) { it.status = old; paintOrganize(); msg(e.message); }
        };
        seg.append(b);
      }
      const write = document.createElement('button'); write.type = 'button'; write.className = 'write-btn segb'; write.textContent = '📝 寫筆記';
      write.onclick = () => openNote(it);
      const actions = document.createElement('div'); actions.className = 'org-actions'; actions.append(seg, write);
      row.append(title, meta, actions); g.append(row);
    }
    list.append(g);
  }
}
// 寫筆記：照這一頁的範本格式（段落標題）分段填；沒有範本格式就一整段加在最後面。草稿存在這台手機
let noteItem = null, noteSections = [];
const draftKey = (id) => 'draft2-' + id;
function readDraft(id) { try { return JSON.parse(localStorage.getItem(draftKey(id)) || '{}'); } catch { return {}; } }
function saveDraft() {
  if (!noteItem) return;
  const d = { other: $('noteText').value, sec: {} };
  document.querySelectorAll('#noteFields textarea').forEach((t) => { d.sec[t.dataset.id] = t.value; });
  try { localStorage.setItem(draftKey(noteItem.id), JSON.stringify(d)); } catch {}
  const n = [...document.querySelectorAll('#noteSheet textarea')].reduce((x, t) => x + t.value.length, 0);
  $('noteCount').textContent = n + ' 字';
}
async function openNote(it) {
  noteItem = it; noteSections = [];
  $('noteFor').textContent = '📚 ' + it.title; $('noteFor').href = it.url || '#';
  const d = readDraft(it.id);
  $('noteText').value = d.other || '';
  const box = $('noteFields'); box.innerHTML = '<p class="hint">讀取範本格式中…</p>';
  $('noteOtherLabel').textContent = '筆記';
  $('noteSheet').hidden = false; $('noteBg').hidden = false;
  try { noteSections = (await api('/api/organize/outline?id=' + it.id)).sections; } catch { noteSections = []; }
  if (noteItem !== it) return;
  box.innerHTML = '';
  for (const sec of noteSections) {
    const wrap = document.createElement('label'); wrap.className = 'note-sec';
    const head = document.createElement('div'); head.className = 'note-sec-head';
    const name = document.createElement('span'); name.textContent = sec.text;
    const mic = document.createElement('button'); mic.type = 'button'; mic.className = 'mini-mic'; mic.textContent = '🎤';
    const ta = document.createElement('textarea'); ta.rows = 3; ta.dataset.id = sec.id; ta.value = (d.sec || {})[sec.id] || '';
    ta.placeholder = `寫進「${sec.text}」`; ta.addEventListener('input', saveDraft);
    bindMic(mic, ta);
    head.append(name, mic); wrap.append(head, ta); box.append(wrap);
  }
  $('noteOtherLabel').textContent = noteSections.length ? '其他補充（加在頁面最後面）' : '筆記';
  saveDraft();
}
function closeNote() { $('noteSheet').hidden = true; $('noteBg').hidden = true; noteItem = null; }
$('noteText').addEventListener('input', saveDraft);
$('noteClose').onclick = closeNote; $('noteBg').onclick = closeNote;
async function saveNote(markDone) {
  if (!noteItem) return;
  const it = noteItem;
  const sections = {};
  document.querySelectorAll('#noteFields textarea').forEach((t) => { if (t.value.trim()) sections[t.dataset.id] = t.value; });
  const text = $('noteText').value.trim();
  if (!text && !Object.keys(sections).length) return msg('先寫點東西吧');
  $('noteSave').disabled = $('noteSaveDone').disabled = true; msg('存檔中…');
  try {
    const r = await api('/api/organize/note', { id: it.id, text, sections, markDone });
    try { localStorage.removeItem(draftKey(it.id)); } catch {}
    it.status = r.status; closeNote(); paintOrganize();
    msg(markDone ? '✅ 筆記已照範本格式存進 Notion，這則整理完成！' : '✅ 筆記已照範本格式存進 Notion');
  } catch (e) { msg(e.message); }
  finally { $('noteSave').disabled = $('noteSaveDone').disabled = false; }
}
$('noteSave').onclick = () => saveNote(false);
$('noteSaveDone').onclick = () => saveNote(true);

async function loadOrganize() {
  if (!getToken()) return;
  $('orgList').innerHTML = '<p class="empty-org">讀取中…</p>';
  try { orgItems = (await api('/api/organize')).items; paintOrganize(); }
  catch (e) { $('orgList').innerHTML = ''; msg(e.message); }
}

// ===== 公佈欄 =====
const DB_LABEL = { projects: '📁 專案庫', tasks: '✅ 任務庫', knowledge: '📚 知識庫' };
let boardItems = [];
function fmtDate(ts) { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function daysLeft(ts) { return Math.max(1, Math.ceil((ts + 7 * 86400000 - Date.now()) / 86400000)); }
function paintBoard() {
  const c = $('boardCount');
  c.hidden = !boardItems.length; c.textContent = boardItems.length > 99 ? '99+' : boardItems.length;
  const list = $('boardList');
  list.innerHTML = '';
  if (!boardItems.length) { list.innerHTML = '<p class="empty">還沒有東西～存一筆就會貼上來 ✨</p>'; return; }
  for (const it of boardItems) {
    const note = document.createElement('div');
    note.className = 'note n-' + it.db;
    const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = DB_LABEL[it.db] || it.db;
    const date = document.createElement('span'); date.className = 'date'; date.textContent = fmtDate(it.savedAt) + ` · 剩 ${daysLeft(it.savedAt)} 天`;
    const title = document.createElement(it.url ? 'a' : 'span'); title.className = 'title'; title.textContent = it.title;
    if (it.url && /^https:\/\/([\w-]+\.)?notion\.(so|com|site)\//.test(it.url)) { title.href = it.url; title.target = '_blank'; title.rel = 'noopener'; }
    const del = document.createElement('button'); del.type = 'button'; del.className = 'del'; del.textContent = '✕'; del.setAttribute('aria-label', '從公佈欄撕掉');
    del.onclick = () => askDelete(it, note);
    const top = document.createElement('div'); top.className = 'note-top'; top.append(tag, del);
    note.append(top, title, date);
    list.append(note);
  }
}
// 撕掉便利貼：選「只撕公佈欄」或「連 Notion 一起刪」
let delTarget = null;
function askDelete(it, note) {
  delTarget = { it, note };
  $('delText').textContent = `「${it.title}」`;
  $('del').hidden = false; $('delBg').hidden = false;
}
function closeDel() { $('del').hidden = true; $('delBg').hidden = true; delTarget = null; }
async function doDelete(alsoNotion) {
  if (!delTarget) return;
  const { it, note } = delTarget;
  closeDel();
  note.classList.add('tearing');
  try {
    await api('/api/board/delete', { id: it.id, alsoNotion });
    boardItems = boardItems.filter((x) => x.id !== it.id);
    setTimeout(paintBoard, 250);
    msg(alsoNotion ? '🗑️ 已從 Notion 刪除（在 Notion 垃圾桶可以救回）' : '📌 已從公佈欄撕掉');
  } catch (e) { note.classList.remove('tearing'); msg(e.message); }
}
$('delBoard').onclick = () => doDelete(false);
$('delNotion').onclick = () => doDelete(true);
$('delCancel').onclick = closeDel;
$('delBg').onclick = closeDel;

async function loadBoard() {
  if (!getToken()) return;
  try { boardItems = (await api('/api/board')).items; paintBoard(); } catch {}
}
function openBoard(open) { $('board').hidden = !open; $('boardBg').hidden = !open; if (open) loadBoard(); }
$('boardBtn').onclick = () => openBoard(true);
$('boardClose').onclick = () => openBoard(false);
$('boardBg').onclick = () => openBoard(false);

// 所有凸起的按鈕：按下就有「咔」一聲（圖示貼紙另有自己的聲音）
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('button');
  if (b && !b.disabled && b.id !== 'pageIcon') Sound.play('tap');
});

// ===== 設定面板 =====
function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}
const setSwitch = (id, on) => $(id).setAttribute('aria-checked', on ? 'true' : 'false');
function paintSettings() {
  setSwitch('themeSwitch', isDark());
  setSwitch('sfxSwitch', Sound.sfx);
  setSwitch('bgmSwitch', Sound.bgm);
  setSwitch('askSwitch', askEnabled());
  setSwitch('aiSwitch', aiEnabled());
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', isDark() ? '#121212' : '#fbfaf7'));
  document.querySelector('#settings .app-only').hidden = !getToken();
  if (window.Notification && Notification.permission === 'granted') $('pushBtn').textContent = '重新連結';
}
function openSettings(open) {
  $('settings').hidden = !open; $('sheetBg').hidden = !open;
  if (open) paintSettings();
}
$('settingsBtn').onclick = () => openSettings(true);
$('settingsClose').onclick = () => openSettings(false);
$('sheetBg').onclick = () => openSettings(false);
$('themeSwitch').onclick = () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch {}
  paintSettings();
};
$('sfxSwitch').onclick = () => { Sound.setSfx(!Sound.sfx); paintSettings(); };
$('bgmSwitch').onclick = () => { Sound.setBgm(!Sound.bgm); paintSettings(); };
$('aiSwitch').onclick = () => { try { localStorage.setItem('ai', aiEnabled() ? '0' : '1'); } catch {} paintSettings(); };
$('askSwitch').onclick = () => { try { localStorage.setItem('askOpen', askEnabled() ? '0' : '1'); } catch {} paintSettings(); };
paintSettings();
document.body.dataset.tab = 'note';

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
  $('boardBtn').hidden = !logged;
  if (logged) loadBoard();
  $('login').hidden = logged;
  $('app').hidden = !logged;
}

$('loginBtn').onclick = async () => {
  msg('登入中…');
  try { setToken((await api('/api/login', { password: $('pw').value })).token); $('pw').value = ''; msg(''); show(); loadTemplates('projects'); }
  catch (e) { msg(e.message); }
};
$('pw').onkeydown = (e) => { if (e.key === 'Enter') $('loginBtn').click(); };
$('logoutBtn').onclick = () => { setToken(null); openSettings(false); show(); msg('已登出'); };

$('checkBtn').onclick = async () => {
  openSettings(false); msg('檢查中…');
  try { const r = await api('/api/health'); msg(Object.entries(r.notion).map(([k, v]) => `${k}：${v === 'ok' ? '✅ 已連上' : '❌ ' + v}`).join('\n')); }
  catch (err) { msg(err.message); }
};

// 專案庫：先跳出確認卡（標題、欄位、範本），確認後才送出
$('noteNextBtn').onclick = () => {
  const text = $('text').value.trim();
  if (!text) return msg('先寫點東西吧');
  $('noteTitle').value = text.split('\n')[0].slice(0, 40);
  $('noteForm').hidden = false;
  lastAi.projects = {};
  panel('projects'); loadTemplates('projects');
  msg('選好欄位後按「確認送出」');
  const typed = $('noteTitle').value;
  aiSuggest('projects', text, (t) => { if ($('noteTitle').value === typed) $('noteTitle').value = t; });
};
$('saveBtn').onclick = async () => {
  const text = $('text').value.trim();
  if (!text) return msg('先寫點東西吧');
  $('saveBtn').disabled = true; msg(tplWait('projects'));
  try { const r = await api('/api/note', { text, title: $('noteTitle').value, props: panels.projects ? panels.projects.collect() : undefined, templateId: $('tpl-projects').value }); $('text').value = ''; $('noteForm').hidden = true; lastAi.projects = {}; panels.projects?.reset(); msg('✅ 已存到「專案庫」'); askOpen(r.url, '專案庫'); }
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
    document.body.dataset.tab = t.dataset.tab;
    $('tab-note').hidden = t.dataset.tab !== 'note';
    $('tab-plan').hidden = t.dataset.tab !== 'plan';
    $('tab-video').hidden = t.dataset.tab !== 'video';
    $('tab-org').hidden = t.dataset.tab !== 'org';
    if (t.dataset.tab === 'org') loadOrganize();
    msg('');
  };
});

// 語音輸入：用瀏覽器內建的語音辨識，聲音不經過我們的後端
const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
function bindMic(btn, box) {
  const label = btn.textContent;
  btn.onclick = () => {
    if (!Speech) return msg('這個瀏覽器不支援語音輸入，請改用打字（也可以用鍵盤上的麥克風）');
    if (rec) { rec.stop(); return; }
    box = box || $(btn.dataset.for);
    rec = new Speech();
    rec.lang = 'zh-TW'; rec.interimResults = true; rec.continuous = true;
    const before = box.value;
    rec.onresult = (e) => { box.value = before + Array.from(e.results).map((r) => r[0].transcript).join(''); box.dispatchEvent(new Event('input')); };
    rec.onerror = (e) => msg(e.error === 'not-allowed' ? '請允許使用麥克風' : '語音辨識中斷，可以再按一次');
    rec.onend = () => { rec = null; btn.classList.remove('recording'); btn.textContent = label; };
    rec.start(); btn.classList.add('recording'); btn.textContent = label.length > 2 ? '⏹ 停止' : '⏹'; msg('');
  };
}
document.querySelectorAll('.mic').forEach((btn) => bindMic(btn));

// 日程：先看懂句子，讓使用者確認時間，再存
const pad = (n) => String(n).padStart(2, '0');
function toLocalInput(ts) { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }

$('parseBtn').onclick = async () => {
  const text = $('planText').value.trim();
  if (!text) return msg('先說或打一句任務吧');
  msg('讀取中…');
  try {
    if (aiEnabled()) msg('✨ AI 理解中…');
    const r = await api('/api/schedule/parse', { text, ai: aiEnabled() });
    $('planTitle').value = r.title;
    $('planAt').value = r.at ? toLocalInput(r.at) : '';
    $('planForm').hidden = false;
    panel('tasks'); await loadTemplates('tasks');
    if (r.props && Object.keys(r.props).length) await applyAi('tasks', r.props);
    aiNote('tasks', !aiEnabled() ? '' : r.notice ? '🤖 ' + r.notice : r.ai ? '✨ AI 幫你看懂了：' + ['要做什麼', r.at && '時間', ...Object.keys(r.props || {})].filter(Boolean).join('、') + '（都可以改）' : '', r.notice ? 'warn' : 'ok');
    msg(r.at ? '選好欄位後按「確認送出」' : '沒聽出時間，請在「時間」欄自己選');
  } catch (e) { msg(e.message); }
};

$('planSaveBtn').onclick = async () => {
  const at = $('planAt').value ? new Date($('planAt').value).getTime() : NaN;
  if (!Number.isFinite(at)) return msg('請選擇時間');
  const before = Number($('planBefore').value);
  $('planSaveBtn').disabled = true; msg(tplWait('tasks'));
  try {
    const r = await api('/api/schedule', { title: $('planTitle').value, at, remind: before >= 0, remindBefore: Math.max(before, 0), props: panel('tasks').collect(), templateId: $('tpl-tasks').value });
    lastAi.tasks = {}; panel('tasks').reset();
    $('planText').value = ''; $('planForm').hidden = true;
    msg('✅ 已存到「任務庫」' + (before >= 0 ? '，時間到會通知你' : ''));
    askOpen(r.url, '任務庫');
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
  try { await enablePush(); msg('✅ 通知已開啟'); $('pushBtn').textContent = '重新連結'; }
  catch (e) { msg(e.message); }
};
$('pushTestBtn').onclick = async () => {
  openSettings(false); msg('送出中…');
  try { const r = await api('/api/push/test', {}); msg(r.devices ? `已送出到 ${r.ok}/${r.devices} 台裝置` : '還沒有裝置開啟通知，請先按「開啟提醒通知」'); }
  catch (err) { msg(err.message); }
};

// 影片：抓資料 → 確認 → 存到知識庫
function openTab(name) { document.querySelector(`.tab[data-tab="${name}"]`).click(); }
$('videoPreviewBtn').onclick = async () => {
  const url = $('videoUrl').value.trim();
  if (!url) return msg('先貼上影片網址');
  msg('抓影片資料中…（約 3 秒）');
  try {
    const r = await api('/api/video/preview', { url });
    $('videoTitle').value = r.title || '';
    $('videoThumb').hidden = !r.thumbnail;
    if (r.thumbnail) $('videoThumb').src = r.thumbnail;
    $('videoMeta').textContent = [r.platform, r.author && '作者：' + r.author, r.uploadDate && '上傳：' + r.uploadDate].filter(Boolean).join('　') + (r.caption ? '\n📝 ' + r.caption.slice(0, 80) + (r.caption.length > 80 ? '…' : '') : '');
    $('videoForm').hidden = false;
    // 先等範本預設值套好，再填影片資料，才不會被範本洗掉
    const kp = panel('knowledge'); await kp.ready;
    await loadTemplates('knowledge'); await tplJobs.knowledge;
    kp.reset();
    lastAi.knowledge = {}; videoAuto = r; fillVideoAuto();
    const shownTitle = $('videoTitle').value;
    aiSuggest('knowledge', [r.title && '標題：' + r.title, r.author && '頻道：' + r.author, r.platform, r.caption && '內文：' + r.caption].filter(Boolean).join('\n'),
      (t) => { if ($('videoTitle').value === shownTitle) $('videoTitle').value = t; }, !!r.caption);
    msg(r.title ? '選好欄位後按「確認送出」' : '抓不到標題（IG／Threads 常擋），可以自己填，或直接存');
  } catch (e) { msg(e.message); }
};
// 影片自動抓到的資料：蓋過範本預設；抓不到的就保留範本的值
let videoAuto = null; lastAi.knowledge = {};
function fillVideoAuto() {
  const r = videoAuto; if (!r || $('videoForm').hidden) return;
  const kp = panel('knowledge');
  if (r.author) kp.set('作者', [r.author.replace(/,/g, ' ')]); // 影片發布者（已有標籤就選到，新的會自動新增）
  if (r.uploadDate) kp.set('上傳日期', r.uploadDate);
  kp.set('課堂筆記通路', r.channel || (r.platform === 'IG' ? 'IG' : 'YouTube'));
  kp.set('相關連結', r.url);
}

// 範本清單：每個資料庫第一次用到時讀取。知識庫預設「課堂筆記模板」，其他用 Notion 設的預設範本
const tplLoaded = {};
const tplJobs = {}; // 正在讀範本／套用範本的工作，讓別的地方可以等它做完
function loadTemplates(db) {
  if (!tplLoaded[db]) { tplLoaded[db] = true; tplJobs[db] = loadTemplatesNow(db); }
  return tplJobs[db];
}
async function loadTemplatesNow(db) {
  const sel = $('tpl-' + db);
  try {
    const { templates } = await api('/api/templates?db=' + db);
    sel.innerHTML = '';
    sel.add(new Option('不用範本', ''));
    for (const t of templates) sel.add(new Option(t.name, t.id));
    const pick = (db === 'knowledge' && templates.find((t) => t.name.includes('課堂筆記'))) || templates.find((t) => t.isDefault);
    if (pick) sel.value = pick.id;
    await applyTemplate(db);
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
  if ($('tpl-' + db).value === id) {
    await panel(db).useTemplate(id ? values : null);
    if (db === 'knowledge') fillVideoAuto(); // 換範本後，影片自動抓到的資料要補回來
    const p = panel(db); for (const [k, v] of Object.entries(lastAi[db] || {})) p.set(k, v); // AI 建議也補回來（以 AI 為準）
  }
}
['projects', 'tasks', 'knowledge'].forEach((db) => { $('tpl-' + db).onchange = () => { tplJobs[db] = applyTemplate(db); }; });

const tplWait = (db) => ($('tpl-' + db).value ? '存檔中…（套用範本約需 5 秒）' : '存檔中…');

$('videoSaveBtn').onclick = async () => {
  $('videoSaveBtn').disabled = true; msg(tplWait('knowledge'));
  try {
    const r = await api('/api/video', { url: $('videoUrl').value.trim(), title: $('videoTitle').value, props: panel('knowledge').collect(), templateId: $('tpl-knowledge').value });
    $('videoForm').hidden = true; $('videoUrl').value = ''; videoAuto = null; lastAi.knowledge = {};
    askOpen(r.url, '知識庫');
    msg('✅ 已存到「知識庫」');
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
