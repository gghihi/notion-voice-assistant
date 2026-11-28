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
let noteItem = null, noteSections = [], noteItems = {};
// 打開時 Notion 裡原本的內容，用來比對「改了哪些」
let origItems = {}, origPlain = {}, origOrder = {};
const strip = (x) => JSON.stringify({ ...x, bid: undefined, locked: undefined, dirty: undefined });
// 範本按鈕的對照：段落名稱有「大綱」→ 重點按鈕；有「回顧」或「問題」→ 一般問題
const presetOf = (sec) => sec.preset !== undefined ? sec.preset : (!sec.hasButton ? null : /大綱/.test(sec.text) ? 'point' : /回顧|問題/.test(sec.text) ? 'qa' : null);
const draftKey = (id) => 'draft3-' + id;
function readDraft(id) { try { return JSON.parse(localStorage.getItem(draftKey(id)) || '{}'); } catch { return {}; } }
function saveDraft() {
  if (!noteItem) return;
  const d = { edited: true, other: $('noteText').value, sec: {}, items: noteItems, notes: sectionNotes };
  document.querySelectorAll('#noteFields textarea[data-id]').forEach((t) => { d.sec[t.dataset.id] = t.value; });
  try { localStorage.setItem(draftKey(noteItem.id), JSON.stringify(d)); } catch {}
  updateCount();
}
function updateCount() {
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
  setMode(false); $('aiStatus').textContent = ''; $('aiHint').value = '';
  let video = null;
  try { const o = await api('/api/organize/outline?id=' + it.id); noteSections = o.sections; video = o.video; } catch { noteSections = []; }
  if (noteItem !== it) return;
  // 影片放在筆記本最上面，邊看邊寫（往下捲也會黏在上方）
  const src = embedSrc(video);
  $('notePlayer').hidden = !src;
  $('notePlayer').innerHTML = src ? `<iframe src="${src}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" title="影片"></iframe>` : '';
  if (video?.platform === 'IG' || video?.platform === 'Threads') $('notePlayer').classList.add('tall'); else $('notePlayer').classList.remove('tall');
  box.innerHTML = '';
  // 已經存進 Notion 的筆記先讀出來，可以直接修改（有沒存的草稿就先用草稿）
  origItems = {}; origPlain = {}; origOrder = {};
  const hasDraft = !!d.edited; // 只有真的動過才算草稿
  noteItems = hasDraft ? (d.items || {}) : {};
  sectionNotes = hasDraft ? (d.notes || {}) : {};
  for (const sec of noteSections) {
    const ex = sec.existing;
    if (!ex) continue;
    if (ex.items) {
      origItems[sec.id] = Object.fromEntries(ex.items.map((x) => [x.bid, strip(x)]));
      origOrder[sec.id] = ex.items.map((x) => x.bid);
      if (!hasDraft) noteItems[sec.id] = JSON.parse(JSON.stringify(ex.items));
    } else if (ex.paraIds) origPlain[sec.id] = { text: ex.text || '', ids: ex.paraIds };
  }
  for (const sec of noteSections) {
    if (/影片/.test(sec.text) && src) continue; // 「課程影片」那一段就用上面的播放器，不用再寫
    const preset = presetOf(sec);
    if (preset) { box.append(buildPreset(sec, preset)); continue; }
    const wrap = document.createElement('label'); wrap.className = 'note-sec plain-sec'; wrap.hidden = true; // 一般段落改在 AI 模式填
    const head = document.createElement('div'); head.className = 'note-sec-head';
    const name = document.createElement('span'); name.textContent = sec.text;
    const ta = document.createElement('textarea'); ta.rows = 3; ta.dataset.id = sec.id; ta.value = hasDraft ? ((d.sec || {})[sec.id] ?? origPlain[sec.id]?.text ?? '') : (origPlain[sec.id]?.text || '');
    ta.placeholder = `寫進「${sec.text}」`; ta.dataset.name = sec.text; ta.addEventListener('input', saveDraft);
    head.append(name); wrap.append(head, ta); box.append(wrap);
  }
  // 有範本格式就照格式寫，不另外放「其他補充」
  const hasSections = !!box.children.length;
  if (hasSections && !box.querySelector('.note-sec:not(.plain-sec)')) {
    const tip = document.createElement('p'); tip.className = 'hint'; tip.textContent = '這一頁的段落都是一般文字段落，請到「✨ AI 撰寫」填寫'; box.prepend(tip);
  }
  $('noteOther').hidden = hasSections; $('noteMic').hidden = hasSections;
  if (hasDraft && !hasSections && d.other) $('noteText').value = d.other;
  if (hasSections) $('noteText').value = '';
  updateCount();
}
// 「＋ 重點／＋ 副重點／＋ 一般問題」：和 Notion 範本按鈕插入的格式一樣
function field(tag, placeholder, value, onInput, cls) {
  const e = document.createElement(tag); e.placeholder = placeholder; e.value = value || ''; if (cls) e.className = cls;
  if (tag === 'textarea') e.rows = 2;
  e.addEventListener('input', () => { onInput(e.value); saveDraft(); });
  return e;
}
function smallBtn(text, onClick, cls = 'add-btn') { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = text; b.onclick = onClick; return b; }
// 網址書籤清單：每列一個網址，存進 Notion 會變成書籤（有網站預覽卡）
function linkList(holder) {
  holder.links ||= [];
  const box = document.createElement('div'); box.className = 'links';
  const paint = () => {
    box.innerHTML = '';
    holder.links.forEach((u, k) => {
      const row = document.createElement('div'); row.className = 'link-row';
      const inp = field('input', 'https://網址', u, (v) => { holder.links[k] = v.trim(); });
      inp.type = 'url'; inp.inputMode = 'url';
      row.append(document.createTextNode('🔖'), inp, smallBtn('✕', () => { holder.links.splice(k, 1); paint(); saveDraft(); }, 'del-inline'));
      box.append(row);
    });
    box.append(smallBtn('＋ 網址書籤', () => { holder.links.push(''); paint(); saveDraft(); box.querySelector('.link-row:last-of-type input')?.focus(); }, 'add-btn tiny'));
  };
  paint();
  return box;
}
function buildPreset(sec, kind) {
  const wrap = document.createElement('div'); wrap.className = 'note-sec preset';
  const head = document.createElement('div'); head.className = 'note-sec-head'; head.innerHTML = '<span></span>'; head.firstChild.textContent = sec.text;
  const list = document.createElement('div'); list.className = 'preset-list';
  const items = (noteItems[sec.id] ||= []);
  const paint = () => {
    list.innerHTML = '';
    items.forEach((it, idx) => {
      const card = document.createElement('div'); card.className = 'preset-card ' + kind;
      const del = smallBtn('✕', () => { if (it.bid && !confirm('要把這一項從 Notion 刪掉嗎？')) return; items.splice(idx, 1); paint(); saveDraft(); }, 'del-mini');
      if (it.bid) card.classList.add('saved');
      // ⬆️⬇️ 調整順序（這一段有鎖住的項目時不能換，因為 Notion 沒辦法移動那一項）
      if (!items.some((x) => x.locked) && items.length > 1) {
        const mv = document.createElement('div'); mv.className = 'move';
        const up = smallBtn('⬆️', () => { if (idx > 0) { [items[idx - 1], items[idx]] = [items[idx], items[idx - 1]]; paint(); saveDraft(); } }, 'mv-btn');
        const dn = smallBtn('⬇️', () => { if (idx < items.length - 1) { [items[idx + 1], items[idx]] = [items[idx], items[idx + 1]]; paint(); saveDraft(); } }, 'mv-btn');
        up.disabled = idx === 0; dn.disabled = idx === items.length - 1;
        mv.append(up, dn); card.append(mv);
      }
      if (it.locked) { // 裡面有圖片等 APP 不能編輯的內容：只顯示，避免改壞
        card.classList.add('locked');
        const t = document.createElement('b'); t.textContent = (kind === 'qa' ? (it.q || '?') : it.title) || '（無標題）';
        const n = document.createElement('p'); n.className = 'hint'; n.textContent = '🔒 這一項裡有圖片或其他 APP 不能編輯的內容，請到 Notion 修改';
        card.append(t, n); list.append(card); return;
      }
      if (kind === 'qa') {
        card.append(del, field('input', '問題（預設「?」）', it.q, (v) => { it.q = v; }), field('textarea', '答案／筆記', it.a, (v) => { it.a = v; }), linkList(it));
      } else {
        const subs = document.createElement('div'); subs.className = 'subs';
        const paintSubs = () => {
          subs.innerHTML = '';
          it.subs.forEach((sb, j) => {
            const row = document.createElement('div'); row.className = 'sub';
            row.append(smallBtn('✕', () => { it.subs.splice(j, 1); paintSubs(); saveDraft(); }, 'del-mini'),
              field('input', '小重點標題', sb.title, (v) => { sb.title = v; }), field('textarea', '內容', sb.text, (v) => { sb.text = v; }));
            // 程式筆記用：小重點裡加一個程式碼／提示詞框（存成 Notion 的程式碼區塊）
            row.append(linkList(sb));
            if (sb.code !== undefined) {
              const lang = document.createElement('select'); lang.className = 'code-lang';
              ['xml', 'plain text', 'markdown', 'javascript', 'python', 'html', 'css', 'json', 'bash', 'sql'].forEach((l) => lang.add(new Option(l === 'plain text' ? '純文字' : l.toUpperCase(), l)));
              lang.value = sb.lang || 'xml'; lang.onchange = () => { sb.lang = lang.value; saveDraft(); };
              const code = field('textarea', '程式碼／提示詞', sb.code, (v) => { sb.code = v; }, 'code-box');
              row.append(lang, code);
            } else {
              row.append(smallBtn('＋ 程式碼／提示詞', () => { sb.code = ''; sb.lang = 'xml'; paintSubs(); saveDraft(); }, 'add-btn tiny'));
            }
            subs.append(row);
          });
          subs.append(smallBtn('＋ 小重點（副重點／提示詞）', () => { it.subs.push({ title: '', text: '' }); paintSubs(); saveDraft(); }));
        };
        it.subs ||= [];
        paintSubs();
        card.append(del, field('input', '重點標題', it.title, (v) => { it.title = v; }, 'point-title'), subs);
      }
      list.append(card);
    });
    list.append(smallBtn(kind === 'qa' ? '＋ 一般問題' : '＋ 重點', () => {
      items.push(kind === 'qa' ? { kind, q: '', a: '' } : { kind, title: '', subs: [{ title: '', text: '' }] }); paint(); saveDraft();
      list.querySelector('.preset-card:last-of-type input')?.focus();
    }));
  };
  paint();
  wrap.append(head, list);
  return wrap;
}

// ===== 手動／AI 撰寫切換 =====
function setMode(ai) {
  $('modeAi').classList.toggle('on', ai); $('modeManual').classList.toggle('on', !ai);
  $('aiPanel').hidden = !ai;
  if (ai) renderPreview();
  $('noteFields').hidden = ai;
  if (ai) $('noteOther').hidden = true; else $('noteOther').hidden = !!$('noteFields').children.length;
  $('noteMic').hidden = true; // 語音都在 AI 撰寫模式裡
  if (ai) renderVoiceList();
}
// AI 模式的「單段想法」：每一段一個打字框＋麥克風，AI 會讀你寫的想法，照那一段的格式整理
let sectionNotes = {};
function aiTargets() {
  const hasPlayer = !$('notePlayer').hidden;
  const list = noteSections.filter((s2) => !(hasPlayer && /影片/.test(s2.text)));
  return list.length ? list : [{ id: '_free', text: '筆記' }];
}
function renderVoiceList() {
  const list = $('voiceList'); list.innerHTML = '';
  for (const sec of aiTargets()) {
    const row = document.createElement('div'); row.className = 'voice-row';
    const head = document.createElement('div'); head.className = 'note-sec-head';
    const name = document.createElement('b'); name.textContent = sec.text;
    const mic = document.createElement('button'); mic.type = 'button'; mic.className = 'mini-mic'; mic.textContent = '🎤';
    head.append(name, mic);
    const ta = document.createElement('textarea'); ta.rows = 2; ta.value = sectionNotes[sec.id] || '';
    ta.placeholder = `對「${sec.text}」的想法、重點…`;
    ta.addEventListener('input', () => { sectionNotes[sec.id] = ta.value; saveDraft(); });
    bindMic(mic, ta);
    const go = smallBtn('✨ 只整理這段', () => runAi([sec.id]), 'add-btn tiny');
    row.append(head, ta, go); list.append(row);
  }
}
$('modeManual').onclick = () => setMode(false);
$('modeAi').onclick = () => { if (!aiEnabled()) return msg('AI 小幫手在設定裡關掉了，打開後才能用'); setMode(true); };
bindMic($('aiHintMic'), $('aiHint'));


// 「目前筆記的樣子」：用 Notion 的樣式預覽筆記本裡現在的內容（已存的＋還沒存的）
function renderPreview() {
  const box = $('notePreview'); box.innerHTML = '';
  const add = (tag, text, cls) => { const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; return e; };
  const sec = {}; document.querySelectorAll('#noteFields textarea[data-id]').forEach((t) => { sec[t.dataset.id] = t.value; });
  let any = false;
  for (const s2 of noteSections) {
    const items = noteItems[s2.id];
    const text = sec[s2.id];
    if (!(items && items.length) && !(text && text.trim())) continue;
    any = true;
    box.append(add('h4', s2.text, 'pv-h1'));
    for (const it of items || []) {
      if (it.kind === 'qa') {
        const d = document.createElement('details'); d.open = true;
        d.append(add('summary', it.q || '?'));
        if (it.a) d.append(add('p', it.a));
        (it.links || []).filter(Boolean).forEach((u) => d.append(add('p', '🔖 ' + u, 'pv-link')));
        box.append(d);
      } else {
        const d = document.createElement('details'); d.open = true; d.className = 'pv-point';
        d.append(add('summary', it.title || '重點'));
        for (const sb of it.subs || []) {
          const d2 = document.createElement('details'); d2.open = true; d2.className = 'pv-sub';
          d2.append(add('summary', sb.title || '小重點'));
          if (sb.text) d2.append(add('p', sb.text));
          (sb.links || []).filter(Boolean).forEach((u) => d2.append(add('p', '🔖 ' + u, 'pv-link')));
          if (sb.code) d2.append(add('pre', sb.code));
          d.append(d2);
        }
        box.append(d);
      }
    }
    if (text && text.trim()) box.append(add('p', text));
  }
  const other = $('noteText').value.trim();
  if (other) { any = true; box.append(add('h4', '📝 我的筆記', 'pv-h1'), add('p', other)); }
  if (!any) box.append(add('p', '還沒有內容，按「開始撰寫」讓 AI 幫你寫一份 ✨', 'hint'));
}
$('aiGo').onclick = () => runAi(null);
async function runAi(only) {
  if (!noteItem) return;
  const it = noteItem;
  $('aiGo').disabled = true;
  const dots = ['看影片中', '整理重點中', '照範本排版中', '快好了'];
  let k = 0; $('aiStatus').textContent = '✨ ' + dots[0] + '…（約 10～50 秒）';
  const timer = setInterval(() => { k = Math.min(k + 1, dots.length - 1); $('aiStatus').textContent = '✨ ' + dots[k] + '…'; }, 9000);
  try {
    const { draft } = await api('/api/organize/ai', { id: it.id, hint: $('aiHint').value.trim(), notes: sectionNotes, only });
    if (noteItem !== it) return;
    // 把 AI 草稿加進筆記本（加在原本內容後面，不蓋掉你寫的），再切回手動模式
    const sec = {};
    document.querySelectorAll('#noteFields textarea[data-id]').forEach((t) => { sec[t.dataset.id] = t.value; });
    let other = $('noteText').value;
    let count = 0;
    for (const [sid, v] of Object.entries(draft || {})) {
      if (Array.isArray(v)) { (noteItems[sid] ||= []).push(...v); count += v.length; }
      else if (v && v.text) {
        if (sid === '_free') other = (other ? other + '\n\n' : '') + v.text;
        else sec[sid] = (sec[sid] ? sec[sid] + '\n\n' : '') + v.text;
        count++;
      }
    }
    if (!count) { $('aiStatus').textContent = '🤖 AI 沒寫出內容，可以換個說法再試，或改用手動'; return; }
    if (only) only.forEach((sid) => { delete sectionNotes[sid]; }); else sectionNotes = {}; // 整理完就清掉想法
    try { localStorage.setItem(draftKey(it.id), JSON.stringify({ edited: true, other, sec, items: noteItems, notes: sectionNotes })); } catch {}
    $('aiStatus').textContent = '';
    await openNote(it); // 用剛剛的草稿重新排版
    setMode(true); // 留在 AI 模式，下面直接看到寫好的樣子
    msg('✨ AI 寫好了！下面是筆記的樣子，要改就切到「手動撰寫」，沒問題就按「存起來」');
  } catch (e) { $('aiStatus').textContent = '🤖 ' + e.message; }
  finally { clearInterval(timer); $('aiGo').disabled = false; }
}

function closeNote() { $('noteSheet').hidden = true; $('noteBg').hidden = true; noteItem = null; $('notePlayer').innerHTML = ''; } // 關掉就停止播放
// 影片網址 → 可以嵌入播放的網址（只接受這三個平台）
function embedSrc(v) {
  if (!v || !v.id || !/^[\w-]+$/.test(v.id)) return null;
  if (v.platform === 'YouTube') return `https://www.youtube-nocookie.com/embed/${v.id}?playsinline=1&rel=0`;
  if (v.platform === 'IG') { const m = (v.url || '').match(/instagram\.com\/(p|reel|tv)\/([\w-]+)/); return m ? `https://www.instagram.com/${m[1]}/${m[2]}/embed/` : null; }
  if (v.platform === 'Threads' && !v.share) { const m = (v.url || '').match(/threads\.com\/(@[\w.]+)\/post\/([\w-]+)/); return m ? `https://www.threads.com/${m[1]}/post/${m[2]}/embed` : null; }
  return null;
}
$('noteText').addEventListener('input', saveDraft);
$('noteClose').onclick = closeNote; $('noteBg').onclick = closeNote;
async function saveNote(markDone) {
  if (!noteItem) return;
  const it = noteItem;
  const sections = {}, plain = {};
  document.querySelectorAll('#noteFields textarea[data-id]').forEach((t) => {
    const sid = t.dataset.id, o = origPlain[sid];
    if (o) { if (t.value.trim() !== o.text.trim()) plain[sid] = { text: t.value, oldIds: o.ids }; } // 改了原本的
    else if (t.value.trim()) sections[sid] = t.value; // 原本沒有，新加
  });
  const hasLink = (o) => (o.links || []).some((u) => /^https?:\/\//.test(u || ''));
  const filled = (x) => x.kind === 'qa' ? (x.q || x.a || hasLink(x)) : (x.title || (x.subs || []).some((s2) => s2.title || s2.text || s2.code || hasLink(s2)));
  const items = {}, deleted = {}, reorder = [];
  for (const [sid, list] of Object.entries(noteItems)) {
    const orig = origItems[sid] || {};
    const out = [];
    // 有沒有換順序：已存的項目順序變了，或新項目被移到已存項目前面
    const saved = (list || []).map((x, i) => [x.bid, i]).filter(([b]) => b);
    const before = (origOrder[sid] || []).filter((b) => saved.some(([x]) => x === b));
    const lastSaved = saved.length ? saved[saved.length - 1][1] : -1;
    const moved = saved.map(([b]) => b).join() !== before.join() || (list || []).some((x, i) => !x.bid && i < lastSaved && filled(x));
    if (moved && !(list || []).some((x) => x.locked)) {
      reorder.push(sid);
      items[sid] = (list || []).filter((x) => x.bid || filled(x));
      const gone = Object.keys(orig).filter((bid) => !(list || []).some((x) => x.bid === bid));
      if (gone.length) deleted[sid] = gone;
      continue;
    }
    for (const x of list || []) {
      if (x.bid) { if (orig[x.bid] !== undefined && strip(x) !== orig[x.bid]) out.push({ ...x, dirty: true }); }
      else if (filled(x)) out.push(x);
    }
    if (out.length) items[sid] = out;
    const gone = Object.keys(orig).filter((bid) => !(list || []).some((x) => x.bid === bid));
    if (gone.length) deleted[sid] = gone;
  }
  for (const [sid, orig] of Object.entries(origItems)) {
    if (!noteItems[sid]) { const gone = Object.keys(orig); if (gone.length) deleted[sid] = gone; }
  }
  const text = $('noteText').value.trim();
  const changed = text || Object.keys(sections).length || Object.keys(plain).length || Object.keys(items).length || Object.keys(deleted).length || reorder.length;
  if (!changed && !markDone) return msg('沒有任何修改');
  $('noteSave').disabled = $('noteSaveDone').disabled = true; msg('存檔中…');
  try {
    let r = { status: markDone ? 'done' : it.status };
    if (changed) r = await api('/api/organize/note', { id: it.id, text, sections, plain, items, deleted, reorder, markDone });
    else await api('/api/organize/status', { id: it.id, status: 'done' });
    try { localStorage.removeItem(draftKey(it.id)); } catch {}
    it.status = r.status; closeNote(); paintOrganize();
    msg(markDone ? '✅ 筆記已存進 Notion，這則整理完成！' : '✅ 筆記已存進 Notion');
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
