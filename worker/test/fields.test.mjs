import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describe, toNotionProps } from '../src/fields.js';

test('只顯示白名單且類型相符的欄位', () => {
  const ds = { properties: { 行動種類: { type: 'select', select: { options: [{ name: '工作' }] } }, 已完成: { type: 'checkbox' }, '工作專案規劃 新版 1': { type: 'relation' } } };
  assert.deepEqual(describe('tasks', ds), [{ name: '行動種類', type: 'select', options: ['工作'] }, { name: '工作專案規劃 新版 1', type: 'relation', db: 'projects' }]);
});
test('寫入檢查：不在白名單、格式錯的都丟掉', () => {
  const p = toNotionProps('knowledge', {
    重要度: '★★★☆☆', 關鍵字: ['AI', 'AI', '', 5], 上傳日期: '2026-11-28', 相關連結: 'javascript:alert(1)',
    '工作專案規劃 新版': ['12345678-1234-1234-1234-123456789012', 'bad'], 封存: true, Name: 'x',
  });
  assert.deepEqual(Object.keys(p).sort(), ['上傳日期', '工作專案規劃 新版', '重要度', '關鍵字'].sort());
  assert.equal(p.關鍵字.multi_select.length, 1);
  assert.equal(p['工作專案規劃 新版'].relation.length, 1);
});

import { fromNotionProps } from '../src/fields.js';
test('讀範本欄位值', () => {
  const v = fromNotionProps('knowledge', {
    知識庫性質: { type: 'select', select: { name: '課堂筆記' } }, 觀看性質: { type: 'select', select: null },
    課堂筆記類別: { type: 'multi_select', multi_select: [{ name: '課堂筆記' }] }, 上傳日期: { type: 'date', date: { start: '2026-11-28T00:00:00.000+08:00' } },
    '工作專案規劃 新版': { type: 'relation', relation: [{ id: 'abc' }] }, Name: { type: 'title', title: [] },
  });
  assert.deepEqual(v, { 知識庫性質: '課堂筆記', 課堂筆記類別: ['課堂筆記'], 上傳日期: '2026-11-28', '工作專案規劃 新版': ['abc'] });
});
