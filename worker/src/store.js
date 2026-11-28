// 提醒與推播地址的儲存空間（Cloudflare Durable Object，內建 SQLite，免費）。
// 用「鬧鐘」（alarm）在下一個提醒時間叫醒自己，不用每分鐘檢查。
import { DurableObject } from 'cloudflare:workers';
import { readFileSync } from './schema.js';
import { addOrganize, listOrganize, getOrganize, withStatus, nextTenPm, digestMessage } from './organize.js';
import { addSaved, listSaved, removeSaved, getSaved } from './board.js';
import { saveSubscription, addReminder, pushAll, runDueReminders, nextReminderAt } from './reminders.js';

// 把 Durable Object 的 SQL 包成和 D1 一樣的用法，讓 reminders.js 兩邊共用
function d1Like(sql) {
  return {
    prepare(q) {
      let args = [];
      const st = {
        bind: (...a) => { args = a; return st; },
        all: async () => ({ results: sql.exec(q, ...args).toArray() }),
        run: async () => { const c = sql.exec(q, ...args); c.toArray(); return { meta: { changes: c.rowsWritten } }; },
      };
      return st;
    },
  };
}

export class Store extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    for (const stmt of readFileSync().split(';').map((s) => s.trim()).filter(Boolean)) this.sql.exec(stmt.replace(/^CREATE (TABLE|INDEX) /, 'CREATE $1 IF NOT EXISTS '));
    this.e = { ...env, DB: d1Like(this.sql) };
  }
  // 鬧鐘設在「下一個提醒」和「下一個晚上 10 點整理提醒」比較早的那個
  async reschedule() {
    let digestAt = await this.ctx.storage.get('digestAt');
    if (!digestAt) { digestAt = nextTenPm(); await this.ctx.storage.put('digestAt', digestAt); }
    const at = await nextReminderAt(this.e);
    await this.ctx.storage.setAlarm(Math.max(Math.min(at ?? Infinity, digestAt), Date.now()));
  }
  async addOrganize(item) { await addOrganize(this.e, item); await this.reschedule(); }
  async listOrganize() { return listOrganize(this.e); }
  async getOrganize(id) { return getOrganize(this.e, id); }
  async organizeWithStatus() { return withStatus(this.e, await listOrganize(this.e)); }
  async saveSubscription(sub) { return saveSubscription(this.e, sub); }
  async addReminder(r) { await addReminder(this.e, r); await this.reschedule(); }
  async pushAll(msg) { return pushAll(this.e, msg); }
  async addSaved(item) { return addSaved(this.e, item); }
  async listSaved() { return listSaved(this.e); }
  async getSaved(id) { return getSaved(this.e, id); }
  async removeSaved(id) { return removeSaved(this.e, id); }
  async alarm() {
    await runDueReminders(this.e);
    const digestAt = await this.ctx.storage.get('digestAt');
    if (digestAt && Date.now() >= digestAt) {
      await this.ctx.storage.put('digestAt', nextTenPm());
      try {
        const msg = digestMessage(await this.organizeWithStatus());
        if (msg) await pushAll(this.e, msg); // 全部整理完就不提醒
      } catch (e) { console.log('digest', e.message); }
    }
    await this.reschedule();
  }
}
