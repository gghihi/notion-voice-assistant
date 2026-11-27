// 後端入口：只開放少數幾個網址，每個（除了登入）都要有效通行證。
import { checkPassword, issueToken, verifyToken } from './auth.js';
import { checkDataSources, createNote, createTask, createPage, listTemplates, createPageWithTemplate } from './notion.js';
import { detect, fetchInfo, buildPage } from './video.js';
import { parseWhen, twIso } from './when.js';


const store = (env) => env.STORE.get(env.STORE.idFromName('main'));

const MAX_TEXT = 5000;

function cors(env, origin) {
  const allowed = origin === env.ALLOWED_ORIGIN || /^http:\/\/localhost:\d+$/.test(origin || '') && env.ALLOW_LOCALHOST === '1';
  return allowed ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST', Vary: 'Origin' } : {};
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
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
        return json(await createNote(env, text), 200, h);
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
        return json({ title: r.title, at: r.at }, 200, h);
      }
      if (url.pathname === '/api/schedule' && req.method === 'POST') {
        const body = await readJson(req);
        const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 200) : '';
        const at = Number(body?.at);
        const before = Math.min(Math.max(Number(body?.remindBefore) || 0, 0), 1440);
        if (!title) return json({ error: '請填寫要做什麼' }, 400, h);
        if (!Number.isFinite(at) || at < Date.now() - 60000 || at > Date.now() + 5 * 365 * 86400000) return json({ error: '時間不正確' }, 400, h);
        const page = await createTask(env, title, twIso(at));
        if (body?.remind !== false) await store(env).addReminder({ title, remindAt: at - before * 60000, eventAt: at, pageUrl: page.url });
        return json(page, 200, h);
      }
      if (url.pathname === '/api/video/preview' && req.method === 'POST') {
        const v = detect((await readJson(req))?.url);
        if (!v) return json({ error: '看不懂這個網址，目前支援 YouTube 和 Instagram' }, 400, h);
        return json({ ...v, ...(await fetchInfo(v)) }, 200, h);
      }
      if (url.pathname === '/api/video/templates' && req.method === 'GET') {
        return json({ templates: await listTemplates(env) }, 200, h);
      }
      if (url.pathname === '/api/video' && req.method === 'POST') {
        const body = await readJson(req);
        const v = detect(body?.url);
        if (!v) return json({ error: '看不懂這個網址，目前支援 YouTube 和 Instagram' }, 400, h);
        const info = await fetchInfo(v);
        if (typeof body.title === 'string' && body.title.trim()) info.title = body.title.trim().slice(0, 200);
        const page = buildPage(env, v, info, body.kind);
        if (typeof body.templateId === 'string' && body.templateId) {
          // 只接受知識庫裡真的有的範本
          const ok = (await listTemplates(env)).some((t) => t.id === body.templateId);
          if (!ok) return json({ error: '找不到這個範本，請重新整理' }, 400, h);
          return json(await createPageWithTemplate(env, page, body.templateId), 200, h);
        }
        try { return json(await createPage(env, page), 200, h); }
        catch (e) {
          // 嵌入失敗（例如 IG 不給嵌）就只存連結預覽，再試一次
          if (e.status !== 400) throw e;
          page.children = [{ object: 'block', type: 'bookmark', bookmark: { url: v.url } }];
          delete page.cover;
          return json(await createPage(env, page), 200, h);
        }
      }
      return json({ error: '找不到' }, 404, h);
    } catch (e) {
      console.log('error', e.message, e.code || ''); // 不印出內容或金鑰
      return json({ error: e.status === 401 ? 'Notion 金鑰無效' : '存到 Notion 失敗，請稍後再試' }, 502, h);
    }
  },

};
