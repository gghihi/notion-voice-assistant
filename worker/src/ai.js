// AI 小幫手（Google Gemini 免費額度）
// 透過「呱咩小窩帳」的 Gemini 轉送站（在美國，避開香港機房不能用 Gemini 的問題）。
// 金鑰只存在轉送站，這個後端碰不到。AI 失敗或額度用完時，一律退回不用 AI 的做法。
import { twIso } from './when.js';

export class AiError extends Error {
  constructor(kind) { super('ai_' + kind); this.kind = kind; } // kind: quota（額度用完）/ off / fail
}

async function callModel(env, model, prompt) {
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
  });
  const path = `/v1beta/models/${model}:generateContent`;
  const res = env.GEMINI_PROXY
    ? await env.GEMINI_PROXY.fetch('https://gemini' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
    : await fetch('https://generativelanguage.googleapis.com' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY || '' }, body });
  if (res.status === 429) throw new AiError('quota');
  if (!res.ok) throw new AiError('fail');
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  try { return JSON.parse(text.replace(/^```(json)?|```$/g, '').trim()); } catch { throw new AiError('fail'); }
}

/** 先試主要模型，失敗再試備用模型；兩個都額度用完就回報 quota */
export async function askGemini(env, prompt) {
  if (env.AI_ENABLED === '0') throw new AiError('off');
  if (env.AI_SIMULATE_QUOTA === '1') throw new AiError('quota'); // 測試「額度用完」用
  let quota = false;
  for (const model of [env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL].filter(Boolean)) {
    try { return await callModel(env, model, prompt); }
    catch (e) { if (e.kind === 'quota') quota = true; }
  }
  throw new AiError(quota ? 'quota' : 'fail');
}

export const aiNotice = (e) => (e?.kind === 'quota' ? 'AI 今天的免費額度用完了，先用一般方式處理（其他功能照常）' : e?.kind === 'off' ? null : 'AI 暫時沒回應，先用一般方式處理');

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
請回傳 JSON：{"title": 要做的事（簡短，不含時間詞）, "at": 開始時間（ISO 8601，帶 +08:00；聽不出時間就給 null，不要猜）, "行動種類": 從選項挑一個，不確定就 null}
${optionsText(fields, allow)}`;
  const r = await askGemini(env, prompt);
  const at = typeof r?.at === 'string' ? Date.parse(r.at) : NaN;
  return {
    title: typeof r?.title === 'string' && r.title.trim() ? r.title.trim().slice(0, 200) : null,
    at: Number.isFinite(at) ? at : null,
    props: filterSuggestions(r, fields, allow),
  };
}

const SUGGEST = {
  projects: { allow: ['種類', '專案領域關鍵字'], role: '專案企劃', wantTitle: true },
  knowledge: { allow: ['關鍵字', '課堂筆記類別', '重要度'], role: '知識整理', wantTitle: false },
};

/** 專案／知識庫：建議標題與分類（只從現有選項挑） */
export async function aiSuggest(env, db, text, fields) {
  const cfg = SUGGEST[db];
  if (!cfg) throw new AiError('off');
  const keys = cfg.allow.map((n) => `"${n}": ${fields.find((f) => f.name === n)?.type === 'select' ? '一個選項或 null' : '選項陣列（最多 5 個，沒適合的就 []）'}`).join(', ');
  const prompt = `你是${cfg.role}助理，幫使用者整理 Notion 資料。內容：「${text.slice(0, 3000)}」
請回傳 JSON：{${cfg.wantTitle ? '"title": 簡潔有力的標題（20 字內）, ' : ''}${keys}}
只能從下列選項挑，不要自己發明；不確定就留空。
${optionsText(fields, cfg.allow)}`;
  const r = await askGemini(env, prompt);
  return {
    title: cfg.wantTitle && typeof r?.title === 'string' && r.title.trim() ? r.title.trim().slice(0, 100) : null,
    props: filterSuggestions(r, fields, cfg.allow),
  };
}
