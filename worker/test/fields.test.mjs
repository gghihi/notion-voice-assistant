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
