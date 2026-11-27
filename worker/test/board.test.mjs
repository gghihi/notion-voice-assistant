import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { addSaved, listSaved, removeSaved, KEEP_MS } from '../src/board.js';

function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  return { prepare: (sql) => { let a = []; const st = { bind: (...x) => { a = x; return st; },
    all: async () => ({ results: db.prepare(sql).all(...a) }),
    run: async () => ({ meta: { changes: db.prepare(sql).run(...a).changes } }) }; return st; } };
}
test('公佈欄：新增、排序、刪除、7 天後消失', async () => {
  const env = { DB: fakeD1() };
  await addSaved(env, { db: 'projects', title: '舊的', url: 'u1' }, 1000);
  await addSaved(env, { db: 'tasks', title: '新的', url: 'u2' }, 2000);
  await addSaved(env, { db: 'evil', title: 'x' }, 2000);
  let items = await listSaved(env, 3000);
  assert.deepEqual(items.map((i) => i.title), ['新的', '舊的']);
  assert.equal(await removeSaved(env, items[0].id), true);
  items = await listSaved(env, 1000 + KEEP_MS + 1);
  assert.equal(items.length, 0);
});
