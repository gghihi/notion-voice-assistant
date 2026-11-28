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
