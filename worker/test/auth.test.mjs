import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPassword, issueToken, verifyToken } from '../src/auth.js';
import { paragraphs, noteTitle } from '../src/notion.js';
import worker from '../src/handler.js';

const env = { APP_PASSWORD: 'right-pw', SESSION_SECRET: 's3cret', ALLOWED_ORIGIN: 'https://gghihi.github.io' };

test('密碼正確才通過', async () => {
  assert.equal(await checkPassword(env, 'right-pw'), true);
  assert.equal(await checkPassword(env, 'wrong'), false);
  assert.equal(await checkPassword(env, undefined), false);
  assert.equal(await checkPassword({ ...env, APP_PASSWORD: '' }, ''), false);
});

test('通行證：有效、過期、被竄改', async () => {
  const t = await issueToken(env);
  assert.equal(await verifyToken(env, t), true);
  assert.equal(await verifyToken(env, t, Date.now() + 31 * 86400000), false);
  assert.equal(await verifyToken(env, t.replace(/^\d/, '9')), false);
  assert.equal(await verifyToken({ ...env, SESSION_SECRET: 'other' }, t), false);
});

test('陌生來源一律拒絕', async () => {
  const r = await worker.fetch(new Request('https://w/api/health', { headers: { Origin: 'https://evil.example' } }), env);
  assert.equal(r.status, 403);
});

test('沒通行證不能存筆記', async () => {
  const r = await worker.fetch(new Request('https://w/api/note', { method: 'POST', headers: { Origin: env.ALLOWED_ORIGIN }, body: '{"text":"x"}' }), env);
  assert.equal(r.status, 401);
});

test('登入流程', async () => {
  const bad = await worker.fetch(new Request('https://w/api/login', { method: 'POST', headers: { Origin: env.ALLOWED_ORIGIN }, body: '{"password":"no"}' }), env);
  assert.equal(bad.status, 401);
  const ok = await worker.fetch(new Request('https://w/api/login', { method: 'POST', headers: { Origin: env.ALLOWED_ORIGIN }, body: '{"password":"right-pw"}' }), env);
  assert.equal(ok.status, 200);
  assert.ok((await ok.json()).token);
});

test('筆記標題與段落', () => {
  assert.equal(noteTitle('第一行\n第二行'), '第一行');
  assert.equal(noteTitle('字'.repeat(50)).length, 41);
  assert.equal(paragraphs('a\nb').length, 2);
  assert.equal(paragraphs('x'.repeat(4500)).length, 3);
});
