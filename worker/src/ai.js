// AI 小幫手（Google Gemini 免費額度）
// 透過「呱咩小窩帳」的 Gemini 轉送站（在美國，避開香港機房不能用 Gemini 的問題）。
// 金鑰只存在轉送站，這個後端碰不到。AI 失敗或額度用完時，一律退回不用 AI 的做法。
import { twIso } from './when.js';

export class AiError extends Error {
  constructor(kind, detail = '') { super('ai_' + kind); this.kind = kind; this.detail = detail; } // kind: quota（額度用完）/ off / fail
}

async function callModel(env, model, prompt, fast = true, opts = {}) {
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [...(opts.parts || []), { text: prompt }] }],
    // 分類、取標題這種小事不需要「先想一想」，關掉可以快好幾秒
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: opts.maxTokens || 600, ...(fast ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
  });
  const path = `/v1beta/models/${model}:generateContent`;
  const signal = AbortSignal.timeout ? AbortSignal.timeout(opts.timeout || 8000) : undefined;
  const res = env.GEMINI_PROXY
    ? await env.GEMINI_PROXY.fetch('https://gemini' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal })
    : await fetch('https://generativelanguage.googleapis.com' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY || '' }, body, signal });
  if (res.status === 429) throw new AiError('quota');
  if (!res.ok) throw new AiError('fail', String(res.status));
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  try { return JSON.parse(text.replace(/^```(json)?|```$/g, '').trim()); } catch { throw new AiError('fail', 'format'); }
}

/** 先試主要模型，失敗再試備用模型；兩個都額度用完就回報 quota */
export async function askGemini(env, prompt, opts = {}) {
  if (env.AI_ENABLED === '0') throw new AiError('off');
  if (env.AI_SIMULATE_QUOTA === '1') throw new AiError('quota'); // 測試「額度用完」用
  let quota = false, detail = 'no_model';
  for (const model of [env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL].filter(Boolean)) {
    try {
      try { return await callModel(env, model, prompt, true, opts); }
      catch (e) { if (e.kind === 'fail' && e.detail === '400') return await callModel(env, model, prompt, false, opts); throw e; } // 不接受「不思考」設定就照一般方式
    }
    catch (e) {
      if (e.kind === 'quota') quota = true;
      detail = e.name === 'TimeoutError' || e.name === 'AbortError' ? 'timeout' : e.detail || e.message;
    }
  }
  throw new AiError(quota ? 'quota' : 'fail', detail);
}

export const aiNotice = (e) => (e?.kind === 'quota' ? 'AI 今天的免費額度用完了，先用一般方式處理（其他功能照常）'
  : e?.kind === 'off' ? null : `AI 暫時沒回應（${e?.detail || e?.message || '未知'}），先用一般方式處理`);

// 只保留真的存在的選項，避免 AI 自己發明
function pick(value, field) {
  if (!field?.options) return undefined;
  const set = new Set(field.options);
  if (field.type === 'select') return typeof value === 'string' && set.has(value) ? value : undefined;
  if (field.type === 'multi_select' && Array.isArray(value)) {
    const out = [...new Set(value.filter((v) => typeof v === 'string' && set.has(v)))].slice(0, 6);
    return out.length ? out : undefined;
  }
}
export function filterSuggestions(raw, fields, allow) {
  const props = {};
  for (const name of allow) {
    const f = fields.find((x) => x.name === name);
    const v = pick(raw?.[name], f);
    if (v !== undefined) props[name] = v;
  }
  return props;
}
const optionsText = (fields, allow) => allow.map((n) => fields.find((f) => f.name === n)).filter((f) => f?.options?.length)
  .map((f) => `「${f.name}」（${f.type === 'select' ? '單選' : '可複選'}）可用選項：${JSON.stringify(f.options)}`).join('\n');

/** 任務：從一句話抓出事情、時間、行動種類 */
export async function aiTask(env, text, fields, now = Date.now()) {
  const allow = ['行動種類'];
  const prompt = `你是行程助理。現在是台灣時間 ${twIso(now)}（星期${'日一二三四五六'[new Date(now + 8 * 3600000).getUTCDay()]}）。
使用者說：「${text}」
${TITLE_RULE}
請回傳 JSON：{"title": 要做的事（照標題規則）, "at": 開始時間（ISO 8601，帶 +08:00；聽不出時間就給 null，不要猜）, "行動種類": 從選項挑一個，不確定就 null}
${optionsText(fields, allow)}`;
  const r = await askGemini(env, prompt);
  const at = typeof r?.at === 'string' ? Date.parse(r.at) : NaN;
  return {
    title: typeof r?.title === 'string' && r.title.trim() ? r.title.trim().slice(0, 200) : null,
    at: Number.isFinite(at) ? at : null,
    props: filterSuggestions(r, fields, allow),
  };
}

const TITLE_RULE = `標題規則：去掉時間詞（今天、明天、下週三、晚上…）和動作／語氣詞（規劃、要做、想要、記得、幫我…），只留下事情或作品本身的名稱，英文縮寫可整理大小寫。
例：「明天規劃s2 ep.1 錄yee集少一集」→「S2 EP.1 錄yee集少一集」；「下週想拍一支街訪影片問路人開心的事」→「街訪影片：路人的開心小事」。`;

const SUGGEST = {
  projects: { allow: ['專案狀態', '種類', '專案領域關鍵字'], role: '專案企劃', wantTitle: true, date: '執行日期' },
  knowledge: { allow: ['關鍵字', '課堂筆記類別', '重要度'], role: '知識整理', wantTitle: false },
};

/** 專案／知識庫：建議標題與分類（只從現有選項挑） */
export async function aiSuggest(env, db, text, fields, now = Date.now(), opts = {}) {
  const cfg = { ...SUGGEST[db], ...(opts.wantTitle ? { wantTitle: true } : {}) };
  if (!SUGGEST[db]) throw new AiError('off');
  const keys = cfg.allow.map((n) => `"${n}": ${fields.find((f) => f.name === n)?.type === 'select' ? '一個選項或 null' : '選項陣列（最多 5 個，沒適合的就 []）'}`).join(', ');
  const dateKey = cfg.date && fields.some((f) => f.name === cfg.date) ? cfg.date : null;
  const prompt = `你是${cfg.role}助理，幫使用者整理 Notion 資料。現在是台灣時間 ${twIso(now)}。
內容：「${text.slice(0, 3000)}」
請回傳 JSON：{${cfg.wantTitle ? '"title": 標題（25 字內）, ' : ''}${dateKey ? `"${dateKey}": 內容提到的日期（YYYY-MM-DD，沒提到就 null）, ` : ''}${keys}}
${cfg.wantTitle ? (db === 'knowledge' ? '標題規則：依影片內文的重點，寫一個讓人一看就知道在講什麼的標題，不要照抄開頭、不要 hashtag。例：內文在講「AI 做的網站常見的 12 種被攻擊方式與檢查清單」→「AI 做的網站常見的 12 個資安漏洞」。' : TITLE_RULE) + '\n' : ''}分類只能從下列選項挑，不要自己發明；不確定就留空。
${optionsText(fields, cfg.allow)}`;
  const r = await askGemini(env, prompt);
  const props = filterSuggestions(r, fields, cfg.allow);
  if (dateKey && typeof r?.[dateKey] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r[dateKey])) props[dateKey] = r[dateKey];
  return {
    title: cfg.wantTitle && typeof r?.title === 'string' && r.title.trim() ? r.title.trim().slice(0, 100) : null,
    props,
  };
}

/**
 * AI 撰寫筆記：照這一頁的範本格式寫草稿。
 * YouTube 直接把影片交給 Gemini 看；IG／Threads 用貼文內文。
 * sections：[{ id, text, preset }]；回傳 { [段落id]: items 或 { text } }
 */
export async function aiWriteNote(env, { title, video, caption, sections, hint }) {
  const spec = sections.map((s) => s.preset === 'point'
    ? `"${s.id}": 段落「${s.text}」→ 重點陣列 [{"title": 重點標題, "subs": [{"title": 小重點標題, "text": 內容（可多行）}]}]，3～6 個重點，每個 1～4 個小重點`
    : s.preset === 'qa'
      ? `"${s.id}": 段落「${s.text}」→ 問答陣列 [{"q": 問題, "a": 答案}]，2～4 題，幫助複習`
      : `"${s.id}": 段落「${s.text}」→ {"text": 這一段要寫的內容（可多行）}`).join('\n');
  const prompt = `你是筆記整理助理，用繁體中文、白話、條理清楚地幫使用者把影片整理成筆記。
影片標題：「${title || ''}」
${caption ? `貼文內文：「${caption.slice(0, 2500)}」\n` : ''}${hint ? `使用者特別交代：「${String(hint).slice(0, 500)}」\n` : ''}
請只根據影片（或內文）實際提到的內容來寫，沒提到的不要編。
回傳 JSON，鍵是段落編號：
${spec}`;
  const parts = video?.platform === 'YouTube' ? [{ file_data: { file_uri: video.url, mime_type: 'video/*' } }] : [];
  try {
    return await askGemini(env, prompt, { parts, timeout: 55000, maxTokens: 4000 });
  } catch (e) {
    if (!parts.length || e.kind === 'quota' || e.kind === 'off') throw e;
    // 影片太長或看不了 → 只用標題／內文再試一次
    return askGemini(env, prompt + '\n（影片無法讀取，請根據標題盡量整理，不確定的寫「待補」）', { timeout: 25000, maxTokens: 3000 });
  }
}

/** 整理 AI 回傳的草稿，只留格式正確的部分 */
export function cleanNoteDraft(raw, sections) {
  const out = {};
  const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  for (const s of sections) {
    const v = raw?.[s.id];
    if (s.preset === 'point' && Array.isArray(v)) {
      out[s.id] = v.slice(0, 8).map((p) => ({ kind: 'point', title: str(p?.title, 200), subs: (Array.isArray(p?.subs) ? p.subs : []).slice(0, 8).map((x) => ({ title: str(x?.title, 200), text: str(x?.text, 1500), links: [] })) })).filter((p) => p.title || p.subs.length);
    } else if (s.preset === 'qa' && Array.isArray(v)) {
      out[s.id] = v.slice(0, 8).map((q) => ({ kind: 'qa', q: str(q?.q, 300), a: str(q?.a, 1500), links: [] })).filter((q) => q.q || q.a);
    } else if (!s.preset && v && typeof v.text === 'string') {
      out[s.id] = { text: str(v.text, 3000) };
    }
  }
  return out;
}
