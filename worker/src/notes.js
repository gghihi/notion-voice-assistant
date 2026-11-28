// 讀出／更新「已經存進 Notion 的筆記」，讓 APP 可以修改
import { listChildren, itemBlocks, paragraphs, insertAfter, sectionAnchor, sectionEnd, deleteBlock, appendBlocks } from './notion.js';

const plain = (rt) => (rt || []).map((t) => t.plain_text || t.text?.content || '').join('');
// 段落名稱 → 範本按鈕種類（大綱→重點；回顧／問題→一般問題）
export const presetOf = (sec) => (!sec.hasButton ? null : /大綱/.test(sec.text) ? 'point' : /回顧|問題/.test(sec.text) ? 'qa' : null);

/** 這一段（一般標題）底下的區塊範圍（不含標題本身、到下一個同級以上標題為止） */
export function sectionRange(blocks, headingId) {
  const i = blocks.findIndex((b) => b.id === headingId);
  if (i < 0) return [];
  const level = Number((blocks[i].type.match(/heading_(\d)/) || [])[1] || 9);
  const out = [];
  for (let j = i + 1; j < blocks.length; j++) {
    const m = blocks[j].type.match(/^heading_(\d)$/);
    if (m && Number(m[1]) <= level) break;
    out.push(blocks[j]);
  }
  return out;
}

const TEXT_TYPES = ['paragraph', 'bulleted_list_item', 'numbered_list_item'];
/** 讀一個區塊的子內容 → { text, code, lang, links, locked }（有 APP 不認得的內容就 locked，避免改壞） */
async function readKids(env, id) {
  const kids = await listChildren(env, id);
  const r = { text: [], ids: [], code: undefined, lang: 'xml', links: [], images: [], locked: false };
  for (const k of kids) {
    if (TEXT_TYPES.includes(k.type) && !k.has_children) { r.text.push(plain(k[k.type].rich_text)); r.ids.push(k.id); }
    else if (k.type === 'code' && r.code === undefined) { r.code = plain(k.code.rich_text); r.lang = k.code.language; }
    else if (k.type === 'bookmark' && k.bookmark?.url) r.links.push(k.bookmark.url);
    else if (k.type === 'image') { // 圖片：記下區塊編號，修改時後端會重新上傳一份
      const im = k.image; r.images.push({ blockId: k.id, preview: im?.file?.url || im?.external?.url || '', caption: plain(im?.caption) });
    }
    else r.locked = true;
  }
  return { ...r, text: r.text.join('\n') };
}

/** 讀出某一段已經寫好的筆記 */
export async function readSection(env, blocks, sec) {
  const range = sectionRange(blocks, sec.id);
  const preset = presetOf(sec);
  if (preset === 'point') {
    const items = [];
    for (const b of range.filter((x) => x.type === 'heading_2' && x.heading_2.is_toggleable)) {
      const kids = await listChildren(env, b.id);
      const subs = []; let locked = false;
      for (const k of kids) {
        if (k.type === 'heading_3' && k.heading_3.is_toggleable) {
          const r = k.has_children ? await readKids(env, k.id) : { text: '', links: [], locked: false };
          if (r.locked) locked = true;
          const sub = { title: plain(k.heading_3.rich_text), text: r.text, links: r.links, images: r.images };
          if (r.code !== undefined) { sub.code = r.code; sub.lang = r.lang; }
          subs.push(sub);
        } else if (k.type !== 'unsupported' && k.type !== 'button') locked = true; // 按鈕（副重點按鈕）可以忽略
      }
      items.push({ bid: b.id, kind: 'point', title: plain(b.heading_2.rich_text), subs, locked });
    }
    return { preset, items };
  }
  if (preset === 'qa') {
    const items = [];
    for (const b of range.filter((x) => x.type === 'toggle')) {
      const r = b.has_children ? await readKids(env, b.id) : { text: '', links: [], locked: false };
      items.push({ bid: b.id, kind: 'qa', q: plain(b.toggle.rich_text), a: r.text, links: r.links, images: r.images || [], locked: r.locked });
    }
    return { preset, items };
  }
  // 一般段落：收合標題讀裡面的文字；一般標題讀底下的文字段落
  if (sec.toggle) {
    const r = await readKids(env, sec.id);
    return { preset: null, text: r.text, paraIds: r.ids };
  }
  const paras = range.filter((x) => x.type === 'paragraph' && !x.has_children);
  return { preset: null, text: paras.map((p) => plain(p.paragraph.rich_text)).join('\n').replace(/^\n+|\n+$/g, ''), paraIds: paras.map((p) => p.id) };
}

/**
 * 修改已存在的筆記：
 * - deleted：刪掉的重點／問題（只接受這一段裡的區塊）
 * - 有 bid 且改過的：刪掉舊的、在原位置放新的
 * - 沒有 bid 的：新的，放在按鈕上方
 */
export async function saveSectionItems(env, pid, blocks, sec, list, deleted, reorder = false) {
  const allowed = new Set(sectionRange(blocks, sec.id).map((b) => b.id));
  for (const bid of deleted || []) if (allowed.has(bid)) await deleteBlock(env, bid);
  // 換了順序：把這一段 APP 管的項目全部照新順序重放（Notion 沒有「移動區塊」的功能）
  if (reorder && !list.some((it) => it.locked)) {
    for (const it of list) if (it.bid && allowed.has(it.bid)) await deleteBlock(env, it.bid);
    const nb = itemBlocks(list.map((it) => ({ ...it, bid: undefined })));
    if (nb.length) await insertAfter(env, pid, sectionAnchor(await listChildren(env, pid), sec.id), nb);
    return;
  }
  for (const it of list) {
    if (!it.bid || !it.dirty || !allowed.has(it.bid) || it.locked) continue;
    const idx = blocks.findIndex((b) => b.id === it.bid);
    const prev = blocks[idx - 1]?.id;
    const nb = itemBlocks([it]);
    await deleteBlock(env, it.bid);
    if (nb.length && prev) await insertAfter(env, pid, prev, nb);
  }
  const fresh = list.filter((it) => !it.bid);
  if (fresh.length) {
    const nb = itemBlocks(fresh);
    if (nb.length) {
      const now = await listChildren(env, pid); // 刪改過後重新讀一次位置
      await insertAfter(env, pid, sectionAnchor(now, sec.id), nb);
    }
  }
}

/** 一般段落改寫：刪掉原本的文字段落，在同一個位置放新的 */
export async function savePlain(env, pid, blocks, sec, text, oldIds) {
  if (sec.toggle) { // 收合標題：換掉裡面的文字段落
    const own = new Set((await listChildren(env, sec.id)).map((b) => b.id));
    for (const id of oldIds || []) if (own.has(id)) await deleteBlock(env, id);
    const kids = text.trim() ? paragraphs(text).slice(0, 100) : [];
    if (kids.length) await appendBlocks(env, sec.id, kids);
    return;
  }
  const allowed = new Set(sectionRange(blocks, sec.id).map((b) => b.id));
  const old = (oldIds || []).filter((id) => allowed.has(id));
  const firstIdx = old.length ? blocks.findIndex((b) => b.id === old[0]) : -1;
  const prev = firstIdx > 0 ? blocks[firstIdx - 1].id : null;
  for (const id of old) await deleteBlock(env, id);
  const kids = text.trim() ? paragraphs(text).slice(0, 100) : [];
  if (!kids.length) return;
  if (prev) await insertAfter(env, pid, prev, kids);
  else await insertAfter(env, pid, sectionEnd(await listChildren(env, pid), sec.id), kids);
}

/**
 * 修改含圖片的項目前：把「原本就在 Notion 的圖片」（只給 blockId）換成可以重新放進去的內容。
 * 只接受這一段裡項目底下的圖片（往上找兩層，要是這一段的重點或問題）。
 */
export async function resolveExistingImages(env, list, allowedIds, { getBlock, uploadImage }) {
  for (const it of list) {
    if (!it.bid || !(it.dirty || it.__reorder)) continue;
    const holders = [it, ...(it.subs || [])];
    for (const h of holders) {
      if (!Array.isArray(h.images)) continue;
      const out = [];
      for (const im of h.images) {
        if (!im?.blockId) { out.push(im); continue; }
        try {
          const b = await getBlock(env, im.blockId);
          if (b.type !== 'image') continue;
          let p = b.parent?.block_id, ok = allowedIds.has(p);
          if (!ok && p) { const pb = await getBlock(env, p); ok = allowedIds.has(pb.parent?.block_id); }
          if (!ok) continue; // 不是這一段的圖片，不處理
          if (b.image.type === 'external') { out.push({ external: b.image.external.url, caption: im.caption }); continue; }
          const res = await fetch(b.image.file.url);
          if (!res.ok) continue;
          const type = res.headers.get('Content-Type') || 'image/jpeg';
          const id = await uploadImage(env, new Uint8Array(await res.arrayBuffer()), type.split(';')[0], 'note-image.' + (type.includes('png') ? 'png' : 'jpg'));
          out.push({ uploadId: id, caption: im.caption });
        } catch (e) { console.log('image copy', e.message); }
      }
      h.images = out;
    }
  }
}
