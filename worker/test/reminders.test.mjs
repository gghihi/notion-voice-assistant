import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { runDueReminders, addReminder, saveSubscription } from '../src/reminders.js';

// 用 node:sqlite 模擬 Cloudflare D1
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  return { prepare: (sql) => { let args = []; const st = { bind: (...a) => { args = a; return st; },
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes } }; } }; return st; } };
}

test('到時間才發、只發一次', async () => {
  const env = { DB: fakeD1() };
  await addReminder(env, { title: '開會', remindAt: 1000, eventAt: 1000 });
  await addReminder(env, { title: '未來', remindAt: 5000, eventAt: 5000 });
  assert.equal(await runDueReminders(env, 2000), 1);
  assert.equal(await runDueReminders(env, 2000), 0);
  assert.equal(await runDueReminders(env, 6000), 1);
});
test('推播資料檢查', async () => {
  const env = { DB: fakeD1() };
  assert.equal(await saveSubscription(env, { endpoint: 'http://x', keys: { p256dh: 'a', auth: 'b' } }), false);
  assert.equal(await saveSubscription(env, { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'a', auth: 'b' } }), true);
});
