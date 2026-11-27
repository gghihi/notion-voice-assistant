-- 推播地址（每台允許通知的裝置一筆）
CREATE TABLE push_subs (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
-- 待發的提醒
CREATE TABLE reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  remind_at INTEGER NOT NULL,   -- 毫秒時間戳
  event_at INTEGER NOT NULL,
  page_url TEXT,
  sent INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_reminders_due ON reminders (sent, remind_at);
-- 公佈欄：存進 Notion 的紀錄（只留 7 天）
CREATE TABLE saved (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  db TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  saved_at INTEGER NOT NULL
);
