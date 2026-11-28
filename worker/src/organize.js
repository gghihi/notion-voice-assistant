// 整理庫：追蹤存進知識庫的東西有沒有整理（7 天後從 APP 消失，Notion 保留）
import { KEEP_MS } from './board.js';

// 狀態判斷：看知識庫的「Done」勾選框和「觀看性質」
const DOING = ['正在看', '作筆記/做作業', '看到一個段落'];
export function statusOf(page) {
  const p = page?.properties || {};
  const watch = p['觀看性質']?.select?.name || '';
  if (p.Done?.checkbox === true || watch === '完成') return 'done';
  if (DOING.includes(watch)) return 'doing';
  return 'todo';
}
// APP 按鈕 → 寫回 Notion 的值
export const STATUS_TO_NOTION = {
  todo: { 觀看性質: { select: { name: '想看' } }, Done: { checkbox: false } },
  doing: { 觀看性質: { select: { name: '正在看' } }, Done: { checkbox: false } },
  done: { 觀看性質: { select: { name: '完成' } }, Done: { checkbox: true } },
};

export async function addOrganize(env, { title, url }, now = Date.now()) {
  await env.DB.prepare('INSERT INTO organize (title, url, saved_at) VALUES (?, ?, ?)').bind(String(title || '（無標題）').slice(0, 200), url || null, now).run();
}
export async function listOrganize(env, now = Date.now()) {
  await env.DB.prepare('DELETE FROM organize WHERE saved_at < ?').bind(now - KEEP_MS).run();
  const { results } = await env.DB.prepare('SELECT id, title, url, saved_at AS savedAt FROM organize ORDER BY saved_at DESC LIMIT 200').all();
  return results;
}
export async function getOrganize(env, id) {
  const { results } = await env.DB.prepare('SELECT id, title, url FROM organize WHERE id = ?').bind(Number(id) || 0).all();
  return results[0] || null;
}
export async function removeOrganize(env, id) {
  await env.DB.prepare('DELETE FROM organize WHERE id = ?').bind(Number(id) || 0).run();
}

// 下一個台灣時間晚上 10 點
export function nextTenPm(now = Date.now()) {
  const TZ = 8 * 3600000;
  const t = new Date(now + TZ);
  let at = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), 22, 0) - TZ;
  if (at <= now) at += 86400000;
  return at;
}

// 晚上 10 點的提醒文字；全部整理完就回傳 null（不提醒）
export function digestMessage(items) {
  const todo = items.filter((i) => i.status === 'todo');
  const doing = items.filter((i) => i.status === 'doing');
  if (!todo.length && !doing.length) return null;
  const names = [...todo, ...doing].slice(0, 3).map((i) => '「' + i.title.slice(0, 18) + '」').join('、');
  const parts = [todo.length && `${todo.length} 則還沒整理`, doing.length && `${doing.length} 則整理中`].filter(Boolean).join('、');
  return { title: '🗂️ 今天的知識整理了嗎？', body: `${parts}：${names}${todo.length + doing.length > 3 ? '…' : ''}`, url: '', tag: 'organize-digest' };
}

// 讀 Notion 取得每一筆的整理狀態；在 Notion 已刪除的順便從整理庫拿掉
import { getPage, pageIdFromUrl } from './notion.js';
export async function withStatus(env, items) {
  const out = await Promise.all(items.slice(0, 60).map(async (it) => {
    const pid = pageIdFromUrl(it.url);
    if (!pid) return { ...it, status: 'todo' };
    try {
      const pg = await getPage(env, pid);
      if (pg.in_trash || pg.archived) { await removeOrganize(env, it.id); return null; }
      return { ...it, status: statusOf(pg) };
    } catch (e) {
      if (e.status === 404) { await removeOrganize(env, it.id); return null; }
      return { ...it, status: 'unknown' };
    }
  }));
  return out.filter(Boolean);
}
