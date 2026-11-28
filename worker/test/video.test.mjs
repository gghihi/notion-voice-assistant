import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detect, fetchInfo, buildPage } from '../src/video.js';

test('認得各種 YouTube 網址', () => {
  assert.equal(detect('https://youtu.be/dQw4w9WgXcQ?si=abc').url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(detect('看這個 https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=10').id, 'dQw4w9WgXcQ');
  assert.equal(detect('https://youtube.com/shorts/dQw4w9WgXcQ?feature=share').url, 'https://www.youtube.com/shorts/dQw4w9WgXcQ');
});
test('認得 IG 網址', () => {
  assert.equal(detect('https://www.instagram.com/reel/C1abcDEF/?igsh=xyz').url, 'https://www.instagram.com/reel/C1abcDEF/');
  assert.equal(detect('https://instagram.com/reels/C1abcDEF').url, 'https://www.instagram.com/reel/C1abcDEF/');
  assert.equal(detect('https://www.instagram.com/someone/p/C1abc/').platform, 'IG');
});
test('其他網址不收', () => {
  assert.equal(detect('https://evil.example/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(detect('沒有網址'), null);
});
test('YouTube 資訊（模擬）', async () => {
  const fake = async (u) => ({ ok: true, text: async () => u.includes('oembed') ? '{"title":"影片A","author_name":"欸那個AJ"}' : '<meta itemprop="uploadDate" content="2026-11-01T08:00:00-07:00">' });
  const info = await fetchInfo(detect('https://youtu.be/dQw4w9WgXcQ'), fake);
  assert.deepEqual([info.title, info.author], ['影片A', '欸那個AJ']);
  assert.equal(info.uploadDate, new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)); // 上傳日期＝今天
});
test('抓不到就留空', async () => {
  const info = await fetchInfo(detect('https://www.instagram.com/reel/X1/'), async () => ({ ok: false, status: 429 }));
  assert.equal(info.title, null); assert.equal(info.author, null);
});
test('Notion 頁面欄位', () => {
  const p = buildPage({ KNOWLEDGE_DS: 'ds' }, detect('https://youtu.be/dQw4w9WgXcQ'), { title: 'T', author: 'A,B', uploadDate: null, thumbnail: 'https://i.ytimg.com/x.jpg' }, '亂填');
  assert.equal(p.properties.知識庫性質.select.name, '課堂筆記');
  assert.equal(p.properties.觀看性質.select.name, '想看');
  assert.equal(p.properties.作者.multi_select[0].name, 'A B');
  assert.equal(p.children[0].type, 'video');
  assert.equal(p.properties.上傳日期, undefined);
});

test('IG 內文：主頁拿不到時改用嵌入頁', async () => {
  const fake = async (u) => u.includes('embed/captioned')
    ? { ok: true, text: async () => '<div class="Caption"><a class="CaptionUsername" href="#">be.ai.curator</a><br>你用 AI 做的網站，駭客會先試這 12 招。<br><br>#AI主理人<div class="CaptionComments"></div></div><span class="UsernameText">be.ai.curator</span>' }
    : { ok: false, status: 429 };
  const info = await fetchInfo(detect('https://www.instagram.com/reel/DgQOIszJpRL/?evlk=1'), fake);
  assert.match(info.caption, /駭客會先試這 12 招/);
  assert.doesNotMatch(info.caption, /be\.ai\.curator/);
  assert.equal(info.author, 'be.ai.curator');
});

test('IG 發布者：中文「在 Instagram」也抓得到', async () => {
  const fake = async (u) => u.includes('embed') ? { ok: false, status: 429 }
    : { ok: true, text: async () => '<meta property="og:title" content="AI 主理人在 Instagram: &quot;你用 AI 做的網站，駭客會先試這 12 招。\n在網址後面加個 admin">' };
  const info = await fetchInfo(detect('https://www.instagram.com/reel/X1/'), fake);
  assert.equal(info.author, 'AI 主理人');
  assert.equal(info.title, '你用 AI 做的網站，駭客會先試這 12 招。');
});

test('內文不會存進 Notion 頁面', () => {
  const p = buildPage({ KNOWLEDGE_DS: 'ds' }, detect('https://www.instagram.com/reel/X1/'), { title: 'T', caption: '很長的內文' }, '課堂筆記');
  assert.equal(JSON.stringify(p.children).includes('很長的內文'), false);
});

test('Threads 貼文', async () => {
  const v = detect('https://www.threads.net/@be.ai.curator/post/DAbc123xyz?xmt=1');
  assert.equal(v.platform, 'Threads');
  assert.equal(v.url, 'https://www.threads.com/@be.ai.curator/post/DAbc123xyz');
  const fake = async () => ({ ok: true, text: async () => '<meta property="og:title" content="AI 主理人 (&#064;be.ai.curator) on Threads"><meta property="og:description" content="五個 AI 證照比較\n第二行">' });
  const info = await fetchInfo(v, fake);
  assert.equal(info.author, 'AI 主理人'); assert.equal(info.title, '五個 AI 證照比較');
  const p = buildPage({ KNOWLEDGE_DS: 'ds' }, v, info, '課堂筆記');
  assert.equal(p.properties.課堂筆記通路.select.name, 'threads');
  assert.equal(JSON.stringify(p.children).includes('第二行'), false);
});

import { resolveShare } from '../src/video.js';
test('Threads 分享短網址 → 真正的貼文網址', async () => {
  const v = detect('https://www.threads.com/share/BAYpkSHskC');
  assert.equal(v.share, true);
  const viaRedirect = await resolveShare(v, async () => ({ url: 'https://www.threads.com/@be.ai.curator/post/DAbc123', text: async () => '' }));
  assert.equal(viaRedirect.url, 'https://www.threads.com/@be.ai.curator/post/DAbc123');
  const viaMeta = await resolveShare(v, async () => ({ url: v.url, text: async () => '<meta property="og:url" content="https://www.threads.net/@someone/post/XYZ9">' }));
  assert.equal(viaMeta.url, 'https://www.threads.com/@someone/post/XYZ9');
  const fail = await resolveShare(v, async () => { throw new Error('x'); });
  assert.equal(fail.share, true);
});

import { storyboardFrame, youtubeFrame } from '../src/video.js';
test('YouTube 某一秒的預覽畫面位置', () => {
  const spec = 'https://i.ytimg.com/sb/abc/storyboard3_L$L/$N.jpg?sqp=X|48#27#100#10#10#0#default#rs$A|80#45#100#10#10#2000#M$M#rs$B|160#90#100#5#5#2000#M$M#rs$C|320#180#100#3#3#2000#M$M#rs$D';
  const f = storyboardFrame(spec, 25); // 第 12 格（每 2 秒一格），每張 9 格 → 第 2 張的第 4 格
  assert.equal(f.url, 'https://i.ytimg.com/sb/abc/storyboard3_L3/M1.jpg?sqp=X&sigh=rs$D');
  assert.deepEqual([f.x, f.y, f.w, f.h], [0, 180, 320, 180]);
  assert.equal(storyboardFrame('', 3), null);
});
test('YouTube 畫面：從影片頁找到預覽圖並抓回來', async () => {
  const spec = 'https://i.ytimg.com/sb/abcdefghijk/storyboard3_L$L/$N.jpg?sqp=X|320#180#10#3#3#1000#M$M#rs$D';
  const fake = async (u) => u.includes('watch') ? { ok: true, text: async () => '..."playerStoryboardSpecRenderer":{"spec":"' + spec.replace(/&/g, '\\u0026') + '"}...' }
    : { ok: true, arrayBuffer: async () => new Uint8Array([255, 216, 255]).buffer };
  const f = await youtubeFrame('abcdefghijk', 4, fake);
  assert.match(f.dataUrl, /^data:image\/jpeg;base64,/);
  assert.deepEqual([f.x, f.y], [320, 180]);
});
