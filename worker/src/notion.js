// 和 Notion 溝通。金鑰只在 Cloudflare 的 env.NOTION_TOKEN，不會送到網頁。
const API = 'https://api.notion.com/v1';

async function call(env, path, method = 'GET', body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + env.NOTION_TOKEN,
      'Notion-Version': env.NOTION_VERSION || '2025-09-03',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error('notion_' + res.status);
    err.status = res.status;
    err.code = data.code; // 只記錯誤代碼，不記內容
    throw err;
  }
  return data;
}

// 把長文字切成 Notion 能接受的段落（每段最多 2000 字）
export function paragraphs(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    for (let i = 0; i < Math.max(line.length, 1); i += 2000) {
      out.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: line ? [{ type: 'text', text: { content: line.slice(i, i + 2000) } }] : [] } });
    }
  }
  return out.slice(0, 100); // Notion 一次最多 100 段
}

export function noteTitle(text) {
  const first = String(text).trim().split('\n')[0];
  return first.length > 40 ? first.slice(0, 40) + '…' : first;
}

// 確認三個資料庫都連得到（健康檢查用）
export async function checkDataSources(env) {
  const result = {};
  for (const [name, id] of [['筆記', env.NOTES_DS], ['日程', env.TASKS_DS], ['知識庫', env.KNOWLEDGE_DS]]) {
    try {
      if (!id) throw new Error('missing');
      await call(env, '/data_sources/' + id);
      result[name] = 'ok';
    } catch (e) {
      result[name] = e.message === 'missing' ? '尚未設定' : '連不到（請確認整合已加入頁面）';
    }
  }
  return result;
}

// 快速筆記 → 工作專案規劃 新版，專案狀態預設「點子階段」
export async function createNote(env, text, extra = {}, templateId, title) {
  const body = {
    parent: { type: 'data_source_id', data_source_id: env.NOTES_DS },
    properties: {
      Title: { title: [{ type: 'text', text: { content: (title && String(title).trim().slice(0, 200)) || noteTitle(text) } }] },
      專案狀態: { select: { name: '點子階段' } },
      ...extra,
    },
    children: paragraphs(text),
  };
  if (templateId) return createPageWithTemplate(env, body, templateId);
  const page = await call(env, '/pages', 'POST', body);
  return { url: page.url };
}

// 日程 → 所有任務清單
export async function createTask(env, title, startIso, extra = {}, templateId) {
  const body = {
    parent: { type: 'data_source_id', data_source_id: env.TASKS_DS },
    properties: {
      任務內容: { title: [{ type: 'text', text: { content: title.slice(0, 200) } }] },
      日期: { date: { start: startIso } },
      已完成: { checkbox: false },
      ...extra,
    },
  };
  if (templateId) return createPageWithTemplate(env, body, templateId);
  const page = await call(env, '/pages', 'POST', body);
  return { url: page.url };
}

export async function createPage(env, body) {
  const page = await call(env, '/pages', 'POST', body);
  return { url: page.url };
}

// 讀出知識庫的範本清單
export async function listTemplates(env, dsId = env.KNOWLEDGE_DS) {
  const r = await call(env, '/data_sources/' + dsId + '/templates?page_size=100');
  return (r.templates || []).map((t) => ({ id: t.id, name: t.name, isDefault: !!t.is_default }));
}

// 用範本建立頁面：範本內容由 Notion 在背景套用，套好後再把影片加在最後面
export async function createPageWithTemplate(env, body, templateId, extraBlocks, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const { children, ...rest } = body;
  const page = await call(env, '/pages', 'POST', { ...rest, template: { type: 'template_id', template_id: templateId } });
  // 最多等約 8 秒，等範本內容出現
  for (let i = 0; i < 8; i++) {
    await sleep(1000);
    const kids = await call(env, '/blocks/' + page.id + '/children?page_size=1').catch(() => null);
    if (kids?.results?.length) break;
  }
  const blocks = extraBlocks || children;
  if (blocks?.length) {
    try { await call(env, '/blocks/' + page.id + '/children', 'PATCH', { children: blocks }); }
    catch (e) {
      const link = body.properties?.相關連結?.url;
      if (e.status !== 400 || !link) throw e;
      await call(env, '/blocks/' + page.id + '/children', 'PATCH', { children: [{ object: 'block', type: 'bookmark', bookmark: { url: link } }] });
    }
  }
  return { url: page.url };
}

export async function getDataSource(env, id) { return call(env, '/data_sources/' + id); }

// 找關聯用的頁面（依標題搜尋，最近編輯的在前）
export async function searchPages(env, dsId, titleProp, q) {
  const body = { page_size: 10, sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }] };
  if (q) body.filter = { property: titleProp, title: { contains: q } };
  const r = await call(env, '/data_sources/' + dsId + '/query', 'POST', body);
  return (r.results || []).map((p) => ({ id: p.id, title: (p.properties?.[titleProp]?.title || []).map((t) => t.plain_text).join('') || '（無標題）' }));
}

export async function getPage(env, id) { return call(env, '/pages/' + id); }

export function pageTitle(page) {
  const t = Object.values(page.properties || {}).find((p) => p.type === 'title');
  return (t?.title || []).map((x) => x.plain_text).join('') || '（無標題）';
}

// 從 Notion 網址取出頁面編號（網址最後的 32 碼）
export function pageIdFromUrl(u) {
  const m = String(u || '').match(/([0-9a-f]{32})(?:[?#]|$)/i);
  return m ? m[1] : null;
}

// 把頁面放進 Notion 的垃圾桶（30 天內可以在 Notion 裡救回來）
export async function trashPage(env, pageId) {
  await call(env, '/pages/' + pageId, 'PATCH', { in_trash: true });
}

export async function updatePageProps(env, pageId, properties) {
  await call(env, '/pages/' + pageId, 'PATCH', { properties });
}

// 在頁面最後面加內容
export async function appendBlocks(env, pageId, children) {
  await call(env, '/blocks/' + pageId + '/children', 'PATCH', { children });
}

// 讀頁面第一層的區塊（最多 100 個）
export async function listChildren(env, blockId) {
  const r = await call(env, '/blocks/' + blockId + '/children?page_size=100');
  return r.results || [];
}

// 在某個區塊「後面」插入內容
export async function insertAfter(env, pageId, afterId, children) {
  await call(env, '/blocks/' + pageId + '/children', 'PATCH', { children, after: afterId });
}

const plain = (rt) => (rt || []).map((t) => t.plain_text || t.text?.content || '').join('').trim();
/** 從頁面區塊找出「段落標題」：標題（含可收合標題）和收合清單。回傳 [{ id, text, toggle, kind }] */
export function outlineOf(blocks) {
  const out = [];
  for (const [i, b] of blocks.entries()) {
    const t = b.type;
    if (/^heading_[123]$/.test(t)) {
      const text = plain(b[t].rich_text);
      if (text) {
        // 這一段裡有沒有 Notion 按鈕（API 看到的是 unsupported）
        const level = Number(t.slice(-1)); let hasButton = false;
        for (let j = i + 1; j < blocks.length; j++) {
          const m = blocks[j].type.match(/^heading_(\d)$/); if (m && Number(m[1]) <= level) break;
          if (blocks[j].type === 'unsupported' || blocks[j].type === 'button') { hasButton = true; break; }
        }
        out.push({ id: b.id, text, toggle: !!b[t].is_toggleable, kind: t, hasButton });
      }
    } else if (t === 'toggle') {
      const text = plain(b.toggle.rich_text);
      if (text) out.push({ id: b.id, text, toggle: true, kind: t });
    }
  }
  return out;
}

/** 一般標題的段落：找到這個標題底下最後一個區塊（下一個標題之前），筆記插在那後面 */
export function sectionEnd(blocks, headingId) {
  const i = blocks.findIndex((b) => b.id === headingId);
  if (i < 0) return null;
  const level = Number((blocks[i].type.match(/heading_(\d)/) || [])[1] || 9);
  let last = blocks[i].id;
  for (let j = i + 1; j < blocks.length; j++) {
    const m = blocks[j].type.match(/^heading_(\d)$/);
    if (m && Number(m[1]) <= level) break;
    last = blocks[j].id;
  }
  return last;
}

/** 段落裡「按鈕上方」的位置：Notion 按鈕在 API 裡是 unsupported 區塊；插在它前一個區塊後面。沒有按鈕就插在段落最後 */
export function sectionAnchor(blocks, headingId) {
  const i = blocks.findIndex((b) => b.id === headingId);
  if (i < 0) return null;
  const level = Number((blocks[i].type.match(/heading_(\d)/) || [])[1] || 9);
  let prev = blocks[i].id;
  for (let j = i + 1; j < blocks.length; j++) {
    const b = blocks[j];
    const m = b.type.match(/^heading_(\d)$/);
    if (m && Number(m[1]) <= level) break;
    if (b.type === 'unsupported' || b.type === 'button') return prev; // 按鈕上方
    prev = b.id;
  }
  return prev;
}

export const CODE_LANGS = ['xml', 'plain text', 'javascript', 'python', 'html', 'css', 'json', 'markdown', 'bash', 'sql'];
// 網址書籤（只收 http/https）
const bookmarks = (links) => (Array.isArray(links) ? links : []).filter((u) => typeof u === 'string' && /^https?:\/\/[^\s]+$/.test(u.trim()) && u.length < 2000)
  .slice(0, 10).map((u) => ({ object: 'block', type: 'bookmark', bookmark: { url: u.trim() } }));
// 圖片（已上傳到 Notion 的 file_upload 編號）
const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const YT_LINK = /^https:\/\/(www\.)?(youtube\.com|youtu\.be)\/[^\s]*$/;
const images = (list) => (Array.isArray(list) ? list : []).filter((im) => im && (UUID.test(im.uploadId || '') || /^https:\/\//.test(im.external || ''))).slice(0, 10).map((im) => {
  // 說明：影片時間點連結（像 YouTube「從這個時間點分享」）＋ 自己寫的說明
  const cap = [];
  if (typeof im.link === 'string' && YT_LINK.test(im.link)) {
    const t = Number((im.link.match(/[?&]t=(\d+)/) || [])[1] || 0);
    cap.push({ type: 'text', text: { content: `▶ ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, link: { url: im.link } } });
  }
  if (im.caption) cap.push({ type: 'text', text: { content: (cap.length ? '　' : '') + String(im.caption).slice(0, 300) } });
  if (im.external) return { object: 'block', type: 'image', image: { type: 'external', external: { url: im.external }, caption: cap } };
  return { object: 'block', type: 'image', image: { type: 'file_upload', file_upload: { id: im.uploadId }, caption: cap } };
});
const rt = (s) => (s ? [{ type: 'text', text: { content: String(s).slice(0, 2000) } }] : []);
/** APP 裡用「＋ 重點／＋ 副重點／＋ 一般問題」做的結構 → Notion 區塊（和範本按鈕插入的格式一樣） */
export function itemBlocks(items) {
  const out = [];
  for (const it of (Array.isArray(items) ? items : []).slice(0, 30)) {
    if (it?.kind === 'point') {
      const subs = (Array.isArray(it.subs) ? it.subs : []).slice(0, 20).filter((s) => s && (s.title || s.text || s.code || bookmarks(s.links).length || images(s.images).length)).map((s) => {
        const kids = paragraphs(s.text || '').filter((p) => p.paragraph.rich_text.length).slice(0, 29);
        kids.push(...images(s.images), ...bookmarks(s.links));
        // 程式筆記範本的「提示詞按鈕」：小標題裡放一個程式碼框
        if (s.code) kids.push({ object: 'block', type: 'code', code: { language: CODE_LANGS.includes(s.lang) ? s.lang : 'xml', rich_text: rt(s.code) } });
        return { object: 'block', type: 'heading_3', heading_3: { rich_text: rt(s.title || '副重點'), is_toggleable: true, children: kids } };
      });
      if (!it.title && !subs.length) continue;
      out.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: rt(it.title || '重點'), is_toggleable: true, children: subs } });
    } else if (it?.kind === 'qa') {
      const links = bookmarks(it.links), pics = images(it.images);
      if (!it.q && !it.a && !links.length && !pics.length) continue;
      out.push({ object: 'block', type: 'toggle', toggle: { rich_text: rt(it.q || '?'), children: [...paragraphs(it.a || '').filter((p) => p.paragraph.rich_text.length).slice(0, 30), ...pics, ...links] } });
    }
  }
  return out;
}

export async function deleteBlock(env, blockId) {
  try { await call(env, '/blocks/' + blockId, 'DELETE'); }
  catch (e) { if (e.status !== 404) throw e; }
}

// 上傳圖片到 Notion（Notion 的檔案上傳功能，單檔 20MB 內）：回傳 file_upload 編號，之後放進圖片區塊
export async function uploadImage(env, bytes, contentType, filename) {
  const up = await call(env, '/file_uploads', 'POST', { mode: 'single_part', filename, content_type: contentType });
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: contentType }), filename);
  const res = await fetch(`https://api.notion.com/v1/file_uploads/${up.id}/send`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.NOTION_TOKEN, 'Notion-Version': env.NOTION_VERSION || '2025-09-03' },
    body: form,
  });
  if (!res.ok) { const e = new Error('notion_' + res.status); e.status = res.status; throw e; }
  return up.id;
}

export async function getBlock(env, id) { return call(env, '/blocks/' + id); }
