// 每個資料庫在 APP 裡可以選的欄位（白名單）。只有這裡列出的欄位能被寫入，其他一律忽略。
export const DBS = {
  projects: {
    env: 'NOTES_DS', title: 'Title',
    fields: {
      專案狀態: 'select', 種類: 'multi_select', 專案領域關鍵字: 'multi_select', 執行日期: 'date',
      所有任務清單: { type: 'relation', db: 'tasks' },
    },
  },
  tasks: {
    env: 'TASKS_DS', title: '任務內容',
    fields: { 行動種類: 'select', '工作專案規劃 新版 1': { type: 'relation', db: 'projects' } },
  },
  knowledge: {
    env: 'KNOWLEDGE_DS', title: 'Name',
    fields: {
      作者: 'multi_select', 知識庫性質: 'select', 重要度: 'select', 觀看性質: 'select', 上傳日期: 'date',
      相關連結: 'url', 關鍵字: 'multi_select', '工作專案規劃 新版': { type: 'relation', db: 'projects' },
      課堂筆記類別: 'multi_select', 課堂筆記通路: 'select',
    },
  },
};

const typeOf = (f) => (typeof f === 'string' ? f : f.type);
const cleanName = (s) => String(s).replace(/,/g, ' ').trim().slice(0, 100);
const isId = (s) => typeof s === 'string' && /^[0-9a-f-]{32,36}$/i.test(s);

/** 把 Notion 的資料庫設定整理成 APP 用的欄位清單（含選項） */
export function describe(dbKey, dataSource) {
  const def = DBS[dbKey];
  const out = [];
  for (const [name, f] of Object.entries(def.fields)) {
    const p = dataSource.properties?.[name];
    if (!p || p.type !== typeOf(f)) continue; // Notion 裡改名或刪掉了就不顯示
    const item = { name, type: p.type };
    if (p.type === 'select' || p.type === 'multi_select') item.options = (p[p.type].options || []).map((o) => o.name);
    if (p.type === 'relation') item.db = f.db;
    out.push(item);
  }
  return out;
}

/** 檢查並轉成 Notion 欄位格式；不在白名單、格式不對的一律丟掉 */
export function toNotionProps(dbKey, input) {
  const def = DBS[dbKey];
  const props = {};
  if (!input || typeof input !== 'object') return props;
  for (const [name, value] of Object.entries(input)) {
    const f = def.fields[name];
    if (!f || value == null || value === '') continue;
    const t = typeOf(f);
    if (t === 'select' && typeof value === 'string') props[name] = { select: { name: cleanName(value) } };
    else if (t === 'multi_select' && Array.isArray(value)) {
      const names = [...new Set(value.filter((v) => typeof v === 'string' && v.trim()).map(cleanName))].slice(0, 20);
      if (names.length) props[name] = { multi_select: names.map((n) => ({ name: n })) };
    } else if (t === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\+08:00)?)?$/.test(value)) {
      props[name] = { date: { start: value } };
    } else if (t === 'url' && typeof value === 'string' && /^https?:\/\//.test(value) && value.length < 2000) props[name] = { url: value };
    else if (t === 'relation' && Array.isArray(value)) {
      const ids = value.filter(isId).slice(0, 20);
      if (ids.length) props[name] = { relation: ids.map((id) => ({ id })) };
    }
  }
  return props;
}
