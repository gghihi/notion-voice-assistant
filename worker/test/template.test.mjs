import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPageWithTemplate } from '../src/notion.js';

test('用範本建頁：不帶 children，套好後才加影片', async () => {
  const calls = [];
  let polls = 0;
  globalThis.fetch = async (url, init) => {
    calls.push([init.method, url.replace('https://api.notion.com/v1', ''), init.body && JSON.parse(init.body)]);
    if (init.method === 'POST') return new Response('{"id":"pg","url":"https://notion.so/pg"}');
    if (init.method === 'GET') return new Response(JSON.stringify({ results: ++polls >= 2 ? [{}] : [] }));
    return new Response('{}');
  };
  const body = { parent: {}, properties: { 相關連結: { url: 'u' } }, children: [{ type: 'video' }] };
  const r = await createPageWithTemplate({ NOTION_TOKEN: 'x' }, body, 'tpl', null, async () => {});
  assert.equal(r.url, 'https://notion.so/pg');
  assert.equal(calls[0][2].children, undefined);
  assert.equal(calls[0][2].template.template_id, 'tpl');
  assert.equal(calls.at(-1)[0], 'PATCH');
  assert.equal(polls, 2);
});
