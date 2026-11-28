// 後端入口：只開放少數幾個網址，每個（除了登入）都要有效通行證。
import { checkPassword, issueToken, verifyToken } from './auth.js';
import { checkDataSources, createNote, createTask, createPage, listTemplates, createPageWithTemplate, getDataSource, searchPages, getPage, pageTitle, pageIdFromUrl, trashPage, updatePageProps, appendBlocks, paragraphs, listChildren, insertAfter, outlineOf, sectionEnd, sectionAnchor, itemBlocks } from './notion.js';
import { DBS, describe, toNotionProps, fromNotionProps } from './fields.js';
import { STATUS_TO_NOTION } from './organize.js';
import { detect, fetchInfo, buildPage, CHANNEL, resolveShare } from './video.js';
import { parseWhen, twIso } from './when.js';
import { aiTask, aiSuggest, aiNotice } from './ai.js';


const store = (env) => env.STORE.get(env.STORE.idFromName('main'));

const MAX_TEXT = 5000;

function cors(env, origin) {
  const allowed = origin === env.ALLOWED_ORIGIN || /^http:\/\/localhost:\d+$/.test(origin || '') && env.ALLOW_LOCALHOST === '1';
  return allowed ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST', Vary: 'Origin' } : {};
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
}

// Notion 欄位設定暫存 5 分鐘（AI 建議時不用每次都重新問 Notion）
const fieldCache = new Map();
async function cachedFields(env, db) {
  const hit = fieldCache.get(db);
  if (hit && Date.now() - hit.at < 300000) return hit.fields;
  const fields = describe(db, await getDataSource(env, env[DBS[db].env]));
  fieldCache.set(db, { at: Date.now(), fields });
  return fields;
}

// 記到公佈欄；就算記失敗也不影響已經存好的 Notion 資料
async function remember(env, db, title, pageUrl) {
  try { await store(env).addSaved({ db, title, url: pageUrl }); } catch (e) { console.log('board', e.message); }
  if (db === 'knowledge') { try { await store(env).addOrganize({ title, url: pageUrl }); } catch (e) { console.log('organize', e.message); } }
}

// 範本編號：沒選回傳 null；選了但資料庫裡沒有回傳 false
async function checkTemplate(env, db, id) {
  if (typeof id !== 'string' || !id) return null;
  return (await listTemplates(env, env[DBS[db].env])).some((t) => t.id === id) ? id : false;
}

async function readJson(req) {
  if (Number(req.headers.get('Content-Length') || 0) > 20000) return null;
  return req.json().catch(() => null);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin');
    const h = cors(env, origin);
    if (req.method === 'OPTIONS') return new Response(null, { status: h['Access-Control-Allow-Origin'] ? 204 : 403, headers: h });
    // 不是自己網頁發出的請求一律拒絕
    if (!h['Access-Control-Allow-Origin']) return json({ error: '不允許的來源' }, 403, {});

    try {
      if (url.pathname === '/api/login' && req.method === 'POST') {
        const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
        if (env.LOGIN_LIMITER) {
          const { success } = await env.LOGIN_LIMITER.limit({ key: ip });
          if (!success) return json({ error: '嘗試太多次，請一分鐘後再試' }, 429, h);
        }
        const body = await readJson(req);
        if (!(await checkPassword(env, body?.password))) return json({ error: '密碼不對' }, 401, h);
        return json({ token: await issueToken(env) }, 200, h);
      }

      const token = (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
      if (!(await verifyToken(env, token))) return json({ error: '請重新登入' }, 401, h);

      if (url.pathname === '/api/health' && req.method === 'GET') {
        return json({ ok: true, notion: await checkDataSources(env) }, 200, h);
      }
      if (url.pathname === '/api/note' && req.method === 'POST') {
        const body = await readJson(req);
        const text = typeof body?.text === 'string' ? body.text.trim() : '';
        if (!text) return json({ error: '內容是空的' }, 400, h);
        if (text.length > MAX_TEXT) return json({ error: '內容太長（上限 5000 字）' }, 400, h);
        const tpl = await checkTemplate(env, 'projects', body.templateId);
        if (tpl === false) return json({ error: '找不到這個範本，請重新整理' }, 400, h);
        const r = await createNote(env, text, toNotionProps('projects', body.props), tpl, body.title);
        await remember(env, 'projects', (body.title && String(body.title).trim()) || text.split('\n')[0], r.url);
        return json(r, 200, h);
      }
      if (url.pathname === '/api/ai/suggest' && req.method === 'POST') {
        const body = await readJson(req);
        const db = body?.db;
        const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 3000) : '';
        if (!['projects', 'knowledge'].includes(db) || !text) return json({ error: '資料不完整' }, 400, h);
        try {
          const fields = await cachedFields(env, db);
          return json({ ...(await aiSuggest(env, db, text, fields, Date.now(), { wantTitle: body.wantTitle === true })), ai: true }, 200, h);
        } catch (e) {
          if (e.kind) return json({ props: {}, notice: aiNotice(e) }, 200, h);
          throw e;
        }
      }
      if (url.pathname === '/api/organize' && req.method === 'GET') {
        return json({ items: await store(env).organizeWithStatus() }, 200, h);
      }
      if (url.pathname === '/api/organize/outline' && req.method === 'GET') {
        // 讀出這一頁的範本格式（段落標題），讓 APP 照格式分段填
        const item = await store(env).getOrganize(url.searchParams.get('id'));
        const pid = item && pageIdFromUrl(item.url);
        if (!pid) return json({ error: '找不到這筆，可能已經超過 7 天' }, 404, h);
        const [blocks, page] = await Promise.all([listChildren(env, pid), getPage(env, pid).catch(() => null)]);
        const video = page?.properties?.['相關連結']?.url || null;
        return json({ sections: outlineOf(blocks), video: video && detect(video) }, 200, h);
      }
      if (url.pathname === '/api/organize/note' && req.method === 'POST') {
        const body = await readJson(req);
        const text = typeof body?.text === 'string' ? body.text.trim() : '';
        const sections = body?.sections && typeof body.sections === 'object' ? Object.entries(body.sections)
          .map(([k, v]) => [k, typeof v === 'string' ? v.trim() : '']).filter(([, v]) => v) : [];
        const items = body?.items && typeof body.items === 'object' ? Object.entries(body.items).map(([k, v]) => [k, itemBlocks(v)]).filter(([, v]) => v.length) : [];
        const total = text.length + sections.reduce((n, [, v]) => n + v.length, 0) + JSON.stringify(body?.items || {}).length / 4;
        if (!total) return json({ error: '筆記是空的' }, 400, h);
        if (!text && !sections.length && !items.length) return json({ error: '筆記是空的' }, 400, h);
        if (total > MAX_TEXT) return json({ error: '筆記太長（上限 5000 字）' }, 400, h);
        // 只能寫進「整理庫裡有的」頁面
        const item = await store(env).getOrganize(body.id);
        const pid = item && pageIdFromUrl(item.url);
        if (!pid) return json({ error: '找不到這筆，可能已經超過 7 天' }, 404, h);
        // 照範本格式：寫進各自的段落（收合的放進裡面；一般標題插在該段最後面）
        if (sections.length || items.length) {
          const blocks = await listChildren(env, pid);
          const outline = outlineOf(blocks);
          // 結構化的「重點／一般問題」：照範本按鈕的做法，放在按鈕上方
          for (const [sid, kids] of items) {
            const sec = outline.find((o) => o.id === sid);
            if (!sec) continue;
            if (sec.toggle) await appendBlocks(env, sid, kids);
            else await insertAfter(env, pid, sectionAnchor(blocks, sid), kids);
          }
          for (const [sid, v] of sections) {
            const sec = outline.find((o) => o.id === sid);
            if (!sec) continue; // 不是這一頁的區塊就跳過
            const kids = paragraphs(v).slice(0, 100);
            if (sec.toggle) await appendBlocks(env, sid, kids);
            else await insertAfter(env, pid, sectionEnd(blocks, sid), kids);
          }
        }
        // 沒有範本格式（或「其他」欄）的內容，加在頁面最後面
        if (text) {
          const t = new Date(Date.now() + 8 * 3600000);
          const stamp = `${t.getUTCMonth() + 1}/${t.getUTCDate()} ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
          await appendBlocks(env, pid, [
            { object: 'block', type: 'heading_3', heading_3: { rich_text: [{ type: 'text', text: { content: `📝 我的筆記（${stamp}）` } }] } },
            ...paragraphs(text).slice(0, 99),
          ]);
        }
        // 寫了筆記就算「整理中」；選了「完成」就標記完成
        const status = body.markDone ? 'done' : 'doing';
        const props = { ...STATUS_TO_NOTION[status] };
        try { await updatePageProps(env, pid, props); } catch (e) { if (e.status !== 400) throw e; delete props.Done; await updatePageProps(env, pid, props).catch(() => {}); }
        return json({ ok: true, status }, 200, h);
      }
      if (url.pathname === '/api/organize/status' && req.method === 'POST') {
        const body = await readJson(req);
        const patch = STATUS_TO_NOTION[body?.status];
        // 只能改「整理庫裡有的」頁面
        const item = patch && await store(env).getOrganize(body.id);
        const pid = item && pageIdFromUrl(item.url);
        if (!pid) return json({ error: '找不到這筆，可能已經超過 7 天' }, 404, h);
        const fields = await cachedFields(env, 'knowledge');
        const props = { ...patch };
        if (!fields.some((f) => f.name === '觀看性質')) delete props.觀看性質;
        try { await updatePageProps(env, pid, props); }
        catch (e) { if (e.status !== 400) throw e; delete props.Done; await updatePageProps(env, pid, props); } // 沒有 Done 欄位就只改觀看性質
        return json({ ok: true }, 200, h);
      }
      if (url.pathname === '/api/board' && req.method === 'GET') {
        // 和 Notion 對一下：已經在 Notion 被丟進垃圾桶（或不見）的，從公佈欄一起拿掉
        const items = await store(env).listSaved();
        const checked = await Promise.all(items.slice(0, 40).map(async (it) => {
          const pid = pageIdFromUrl(it.url);
          if (!pid) return it;
          try {
            const pg = await getPage(env, pid);
            if (pg.in_trash || pg.archived) { await store(env).removeSaved(it.id); return null; }
          } catch (e) {
            if (e.status === 404) { await store(env).removeSaved(it.id); return null; }
          }
          return it;
        }));
        return json({ items: checked.filter(Boolean).concat(items.slice(40)) }, 200, h);
      }
      if (url.pathname === '/api/board/delete' && req.method === 'POST') {
        const body = await readJson(req);
        if (body?.alsoNotion === true) {
          // 只能刪「公佈欄上有紀錄」的頁面，不能拿來刪 Notion 裡任意頁面
          const item = await store(env).getSaved(body.id);
          const pid = item && pageIdFromUrl(item.url);
          if (!pid) return json({ error: '找不到這筆紀錄，可能已經過期' }, 404, h);
          try { await trashPage(env, pid); }
          catch (e) { if (e.status !== 404) throw e; } // Notion 裡已經不在了就當作刪好
        }
        const ok = await store(env).removeSaved(body?.id);
        return json({ ok }, 200, h);
      }
      if (url.pathname === '/api/vapid' && req.method === 'GET') {
        return json({ key: env.VAPID_PUBLIC_KEY || null }, 200, h);
      }
      if (url.pathname === '/api/push/subscribe' && req.method === 'POST') {
        const ok = await store(env).saveSubscription(await readJson(req));
        return ok ? json({ ok }, 200, h) : json({ error: '推播資料不正確' }, 400, h);
      }
      if (url.pathname === '/api/push/test' && req.method === 'POST') {
        return json(await store(env).pushAll({ title: '🔔 測試通知', body: '收到這則就代表提醒可以正常運作', url: '' }), 200, h);
      }
      if (url.pathname === '/api/schedule/parse' && req.method === 'POST') {
        const body = await readJson(req);
        const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 500) : '';
        if (!text) return json({ error: '內容是空的' }, 400, h);
        const r = parseWhen(text);
        if (body.ai === false) return json({ title: r.title, at: r.at, props: {} }, 200, h);
        try {
          const fields = await cachedFields(env, 'tasks');
          const a = await aiTask(env, text, fields);
          // AI 沒聽出時間時，再參考規則版的結果
          return json({ title: a.title || r.title, at: a.at ?? r.at, props: a.props, ai: true }, 200, h);
        } catch (e) {
          return json({ title: r.title, at: r.at, props: {}, notice: aiNotice(e) }, 200, h);
        }
      }
      if (url.pathname === '/api/schedule' && req.method === 'POST') {
        const body = await readJson(req);
        const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 200) : '';
        const at = Number(body?.at);
        const before = Math.min(Math.max(Number(body?.remindBefore) || 0, 0), 1440);
        if (!title) return json({ error: '請填寫要做什麼' }, 400, h);
        if (!Number.isFinite(at) || at < Date.now() - 60000 || at > Date.now() + 5 * 365 * 86400000) return json({ error: '時間不正確' }, 400, h);
        const tpl = await checkTemplate(env, 'tasks', body.templateId);
        if (tpl === false) return json({ error: '找不到這個範本，請重新整理' }, 400, h);
        const page = await createTask(env, title, twIso(at), toNotionProps('tasks', body.props), tpl);
        if (body?.remind !== false) await store(env).addReminder({ title, remindAt: at - before * 60000, eventAt: at, pageUrl: page.url });
        await remember(env, 'tasks', title, page.url);
        return json(page, 200, h);
      }
      if (url.pathname === '/api/video/preview' && req.method === 'POST') {
        const v = await resolveShare(detect((await readJson(req))?.url));
        if (!v) return json({ error: '看不懂這個網址，目前支援 YouTube、Instagram、Threads' }, 400, h);
        return json({ ...v, channel: CHANNEL[v.platform], ...(await fetchInfo(v)) }, 200, h);
      }
      if (url.pathname === '/api/fields' && req.method === 'GET') {
        const db = url.searchParams.get('db');
        if (!DBS[db]) return json({ error: '沒有這個資料庫' }, 400, h);
        return json({ fields: describe(db, await getDataSource(env, env[DBS[db].env])) }, 200, h);
      }
      if (url.pathname === '/api/template-values' && req.method === 'GET') {
        const db = url.searchParams.get('db');
        const id = url.searchParams.get('id') || '';
        if (!DBS[db]) return json({ error: '沒有這個資料庫' }, 400, h);
        // 只讀這個資料庫自己的範本，不能拿來讀任意頁面
        if (!(await listTemplates(env, env[DBS[db].env])).some((t) => t.id === id)) return json({ error: '找不到這個範本' }, 400, h);
        const values = fromNotionProps(db, (await getPage(env, id)).properties);
        // 關聯欄位補上標題，畫面才看得懂
        for (const [name, f] of Object.entries(DBS[db].fields)) {
          if (f.type !== 'relation' || !values[name]) continue;
          values[name] = await Promise.all(values[name].map(async (rid) => {
            try { return { id: rid, title: pageTitle(await getPage(env, rid)) }; } catch { return { id: rid, title: '（無法讀取）' }; }
          }));
        }
        return json({ values }, 200, h);
      }
      if (url.pathname === '/api/relation-search' && req.method === 'POST') {
        const body = await readJson(req);
        const def = DBS[body?.db];
        if (!def) return json({ error: '沒有這個資料庫' }, 400, h);
        const q = typeof body.q === 'string' ? body.q.trim().slice(0, 50) : '';
        return json({ pages: await searchPages(env, env[def.env], def.title, q) }, 200, h);
      }
      if ((url.pathname === '/api/templates' || url.pathname === '/api/video/templates') && req.method === 'GET') {
        const db = url.searchParams.get('db') || 'knowledge';
        if (!DBS[db]) return json({ error: '沒有這個資料庫' }, 400, h);
        return json({ templates: await listTemplates(env, env[DBS[db].env]) }, 200, h);
      }
      if (url.pathname === '/api/video' && req.method === 'POST') {
        const body = await readJson(req);
        const v = await resolveShare(detect(body?.url));
        if (!v) return json({ error: '看不懂這個網址，目前支援 YouTube、Instagram、Threads' }, 400, h);
        const info = await fetchInfo(v);
        if (typeof body.title === 'string' && body.title.trim()) info.title = body.title.trim().slice(0, 200);
        const page = buildPage(env, v, info, body.kind);
        if (body.props && typeof body.props === 'object') {
          // 這些欄位交給使用者在確認卡上決定（清空就是不要）
          for (const k of ['作者', '上傳日期', '課堂筆記通路', '觀看性質', '知識庫性質', '相關連結']) delete page.properties[k];
          page.properties.相關連結 = { url: v.url };
          Object.assign(page.properties, toNotionProps('knowledge', body.props));
        }
        if (typeof body.templateId === 'string' && body.templateId) {
          // 只接受知識庫裡真的有的範本
          const ok = (await listTemplates(env)).some((t) => t.id === body.templateId);
          if (!ok) return json({ error: '找不到這個範本，請重新整理' }, 400, h);
          const r = await createPageWithTemplate(env, page, body.templateId);
          await remember(env, 'knowledge', info.title, r.url);
          return json(r, 200, h);
        }
        try { const r = await createPage(env, page); await remember(env, 'knowledge', info.title, r.url); return json(r, 200, h); }
        catch (e) {
          // 嵌入失敗（例如 IG 不給嵌）就只存連結預覽，再試一次
          if (e.status !== 400) throw e;
          page.children = [{ object: 'block', type: 'bookmark', bookmark: { url: v.url } }];
          delete page.cover;
          const r = await createPage(env, page);
          await remember(env, 'knowledge', info.title, r.url);
          return json(r, 200, h);
        }
      }
      return json({ error: '找不到' }, 404, h);
    } catch (e) {
      console.log('error', e.message, e.code || ''); // 不印出內容或金鑰
      return json({ error: e.status === 401 ? 'Notion 金鑰無效' : 'Notion 回報錯誤（' + (e.code || e.message) + '），請稍後再試' }, 502, h);
    }
  },

};
