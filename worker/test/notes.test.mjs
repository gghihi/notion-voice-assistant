import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSection, saveSectionItems, sectionRange } from '../src/notes.js';

const rt = (t) => [{ plain_text: t }];
const PAGE = [
  { id: 'H', type: 'heading_1', heading_1: { rich_text: rt('課程大綱：') } },
  { id: 'P1', type: 'heading_2', heading_2: { rich_text: rt('重點一'), is_toggleable: true }, has_children: true },
  { id: 'P2', type: 'heading_2', heading_2: { rich_text: rt('重點二'), is_toggleable: true }, has_children: true },
  { id: 'BTN', type: 'unsupported' },
  { id: 'H2', type: 'heading_1', heading_1: { rich_text: rt('重點回顧') } },
];
const KIDS = {
  P1: [{ id: 'S1', type: 'heading_3', heading_3: { rich_text: rt('小一'), is_toggleable: true }, has_children: true }],
  S1: [{ id: 'IM1', type: 'image', image: { type: 'file', file: { url: 'https://files/x.png' }, caption: [{ plain_text: '說明' }] } }, { id: 'T1', type: 'paragraph', paragraph: { rich_text: rt('內容') } }, { id: 'C1', type: 'code', code: { rich_text: rt('<a/>'), language: 'xml' } }, { id: 'B1', type: 'bookmark', bookmark: { url: 'https://x.com' } }],
  P2: [{ id: 'IMG', type: 'image' }],
};
function fakeNotion() {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const path = url.replace('https://api.notion.com/v1', '');
    calls.push([init.method, path, init.body]);
    const m = path.match(/^\/blocks\/(\w+)\/children/);
    if (init.method === 'GET' && m) return new Response(JSON.stringify({ results: m[1] === 'PAGE' ? PAGE : KIDS[m[1]] || [] }));
    return new Response('{}');
  };
  return calls;
}

test('讀出已寫好的重點（有看不懂的內容就鎖住）', async () => {
  fakeNotion();
  const r = await readSection({ NOTION_TOKEN: 'x' }, PAGE, { id: 'H', text: '課程大綱：', hasButton: true });
  assert.equal(r.preset, 'point');
  assert.deepEqual(r.items[0].subs[0], { title: '小一', text: '內容', links: ['https://x.com'], images: [{ blockId: 'IM1', preview: 'https://files/x.png', caption: '說明' }], code: '<a/>', lang: 'xml' });
  assert.equal(r.items[0].locked, false);
  assert.equal(r.items[1].locked, true);
});

test('修改：刪掉的移除、改過的原地換掉、新的放按鈕上方、別段的區塊不能動', async () => {
  const calls = fakeNotion();
  const env = { NOTION_TOKEN: 'x' };
  await saveSectionItems(env, 'PAGE', PAGE, { id: 'H' }, [
    { bid: 'P1', dirty: true, kind: 'point', title: '重點一（改）', subs: [] },
    { kind: 'point', title: '新重點', subs: [] },
  ], ['P2', 'H2']);
  const del = calls.filter((c) => c[0] === 'DELETE').map((c) => c[1]);
  assert.deepEqual(del, ['/blocks/P2', '/blocks/P1']); // H2 不在這一段，不會被刪
  assert.equal(calls.filter((c) => c[0] === 'PATCH').length, 2);
  assert.deepEqual(sectionRange(PAGE, 'H').map((b) => b.id), ['P1', 'P2', 'BTN']);
});

test('換順序：刪掉舊的，照新順序一次放回按鈕上方', async () => {
  const calls = fakeNotion();
  await saveSectionItems({ NOTION_TOKEN: 'x' }, 'PAGE', PAGE, { id: 'H' }, [
    { bid: 'P2', kind: 'point', title: '重點二', subs: [] },
    { bid: 'P1', kind: 'point', title: '重點一', subs: [] },
  ], [], true);
  assert.deepEqual(calls.filter((c) => c[0] === 'DELETE').map((c) => c[1]), ['/blocks/P2', '/blocks/P1']);
  const patch = calls.filter((c) => c[0] === 'PATCH');
  assert.equal(patch.length, 1);
});

import { resolveExistingImages } from '../src/notes.js';
test('修改含圖片的項目：原本的圖片重新上傳；別處的圖片不處理', async () => {
  const blocks = { IM1: { type: 'image', parent: { block_id: 'S1' }, image: { type: 'file', file: { url: 'https://files/x.png' } } }, S1: { parent: { block_id: 'P1' } },
    EVIL: { type: 'image', parent: { block_id: 'ZZ' }, image: { type: 'file', file: { url: 'https://files/y.png' } } }, ZZ: { parent: { block_id: 'OTHER' } } };
  globalThis.fetch = async () => new Response(new Uint8Array([1, 2]), { headers: { 'Content-Type': 'image/png' } });
  const list = [{ bid: 'P1', dirty: true, kind: 'point', subs: [{ images: [{ blockId: 'IM1', caption: '說明' }, { blockId: 'EVIL' }, { uploadId: 'new' }] }] }];
  await resolveExistingImages({}, list, new Set(['P1']), { getBlock: async (e, id) => blocks[id], uploadImage: async () => 'u-1' });
  assert.deepEqual(list[0].subs[0].images, [{ uploadId: 'u-1', caption: '說明' }, { uploadId: 'new' }]);
});
