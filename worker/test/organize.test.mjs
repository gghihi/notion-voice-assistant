import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusOf, nextTenPm, digestMessage } from '../src/organize.js';

test('整理狀態判斷', () => {
  assert.equal(statusOf({ properties: { 觀看性質: { select: { name: '想看' } } } }), 'todo');
  assert.equal(statusOf({ properties: {} }), 'todo');
  assert.equal(statusOf({ properties: { 觀看性質: { select: { name: '作筆記/做作業' } } } }), 'doing');
  assert.equal(statusOf({ properties: { 觀看性質: { select: { name: '完成' } } } }), 'done');
  assert.equal(statusOf({ properties: { Done: { checkbox: true }, 觀看性質: { select: { name: '想看' } } } }), 'done');
});
test('下一個台灣晚上 10 點', () => {
  const tw = (y, m, d, h, mi) => Date.UTC(y, m, d, h, mi) - 8 * 3600000;
  assert.equal(nextTenPm(tw(2026, 10, 28, 13, 0)), tw(2026, 10, 28, 22, 0));
  assert.equal(nextTenPm(tw(2026, 10, 28, 22, 0)), tw(2026, 10, 29, 22, 0));
  assert.equal(nextTenPm(tw(2026, 10, 28, 23, 30)), tw(2026, 10, 29, 22, 0));
});
test('全部整理完就不提醒', () => {
  assert.equal(digestMessage([{ title: 'a', status: 'done' }]), null);
  assert.equal(digestMessage([]), null);
  const m = digestMessage([{ title: 'AI 資安', status: 'todo' }, { title: '剪輯', status: 'doing' }, { title: 'x', status: 'done' }]);
  assert.match(m.body, /1 則還沒整理、1 則整理中/);
  assert.match(m.body, /AI 資安/);
});
