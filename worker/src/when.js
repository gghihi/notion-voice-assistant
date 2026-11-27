// 從一句中文找出日期時間（不用 AI 的規則版；AI 版在里程碑 5 加上）。
// 所有時間都以台灣時間（UTC+8）理解。找不到時間就回傳 null，交給使用者自己選，不亂猜。
const TZ = 8 * 3600000;
const NUM = { 零: 0, 〇: 0, 一: 1, 兩: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

export function cnNum(s) {
  if (s == null) return null;
  if (/^\d+$/.test(s)) return Number(s);
  if (s === '半') return 30;
  const m = s.match(/^([一二兩三四五六七八九])?十([一二三四五六七八九])?$/);
  if (m) return (m[1] ? NUM[m[1]] : 1) * 10 + (m[2] ? NUM[m[2]] : 0);
  return s.length === 1 && s in NUM ? NUM[s] : null;
}
const N = '(\\d+|[零〇一二兩三四五六七八九十]+|半)';

// 台灣時間的「年月日時分」轉成真正時間戳
const toTs = (y, mo, d, h, mi) => Date.UTC(y, mo, d, h, mi) - TZ;
function twParts(ts) {
  const t = new Date(ts + TZ);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth(), d: t.getUTCDate(), wd: t.getUTCDay() };
}

/** 回傳 { at: 時間戳, title: 去掉時間後的事情 }；完全找不到時間時 at=null */
export function parseWhen(text, now = Date.now()) {
  let s = String(text).trim();
  let rest = s;
  const cut = (re) => { rest = rest.replace(re, ' '); };

  // 「N 分鐘後／N 小時後」
  let m = s.match(new RegExp(N + '\\s*(分鐘|分|小時|個小時)(以?後|之後)'));
  if (m) {
    const n = cnNum(m[1]);
    if (n != null) {
      cut(m[0]);
      return { at: now + n * (m[2].includes('時') ? 3600000 : 60000), title: clean(rest) };
    }
  }

  const p = twParts(now);
  let y = p.y, mo = p.mo, d = p.d, dayFound = false;
  const dayWords = { 今天: 0, 今日: 0, 明天: 1, 明日: 1, 後天: 2, 大後天: 3 };
  m = s.match(/大後天|今天|今日|明天|明日|後天/);
  if (m) { d += dayWords[m[0]]; dayFound = true; cut(m[0]); }
  m = s.match(new RegExp('(\\d{1,2}|[一二三四五六七八九十]+)\\s*月\\s*' + N + '\\s*[日號]'));
  if (m) { mo = cnNum(m[1]) - 1; d = cnNum(m[2]); dayFound = true; cut(m[0]); if (toTs(y, mo, d, 23, 59) < now) y++; }
  m = s.match(/(下|這|本)?(週|星期|禮拜)([一二三四五六日天])/);
  if (m) {
    const target = '日天'.includes(m[3]) ? 0 : NUM[m[3]];
    let diff = (target - p.wd + 7) % 7;
    if (m[1] === '下') diff += 7;
    else if (diff === 0 && !m[1]) diff = 0;
    d += diff; dayFound = true; cut(m[0]);
  }

  let h = null, mi = 0;
  m = s.match(new RegExp('(早上|上午|中午|下午|傍晚|晚上|半夜|凌晨)?\\s*' + N + '\\s*[點:：時]\\s*(' + N.slice(1, -1) + ')?\\s*分?'));
  if (m) {
    h = cnNum(m[2]);
    mi = m[3] ? cnNum(m[3]) : 0;
    const period = m[1];
    if (h != null) {
      if (['下午', '傍晚', '晚上'].includes(period) && h < 12) h += 12;
      if (period === '中午' && h < 6) h += 12;
      if (period === '半夜' && h === 12) h = 0;
      cut(m[0]);
    }
  }
  if (h == null || h > 23 || mi > 59) return { at: null, title: clean(rest), dayFound };
  let at = toTs(y, mo, d, h, mi);
  if (!dayFound && at < now) at += 86400000; // 只說「3點」且已過 → 明天
  return { at, title: clean(rest) };
}

function clean(s) {
  return s.replace(/^[\s，,、]*(提醒我|記得|要|去)?/, '').replace(/[\s，,。]+/g, ' ').trim() || '未命名行程';
}

// 給 Notion 用的台灣時間字串，例如 2026-11-28T15:00:00+08:00
export function twIso(ts) {
  return new Date(ts + TZ).toISOString().slice(0, 19) + '+08:00';
}
