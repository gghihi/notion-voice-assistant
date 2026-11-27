// 提醒與推播地址的儲存空間（Cloudflare Durable Object，內建 SQLite，免費）。
// 用「鬧鐘」（alarm）在下一個提醒時間叫醒自己，不用每分鐘檢查。
import { DurableObject } from 'cloudflare:workers';
import { readFileSync } from './schema.js';
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
  async reschedule() {
    const at = await nextReminderAt(this.e);
    if (at == null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(at, Date.now()));
  }
  async saveSubscription(sub) { return saveSubscription(this.e, sub); }
  async addReminder(r) { await addReminder(this.e, r); await this.reschedule(); }
  async pushAll(msg) { return pushAll(this.e, msg); }
  async alarm() { await runDueReminders(this.e); await this.reschedule(); }
}
