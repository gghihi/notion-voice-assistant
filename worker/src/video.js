// 影片存入知識庫：先抓標題、頻道、縮圖、上傳日期，再建立 Notion 頁面。
// 抓不到的資料一律留空，不亂猜。
// 「課堂筆記通路」欄位裡的選項名稱
export const CHANNEL = { YouTube: 'YouTube', IG: 'IG', Threads: 'threads' };
export const KINDS = ['書', '電影', '哲學＆定理＆心理', '課堂筆記', '短影片', '冷知識'];

/** 判斷是哪個平台，並整理成乾淨的網址；不是 YouTube／IG 就回傳 null */
export function detect(raw) {
  const m = String(raw || '').match(/https?:\/\/[^\s]+/);
  if (!m) return null;
  let u;
  try { u = new URL(m[0]); } catch { return null; }
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com') {
    id = u.searchParams.get('v') || (u.pathname.match(/^\/(shorts|live|embed)\/([\w-]{11})/) || [])[2];
  }
  if (id && /^[\w-]{11}$/.test(id)) {
    const shorts = u.pathname.startsWith('/shorts/');
    return { platform: 'YouTube', id, url: shorts ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}` };
  }
  if (host === 'instagram.com') {
    const p = u.pathname.match(/^\/(?:[\w.]+\/)?(p|reel|reels|tv)\/([\w-]+)/);
    if (p) return { platform: 'IG', id: p[2], url: `https://www.instagram.com/${p[1] === 'reels' ? 'reel' : p[1]}/${p[2]}/` };
  }
  if (host === 'threads.net' || host === 'threads.com') {
    const t = u.pathname.match(/^\/(@[\w.]+)\/post\/([\w-]+)/);
    if (t) return { platform: 'Threads', id: t[2], url: `https://www.threads.com/${t[1]}/post/${t[2]}` };
    // 分享按鈕給的短網址（/share/代碼），要先轉成真正的貼文網址
    const sh = u.pathname.match(/^\/share\/([\w-]+)/);
    if (sh) return { platform: 'Threads', share: true, id: sh[1], url: `https://www.threads.com/share/${sh[1]}` };
  }
  return null;
}

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; notion-voice-assistant)', 'Accept-Language': 'zh-TW,zh;q=0.9' };
const decode = (s) => s && s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const meta = (html, prop) => decode((html.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${prop}["'][^>]+content=["']([^"']*)`, 'i')) || [])[1] || null);

async function getText(url, fetchImpl) {
  const ctl = AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined;
  const r = await fetchImpl(url, { headers: UA, signal: ctl, redirect: 'follow' });
  if (!r.ok) throw new Error('http_' + r.status);
  return (await r.text()).slice(0, 1500000);
}

/** 短網址 → 真正的貼文網址（跟著轉址走，或讀頁面裡的 og:url／canonical）；轉不出來就回傳原本的 */
export async function resolveShare(v, fetchImpl = fetch) {
  if (!v?.share) return v;
  try {
    const r = await fetchImpl(v.url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined });
    const direct = detect(r.url || '');
    if (direct && !direct.share) return direct;
    const html = (await r.text()).slice(0, 500000);
    const found = meta(html, 'og:url') || (html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i) || [])[1]
      || (html.match(/https:\/\/www\.threads\.(?:net|com)\/@[\w.]+\/post\/[\w-]+/) || [])[0];
    const real = found && detect(decode(found));
    if (real && !real.share) return real;
  } catch {}
  return v;
}

/** 抓影片資訊：{ title, author, thumbnail, uploadDate(YYYY-MM-DD) } */
export async function fetchInfo(v, fetchImpl = fetch) {
  const info = { title: null, author: null, thumbnail: null, uploadDate: null, caption: null };
  if (v.platform === 'YouTube') {
    try {
      const o = JSON.parse(await getText('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(v.url), fetchImpl));
      info.title = o.title || null; info.author = o.author_name || null;
    } catch {}
    info.thumbnail = `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
    try {
      const html = await getText(`https://www.youtube.com/watch?v=${v.id}&hl=zh-TW`, fetchImpl);
      info.uploadDate = (meta(html, 'uploadDate') || (html.match(/"(?:uploadDate|publishDate)":"(\d{4}-\d{2}-\d{2})/) || [])[1] || '').slice(0, 10) || null;
      info.title ||= meta(html, 'og:title');
    } catch {}
  } else if (v.platform === 'Threads') {
    try {
      const html = await getText(v.url, fetchImpl);
      // og:title 例如「AI 主理人 (@be.ai.curator) on Threads」；og:description 是貼文內容
      const ogTitle = decode(meta(html, 'og:title') || '');
      const by = ogTitle.match(/^(.+?)\s*[(（]@/) || ogTitle.match(/^(.+?)\s*(?:on|在)\s*Threads/i);
      info.author = by ? by[1].trim() : (v.url.match(/@([\w.]+)/) || [])[1] || null;
      info.thumbnail = meta(html, 'og:image');
      const text = meta(html, 'og:description');
      if (text) { info.caption = text.slice(0, 1500); info.title = text.split('\n')[0].slice(0, 150); }
    } catch {}
    if (!info.author) info.author = (v.url.match(/@([\w.]+)/) || [])[1] || null;
  } else {
    try {
      const html = await getText(v.url, fetchImpl);
      const ogTitle = meta(html, 'og:title');
      info.thumbnail = meta(html, 'og:image');
      const desc = meta(html, 'og:description') || '';
      // IG 的 og:title 常是「某某 on Instagram: "內容"」
      // 發布者：og:title 開頭「AI 主理人在 Instagram: …」或「Name on Instagram: …」
      const by = (ogTitle || '').match(/^(.+?)\s*(?:on|在)\s*Instagram/i) || desc.match(/-\s*([\w.]+)\s*(?:on|在)\s/);
      info.author = by ? by[1].trim() : null;
      const said = (ogTitle || '').match(/Instagram[:：]\s*["“]([\s\S]+?)["”]?\s*$/);
      // 標題先用內文第一句（之後 AI 會依整段內文改寫）
      info.title = (said ? said[1].split('\n')[0] : ogTitle)?.slice(0, 150) || null;
      const d = desc.match(/(\w+ \d{1,2}, \d{4})/);
      if (d) { const t = new Date(d[1] + ' UTC'); if (!isNaN(t)) info.uploadDate = t.toISOString().slice(0, 10); }
      // 內文：og:description 通常是「… on Instagram: "內文"」
      const cap = desc.match(/[:：]\s*["“]([\s\S]+?)["”]?\s*$/);
      if (cap) info.caption = cap[1];
    } catch {}
    // 主頁拿不到內文時，改試 IG 的嵌入頁（通常不用登入就看得到內文）
    if (!info.caption) {
      try {
        const html = await getText(v.url + 'embed/captioned/', fetchImpl);
        const cap = html.match(/class="Caption"[^>]*>([\s\S]*?)<div class="CaptionComments/) || html.match(/class="Caption"[^>]*>([\s\S]*?)<\/div>/);
        if (cap) {
          info.caption = decode(cap[1].replace(/<br\s*\/?>/g, '\n').replace(/<a[^>]*class="CaptionUsername"[^>]*>[\s\S]*?<\/a>/, '').replace(/<[^>]+>/g, '')).trim();
        }
        const user = html.match(/class="UsernameText"[^>]*>([^<]+)</);
        if (user && !info.author) info.author = decode(user[1]).trim();
        if (!info.thumbnail) { const img = html.match(/class="EmbeddedMediaImage"[^>]+src="([^"]+)"/); if (img) info.thumbnail = decode(img[1]); }
      } catch {}
    }
    if (info.caption) info.caption = info.caption.replace(/\s+\n/g, '\n').slice(0, 1500);
  }
  // 上傳日期一律用「傳進 APP 的那天」（台灣時間），不用影片原本的發布日
  info.uploadDate = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  return info;
}

/** 組出 Notion 頁面內容 */
export function buildPage(env, v, info, kind) {
  const title = info.title || { IG: 'Instagram 影片', Threads: 'Threads 貼文', YouTube: 'YouTube 影片' }[v.platform];
  const props = {
    Name: { title: [{ type: 'text', text: { content: title.slice(0, 200) } }] },
    相關連結: { url: v.url },
    課堂筆記通路: { select: { name: CHANNEL[v.platform] } },
    觀看性質: { select: { name: '想看' } },
    知識庫性質: { select: { name: KINDS.includes(kind) ? kind : '課堂筆記' } },
  };
  // 頻道名稱：和現有選項一樣就直接選到，沒有的話 Notion 會自動新增（逗號不能出現在選項名稱）
  if (info.author) props.作者 = { multi_select: [{ name: info.author.replace(/,/g, ' ').slice(0, 100) }] };
  if (info.uploadDate) props.上傳日期 = { date: { start: info.uploadDate } };

  const children = v.platform === 'YouTube'
    ? [{ object: 'block', type: 'video', video: { type: 'external', external: { url: v.url } } }]
    : [
        { object: 'block', type: 'embed', embed: { url: v.url } },
        { object: 'block', type: 'bookmark', bookmark: { url: v.url } },
      ];
  // 內文只拿來讓 AI 取標題，不存進 Notion 頁面
  const page = { parent: { type: 'data_source_id', data_source_id: env.KNOWLEDGE_DS }, properties: props, children };
  if (info.thumbnail && /^https:\/\//.test(info.thumbnail)) page.cover = { type: 'external', external: { url: info.thumbnail } };
  return page;
}

