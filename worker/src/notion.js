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
export async function createNote(env, text) {
  const page = await call(env, '/pages', 'POST', {
    parent: { type: 'data_source_id', data_source_id: env.NOTES_DS },
    properties: {
      Title: { title: [{ type: 'text', text: { content: noteTitle(text) } }] },
      專案狀態: { select: { name: '點子階段' } },
    },
    children: paragraphs(text),
  });
  return { url: page.url };
}

// 日程 → 所有任務清單
export async function createTask(env, title, startIso) {
  const page = await call(env, '/pages', 'POST', {
    parent: { type: 'data_source_id', data_source_id: env.TASKS_DS },
    properties: {
      任務內容: { title: [{ type: 'text', text: { content: title.slice(0, 200) } }] },
      日期: { date: { start: startIso } },
      已完成: { checkbox: false },
    },
  });
  return { url: page.url };
}

export async function createPage(env, body) {
  const page = await call(env, '/pages', 'POST', body);
  return { url: page.url };
}
