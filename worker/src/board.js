// 公佈欄：記下存進 Notion 的東西（哪個資料庫、標題、時間），7 天後自動消失
export const KEEP_MS = 7 * 86400000;
const DB_NAMES = ['projects', 'tasks', 'knowledge'];

export async function addSaved(env, { db, title, url }, now = Date.now()) {
  if (!DB_NAMES.includes(db)) return;
  await env.DB.prepare('INSERT INTO saved (db, title, url, saved_at) VALUES (?, ?, ?, ?)')
    .bind(db, String(title || '（無標題）').slice(0, 200), url || null, now).run();
}

export async function listSaved(env, now = Date.now()) {
  await env.DB.prepare('DELETE FROM saved WHERE saved_at < ?').bind(now - KEEP_MS).run();
  const { results } = await env.DB.prepare('SELECT id, db, title, url, saved_at AS savedAt FROM saved ORDER BY saved_at DESC LIMIT 200').all();
  return results;
}

export async function removeSaved(env, id) {
  const { meta } = await env.DB.prepare('DELETE FROM saved WHERE id = ?').bind(Number(id) || 0).run();
  return meta.changes > 0;
}

export async function getSaved(env, id) {
  const { results } = await env.DB.prepare('SELECT id, db, title, url FROM saved WHERE id = ?').bind(Number(id) || 0).all();
  return results[0] || null;
}
