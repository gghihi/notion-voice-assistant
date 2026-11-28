import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiTask, aiSuggest, filterSuggestions, askGemini } from '../src/ai.js';

const reply = (obj, status = 200) => ({ GEMINI_MODEL: 'm1', GEMINI_FALLBACK_MODEL: 'm2', GEMINI_PROXY: { fetch: async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }), { status }) } });

test('任務：AI 回傳的時間與選項', async () => {
  const r = await aiTask(reply({ title: '開會', at: '2026-11-29T15:00:00+08:00', 行動種類: '工作' }), '明天下午三點開會', [{ name: '行動種類', type: 'select', options: ['工作', '個人'] }]);
  assert.equal(r.title, '開會'); assert.equal(r.at, Date.parse('2026-11-29T15:00:00+08:00')); assert.deepEqual(r.props, { 行動種類: '工作' });
});
test('AI 發明的選項會被丟掉', () => {
  const f = [{ name: '關鍵字', type: 'multi_select', options: ['AI', '剪輯'] }, { name: '重要度', type: 'select', options: ['★★★☆☆'] }];
  assert.deepEqual(filterSuggestions({ 關鍵字: ['AI', '亂編', 'AI'], 重要度: '超重要' }, f, ['關鍵字', '重要度']), { 關鍵字: ['AI'] });
});
test('額度用完 → quota；模擬開關也是 quota；關閉 → off', async () => {
  await assert.rejects(askGemini(reply({}, 429), 'x'), (e) => e.kind === 'quota');
  await assert.rejects(askGemini({ ...reply({}), AI_SIMULATE_QUOTA: '1' }, 'x'), (e) => e.kind === 'quota');
  await assert.rejects(askGemini({ ...reply({}), AI_ENABLED: '0' }, 'x'), (e) => e.kind === 'off');
});
test('專案建議：標題與分類', async () => {
  const r = await aiSuggest(reply({ title: '街訪企劃', 種類: ['企劃類', '不存在'], 專案領域關鍵字: [] }), 'projects', '想做街訪', [{ name: '種類', type: 'multi_select', options: ['企劃類'] }, { name: '專案領域關鍵字', type: 'multi_select', options: ['影片拍攝'] }]);
  assert.equal(r.title, '街訪企劃'); assert.deepEqual(r.props, { 種類: ['企劃類'] });
});

test('模型不接受「不思考」設定時，改用一般方式再試', async () => {
  const seen = [];
  const env = { GEMINI_MODEL: 'm1', GEMINI_PROXY: { fetch: async (u, init) => {
    const fast = !!JSON.parse(init.body).generationConfig.thinkingConfig; seen.push(fast);
    return fast ? new Response('{}', { status: 400 }) : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":1}' }] } }] }));
  } } };
  const { askGemini } = await import('../src/ai.js');
  assert.deepEqual(await askGemini(env, 'x'), { ok: 1 });
  assert.deepEqual(seen, [true, false]);
});

import { cleanNoteDraft, aiWriteNote } from '../src/ai.js';
test('AI 撰寫：YouTube 交給 Gemini 看影片、草稿只留正確格式', async () => {
  let sent;
  const env = { GEMINI_MODEL: 'm', GEMINI_PROXY: { fetch: async (u, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ A: [{ title: '重點', subs: [{ title: '小', text: '內容' }] }, 'x'], B: [{ q: '問？', a: '答' }], C: { text: '心得' } }) }] } }] })); } } };
  const secs = [{ id: 'A', text: '課程大綱', preset: 'point' }, { id: 'B', text: '重點回顧', preset: 'qa' }, { id: 'C', text: '總結', preset: null }];
  const raw = await aiWriteNote(env, { title: 'T', video: { platform: 'YouTube', url: 'https://www.youtube.com/watch?v=abc' }, sections: secs });
  assert.equal(sent.contents[0].parts[0].file_data.file_uri, 'https://www.youtube.com/watch?v=abc');
  const d = cleanNoteDraft(raw, secs);
  assert.equal(d.A.length, 1); assert.equal(d.A[0].subs[0].text, '內容');
  assert.deepEqual(d.B[0], { kind: 'qa', q: '問？', a: '答', links: [] });
  assert.deepEqual(d.C, { text: '心得' });
});
