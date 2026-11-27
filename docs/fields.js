// 欄位選擇器：依 Notion 資料庫的設定，自動產生下拉選單、標籤、日期、關聯搜尋。
// 用法：const panel = FieldPanel('knowledge', 容器);  await panel.ready;  panel.set('作者', ['某人']);  panel.collect()
window.FieldPanel = function FieldPanel(db, box, baseDefaults = {}) {
  let defaults = { ...baseDefaults };
  const values = {};
  const setters = {};
  const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, attrs); e.append(...kids); return e; };

  function chips(name, wrap, getLabel = (v) => v) {
    wrap.innerHTML = '';
    for (const v of values[name]) {
      const c = el('button', { type: 'button', className: 'chip', textContent: getLabel(v) + ' ✕' });
      c.onclick = () => { values[name] = values[name].filter((x) => x !== v); chips(name, wrap, getLabel); };
      wrap.append(c);
    }
  }

  function build(f) {
    const label = el('label', {}, f.name);
    if (f.type === 'select') {
      const s = el('select');
      s.add(new Option('（不填）', ''));
      f.options.forEach((o) => s.add(new Option(o, o)));
      s.onchange = () => { values[f.name] = s.value; };
      setters[f.name] = (v) => { if (v && ![...s.options].some((o) => o.value === v)) s.add(new Option(v, v)); s.value = v || ''; values[f.name] = s.value; };
      label.append(s);
    } else if (f.type === 'date' || f.type === 'url') {
      const i = el('input', { type: f.type });
      i.oninput = () => { values[f.name] = i.value; };
      setters[f.name] = (v) => { i.value = v || ''; values[f.name] = i.value; };
      label.append(i);
    } else if (f.type === 'multi_select') {
      values[f.name] = [];
      const listId = 'dl-' + db + '-' + f.name.replace(/\W/g, '') + Math.random().toString(36).slice(2, 6);
      const dl = el('datalist', { id: listId });
      f.options.forEach((o) => dl.append(el('option', { value: o })));
      const i = el('input', { placeholder: '輸入搜尋後按加入' });
      i.setAttribute('list', listId);
      const wrap = el('div', { className: 'chips' });
      const add = () => { const v = i.value.trim(); if (v && !values[f.name].includes(v)) { values[f.name].push(v); chips(f.name, wrap); } i.value = ''; };
      i.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
      i.onchange = () => { if (f.options.includes(i.value.trim())) add(); };
      const btn = el('button', { type: 'button', className: 'ghost small-btn', textContent: '加入', onclick: add });
      setters[f.name] = (v) => { values[f.name] = (v || []).slice(); chips(f.name, wrap); };
      label.append(wrap, el('div', { className: 'inline' }, i, btn), dl);
    } else if (f.type === 'relation') {
      values[f.name] = [];
      const titles = {};
      const wrap = el('div', { className: 'chips' });
      const i = el('input', { placeholder: '輸入名稱搜尋（留空顯示最近的）' });
      const results = el('div', { className: 'results' });
      let timer;
      const search = () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          results.textContent = '搜尋中…';
          try {
            const { pages } = await api('/api/relation-search', { db: f.db, q: i.value });
            results.innerHTML = '';
            if (!pages.length) results.textContent = '找不到';
            for (const p of pages) {
              results.append(el('button', { type: 'button', className: 'result', textContent: p.title, onclick: () => {
                titles[p.id] = p.title;
                if (!values[f.name].includes(p.id)) values[f.name].push(p.id);
                chips(f.name, wrap, (id) => titles[id] || id); results.innerHTML = ''; i.value = '';
              } }));
            }
          } catch (e) { results.textContent = e.message; }
        }, 350);
      };
      i.oninput = search; i.onfocus = search;
      // 可以給 [{id, title}]（例如範本預設的關聯）
      setters[f.name] = (v) => {
        values[f.name] = [];
        for (const x of v || []) { if (x && x.id) { titles[x.id] = x.title; values[f.name].push(x.id); } }
        chips(f.name, wrap, (id) => titles[id] || id);
      };
      label.append(wrap, i, results);
    } else return null;
    return label;
  }

  const ready = (async () => {
    box.textContent = '讀取欄位中…';
    try {
      const { fields } = await api('/api/fields?db=' + db);
      box.innerHTML = '';
      for (const f of fields) { const n = build(f); if (n) box.append(n); }
      for (const [k, v] of Object.entries(defaults)) setters[k]?.(v);
    } catch (e) { box.textContent = '欄位讀取失敗：' + e.message; }
  })();

  return {
    ready,
    set(name, v) { setters[name]?.(v); },
    // 套用範本的預設值（範本有填的蓋過 APP 預設），然後重設畫面
    async useTemplate(tplValues) { await ready; defaults = tplValues ? { ...tplValues } : { ...baseDefaults }; this.reset(); },
    reset() { for (const k of Object.keys(setters)) setters[k](defaults[k]); },
    collect() { const out = {}; for (const [k, v] of Object.entries(values)) if (Array.isArray(v) ? v.length : v) out[k] = v; return out; },
  };
};
