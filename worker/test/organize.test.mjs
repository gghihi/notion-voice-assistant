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

import { outlineOf, sectionEnd } from '../src/notion.js';
test('範本格式：找段落標題與段落結尾', () => {
  const rt = (t) => [{ plain_text: t }];
  const blocks = [
    { id: 'h1', type: 'heading_2', heading_2: { rich_text: rt('重點整理') } },
    { id: 'p1', type: 'paragraph', paragraph: { rich_text: [] } },
    { id: 'p2', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [] } },
    { id: 'h2', type: 'heading_2', heading_2: { rich_text: rt('心得'), is_toggleable: true } },
    { id: 't1', type: 'toggle', toggle: { rich_text: rt('延伸閱讀') } },
    { id: 'h3', type: 'heading_3', heading_3: { rich_text: [] } },
  ];
  assert.deepEqual(outlineOf(blocks).map((o) => [o.text, o.toggle]), [['重點整理', false], ['心得', true], ['延伸閱讀', true]]);
  assert.equal(sectionEnd(blocks, 'h1'), 'p2');
  assert.equal(sectionEnd(blocks, 'nope'), null);
});

import { sectionAnchor, itemBlocks } from '../src/notion.js';
test('按鈕上方的位置與結構化筆記', () => {
  const blocks = [
    { id: 'h', type: 'heading_1', heading_1: { rich_text: [{ plain_text: '課程大綱' }] } },
    { id: 'p', type: 'paragraph', paragraph: { rich_text: [] } },
    { id: 'btn', type: 'unsupported' },
    { id: 'h2', type: 'heading_1', heading_1: { rich_text: [{ plain_text: '重點回顧' }] } },
    { id: 'btn2', type: 'unsupported' },
  ];
  assert.equal(sectionAnchor(blocks, 'h'), 'p');
  assert.equal(sectionAnchor(blocks, 'h2'), 'h2');
  const b = itemBlocks([{ kind: 'point', title: 'AI 操作桌面', subs: [{ title: '工具', text: 'Claude' }, { title: '', text: '' }] }, { kind: 'qa', q: '', a: '答案' }, { kind: 'x' }]);
  assert.equal(b.length, 2);
  assert.equal(b[0].heading_2.is_toggleable, true);
  assert.equal(b[0].heading_2.children.length, 1);
  assert.equal(b[0].heading_2.children[0].heading_3.children[0].paragraph.rich_text[0].text.content, 'Claude');
  assert.equal(b[1].toggle.rich_text[0].text.content, '?');
});

test('程式筆記：小重點裡的程式碼框', () => {
  const b = itemBlocks([{ kind: 'point', title: '提示詞', subs: [{ title: '角色設定', code: '<role>助理</role>' }, { title: 'x', code: 'print(1)', lang: 'evil' }] }]);
  const kids = b[0].heading_2.children;
  assert.equal(kids[0].heading_3.children[0].code.language, 'xml');
  assert.equal(kids[0].heading_3.children[0].code.rich_text[0].text.content, '<role>助理</role>');
  assert.equal(kids[1].heading_3.children[0].code.language, 'xml');
});

test('網址書籤', () => {
  const b = itemBlocks([{ kind: 'point', title: 'p', subs: [{ title: '註冊', links: ['https://claude.ai/new', 'javascript:alert(1)', ''] }] }, { kind: 'qa', q: '哪裡下載？', links: ['https://claude.ai/download'] }]);
  const sub = b[0].heading_2.children[0].heading_3.children;
  assert.deepEqual(sub.map((x) => x.type), ['bookmark']);
  assert.equal(sub[0].bookmark.url, 'https://claude.ai/new');
  assert.equal(b[1].toggle.children[0].bookmark.url, 'https://claude.ai/download');
});

test('筆記圖片：只接受上傳編號，附說明', () => {
  const b = itemBlocks([{ kind: 'qa', q: '這是什麼畫面？', images: [{ uploadId: '12345678-1234-1234-1234-123456789abc', caption: '⏱️ 3:25' }, { uploadId: 'bad' }] }]);
  const img = b[0].toggle.children.filter((x) => x.type === 'image');
  assert.equal(img.length, 1);
  assert.equal(img[0].image.file_upload.id, '12345678-1234-1234-1234-123456789abc');
  assert.equal(img[0].image.caption[0].text.content, '⏱️ 3:25');
});
