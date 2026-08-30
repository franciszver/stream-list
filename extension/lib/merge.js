// Shared title-normalization + merge logic for Stream List.
// Single source of truth: inlined into index.html by tools/build.py
// (replacing __SHARED_MERGE__ in index.template.html) and loaded
// directly by the Chrome extension popup.
'use strict';
const SLMerge = (() => {
  // Normalize a title for cross-service matching: drop "(1999)" years,
  // edition suffixes, punctuation, and trailing articles.
  function norm(t){
    return t.toLowerCase()
      .replace(/\s*\((\d{4})\)\s*/g, ' ')
      .replace(/\b(unrated|extended( (edition|cut|version))?|theatrical( (edition|cut|version))?|director'?s cut|deluxe edition|ultimate edition|special edition|final cut|with bonus content|uncut( version)?)\b/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim()
      .replace(/\s+(the|a|an)$/, '')
      .replace(/\s+/g, ' ');
  }
  // Dedup key: normalized title, with TV kept separate from movies.
  function keyOf(title, tv){ return norm(title) + (tv ? ':tv' : ''); }
  function parseYear(title){
    const m = title.match(/\((\d{4})\)/);
    return m ? +m[1] : null;
  }
  // Build a fresh library entry from a harvested/bookmarklet item.
  function makeEntry(it, service){
    const tv = !!it.tv;
    const key = keyOf(it.title, tv);
    const e = {
      id: key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      title: it.title.replace(/\s*\(\d{4}\)\s*/, '').trim(),
      type: tv ? 'tv' : 'movie',
      year: parseYear(it.title),
      services: {[service]: [{url: it.url}]},
      serviceCount: 1,
    };
    if (it.img) e.poster = it.img; // artwork straight off the store's tile
    if (it.store) e.storeHint = true; // store shows a buy suggestion (partial ownership)
    return e;
  }
  // Artwork the store itself can give us, used when the poster lookups
  // (iTunes/Wikipedia) come up empty. Fandango's CDN serves a poster for
  // any content id — and the id is already in the URL we stored, so this
  // works for titles harvested before artwork capture existed.
  // Only -49 (thumb) and -194 exist; anything else 404s.
  function storePoster(entry){
    if (entry.poster) return entry.poster;
    const links = (entry.services || {}).fandango || [];
    for (const l of links){
      const m = (l.url || '').match(/\/details\/[^/]+\/(\d+)/);
      if (m) return 'https://images2.vudu.com/poster2/' + m[1] + '-194';
    }
    return '';
  }
  // Merge one payload {service, items:[{title,url,tv}]} into byNorm
  // (keyOf -> entry). New titles become entries; known titles gain a
  // service link. Returns {added:[entry], linked:[entry]}.
  function mergeInto(byNorm, payload){
    const added = [], linked = [];
    for (const it of payload.items || []){
      if (!it || !it.title || !it.url) continue;
      const key = keyOf(it.title, !!it.tv);
      const ex = byNorm[key];
      if (ex){
        // Artwork can arrive on a re-sync of a title we already know, so
        // take it here too — otherwise store artwork only ever reaches
        // titles that entered the library after capture existed.
        if (it.img && !ex.poster) ex.poster = it.img;
        // Store-suggestion hint self-heals in both directions: buying the
        // remaining episodes clears it on the next sync (only collectors
        // that actually looked send a boolean; others leave it alone).
        if (typeof it.store === 'boolean'){
          if (it.store) ex.storeHint = true; else delete ex.storeHint;
        }
        if (!ex.services[payload.service]){
          ex.services[payload.service] = [{url: it.url}];
          ex.serviceCount = Object.keys(ex.services).length;
          linked.push(ex);
        }
      } else {
        const ne = makeEntry(it, payload.service);
        byNorm[key] = ne;
        added.push(ne);
      }
    }
    return {added, linked};
  }
  // Build a whole library from several payloads (extension "Sync all").
  function buildLibrary(payloads){
    const byNorm = {}, items = [];
    for (const p of payloads) items.push(...mergeInto(byNorm, p).added);
    items.sort((a, b) => a.title.localeCompare(b.title));
    return items;
  }
  // Merge an items-array (already in library entry shape: {id, title, type,
  // year, services, serviceCount}) into another. Matches by id first, then
  // by keyOf(title, type==='tv'). Unions service links (by url) on match,
  // recomputes serviceCount. Does not mutate its inputs.
  // Returns {items, added, linked} (added/linked are counts).
  function mergeLibraries(current, incoming){
    const items = (current || []).map(e => ({...e, services: {...e.services}}));
    const byId = {}, byKey = {};
    for (const e of items){ if (e.id) byId[e.id] = e; byKey[keyOf(e.title, e.type === 'tv')] = e; }
    let added = 0, linked = 0;
    for (const inc of incoming || []){
      if (!inc || !inc.title) continue;
      // Match by id only when present, else by normalized title — an id-less
      // (or duplicate-undefined-id) incoming item must not collide on byId.
      const ex = (inc.id && byId[inc.id]) || byKey[keyOf(inc.title, inc.type === 'tv')];
      if (ex){
        let didLink = false;
        for (const [svc, links] of Object.entries(inc.services || {})){
          const existing = ex.services[svc] || (ex.services[svc] = []);
          for (const l of links){
            if (!existing.some(x => x.url === l.url)){ existing.push({...l}); didLink = true; }
          }
        }
        ex.serviceCount = Object.keys(ex.services).length;
        if (didLink) linked++;
      } else {
        const ne = {...inc, services: {}};
        for (const [svc, links] of Object.entries(inc.services || {})) ne.services[svc] = links.map(l => ({...l}));
        ne.serviceCount = Object.keys(ne.services).length;
        if (!ne.id) ne.id = keyOf(ne.title, ne.type === 'tv').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
        items.push(ne);
        byId[ne.id] = ne; byKey[keyOf(ne.title, ne.type === 'tv')] = ne;
        added++;
      }
    }
    return {items, added, linked};
  }

  // Generate a standalone, self-contained single-file HTML document
  // for mobile/offline searching of the full library.
  function buildExportHtml(opts){
    opts = opts || {};
    const generated = opts.generated || new Date().toISOString().slice(0, 10);
    const library = Array.isArray(opts.library) ? opts.library : [];
    const flags = (opts.flags && typeof opts.flags === 'object') ? opts.flags : {};
    const posters = (opts.posters && typeof opts.posters === 'object') ? opts.posters : {};
    const meta = (opts.meta && typeof opts.meta === 'object') ? opts.meta : {};

    function escapeHtml(s){
      return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    const payload = {generated, items: library, flags, posters, meta};
    const jsonStr = JSON.stringify(payload).replace(/<\//g, '<\\/');

    return '<!DOCTYPE html>\n' +
'<html lang="en">\n' +
'<head>\n' +
'<meta charset="UTF-8">\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
'<title>Stream List — My Movie &amp; TV Library</title>\n' +
'<style>\n' +
':root{\n' +
'  color-scheme: light dark;\n' +
'  --bg:#f6f5f2; --surface:#ffffff; --surface2:#efede8; --ink:#1a1a19; --ink2:#5c5b54; --ink3:#8a897f;\n' +
'  --line:#e2e0d8; --accent:#2a78d6;\n' +
'  --google:#2a78d6; --amazon:#eb6834; --fandango:#1baf7a;\n' +
'  --good:#008300; --shadow:0 1px 3px rgba(0,0,0,.08),0 4px 14px rgba(0,0,0,.06);\n' +
'}\n' +
'@media (prefers-color-scheme: dark){\n' +
'  :root{\n' +
'    --bg:#121211; --surface:#1a1a19; --surface2:#242422; --ink:#ffffff; --ink2:#c3c2b7; --ink3:#8a897f;\n' +
'    --line:#33322f; --accent:#3987e5;\n' +
'    --google:#3987e5; --amazon:#d95926; --fandango:#199e70;\n' +
'    --shadow:0 1px 3px rgba(0,0,0,.4),0 4px 14px rgba(0,0,0,.3);\n' +
'  }\n' +
'}\n' +
'*{box-sizing:border-box;margin:0;padding:0}\n' +
'body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--ink);line-height:1.45}\n' +
'header{position:sticky;top:0;z-index:20;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 20px}\n' +
'.hrow{display:flex;align-items:center;gap:14px;max-width:1280px;margin:0 auto;flex-wrap:wrap}\n' +
'h1{font-size:19px;font-weight:700;white-space:nowrap}\n' +
'h1 .sub{color:var(--ink3);font-weight:400;font-size:13px;margin-left:6px}\n' +
'#search{flex:1;min-width:200px;padding:9px 14px;border:1px solid var(--line);border-radius:9px;background:var(--surface);color:var(--ink);font-size:15px;outline:none}\n' +
'#search:focus{border-color:var(--accent)}\n' +
'.controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}\n' +
'select,button.ctl{padding:8px 10px;border:1px solid var(--line);border-radius:9px;background:var(--surface);color:var(--ink);font-size:13px;cursor:pointer}\n' +
'button.ctl.active{border-color:var(--accent);color:var(--accent)}\n' +
'main{max-width:1280px;margin:0 auto;padding:16px 20px 60px}\n' +
'.chips{display:flex;gap:8px;flex-wrap:wrap;margin:2px 0 14px}\n' +
'.chip{padding:5px 12px;border-radius:99px;border:1px solid var(--line);background:var(--surface);font-size:12.5px;cursor:pointer;color:var(--ink2);user-select:none}\n' +
'.chip.active{background:var(--ink);color:var(--bg);border-color:var(--ink)}\n' +
'.chip .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}\n' +
'#stats{display:none;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:18px}\n' +
'#stats.open{display:grid}\n' +
'.tile{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px 16px}\n' +
'.tile .n{font-size:26px;font-weight:700;letter-spacing:-.5px}\n' +
'.tile .l{font-size:12px;color:var(--ink2);margin-top:2px}\n' +
'.tile .bar{height:6px;border-radius:4px;background:var(--surface2);margin-top:10px;overflow:hidden;display:flex;gap:2px}\n' +
'.tile .bar i{display:block;height:100%;border-radius:4px}\n' +
'#count{color:var(--ink3);font-size:13px;margin:0 0 10px}\n' +
'#grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px}\n' +
'.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden;box-shadow:var(--shadow);display:flex;flex-direction:column;position:relative;transition:transform .12s}\n' +
'.card:hover{transform:translateY(-2px)}\n' +
'.poster{aspect-ratio:2/3;background:var(--surface2);position:relative;cursor:pointer;display:flex;align-items:center;justify-content:center;overflow:hidden}\n' +
'.poster img{width:100%;height:100%;object-fit:cover;display:none;position:absolute;inset:0}\n' +
'.poster img[src]{display:block}\n' +
'.poster .ph{color:var(--ink3);font-size:12px;text-align:center;padding:12px;font-weight:600}\n' +
'.cbody{padding:9px 10px 10px;display:flex;flex-direction:column;gap:6px;flex:1}\n' +
'.ct{font-size:13.5px;font-weight:600;line-height:1.25}\n' +
'.cy{color:var(--ink3);font-size:11.5px}\n' +
'.svcs{display:flex;gap:5px;flex-wrap:wrap;margin-top:auto}\n' +
'.svc{width:22px;height:22px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:10.5px;font-weight:700;text-decoration:none;cursor:pointer}\n' +
'.svc.google{background:var(--google)}.svc.amazon{background:var(--amazon)}.svc.fandango{background:var(--fandango)}\n' +
'.flags{position:absolute;top:6px;left:6px;right:6px;display:flex;justify-content:space-between;pointer-events:none}\n' +
'.flag{pointer-events:auto;background:rgba(0,0,0,.55);color:#fff;border:none;border-radius:7px;font-size:12px;padding:3px 7px;cursor:pointer;backdrop-filter:blur(4px)}\n' +
'.flag.on{background:var(--good)}\n' +
'.flag.q.on{background:var(--accent)}\n' +
'.tvtag{position:absolute;bottom:6px;left:6px;background:rgba(0,0,0,.55);color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:6px;letter-spacing:.5px;backdrop-filter:blur(4px)}\n' +
'.storetag{position:absolute;bottom:6px;right:6px;background:rgba(0,0,0,.55);font-size:11px;padding:2px 5px;border-radius:6px;backdrop-filter:blur(4px);cursor:help}\n' +
'#grid.list{display:flex;flex-direction:column;gap:6px}\n' +
'#grid.list .card{flex-direction:row;align-items:center;padding:8px 12px;gap:12px}\n' +
'#grid.list .poster{width:38px;min-width:38px;aspect-ratio:2/3;border-radius:6px}\n' +
'#grid.list .poster .ph{display:none}\n' +
'#grid.list .cbody{flex-direction:row;align-items:center;gap:14px;padding:0;flex:1}\n' +
'#grid.list .ct{flex:1}\n' +
'#grid.list .flags,#grid.list .tvtag,#grid.list .storetag,#grid.list .cy{display:none}\n' +
'#grid.list .listmeta{display:flex;gap:10px;align-items:center}\n' +
'.listmeta{display:none}\n' +
'#grid.list .listmeta{display:flex}\n' +
'.lm{font-size:11px;color:var(--ink3);min-width:34px}\n' +
'dialog{border:none;border-radius:16px;padding:0;max-width:640px;width:92vw;background:var(--surface);color:var(--ink);box-shadow:var(--shadow)}\n' +
'dialog::backdrop{background:rgba(0,0,0,.45)}\n' +
'.dhead{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--line)}\n' +
'.dhead h2{font-size:16px}\n' +
'.dbody{padding:16px 20px 22px;max-height:70vh;overflow:auto;font-size:14px}\n' +
'.dbody p{color:var(--ink2);font-size:13px;margin:6px 0}\n' +
'.rowbtns{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}\n' +
'.x{background:none;border:none;font-size:20px;color:var(--ink3);cursor:pointer}\n' +
'.dgrid{display:flex;gap:18px}\n' +
'.dgrid .poster{width:150px;min-width:150px;border-radius:10px}\n' +
'.watchbtn{display:flex;align-items:center;gap:8px;padding:9px 13px;border-radius:10px;color:#fff;text-decoration:none;font-size:14px;font-weight:600;margin:5px 0}\n' +
'.watchbtn small{font-weight:400;opacity:.85}\n' +
'.empty{color:var(--ink3);text-align:center;padding:60px 0;font-size:15px}\n' +
'footer{max-width:1280px;margin:0 auto;padding:14px 20px;color:var(--ink3);font-size:12px;border-top:1px solid var(--line)}\n' +
'@media(max-width:640px){ #grid{grid-template-columns:repeat(auto-fill,minmax(110px,1fr))} .dgrid{flex-direction:column} }\n' +
'</style>\n' +
'</head>\n' +
'<body>\n' +
'<header>\n' +
'  <div class="hrow">\n' +
'    <h1>\uD83C\uDFAC Stream List<span class="sub" id="genDate">updated ' + escapeHtml(generated) + '</span></h1>\n' +
'    <input id="search" type="search" placeholder="Search your library\u2026  ( / )" autocomplete="off">\n' +
'    <div class="controls">\n' +
'      <select id="sort">\n' +
'        <option value="title">Sort: Title</option>\n' +
'        <option value="year">Sort: Year</option>\n' +
'        <option value="services">Sort: # Services</option>\n' +
'        <option value="random">Sort: Shuffle</option>\n' +
'      </select>\n' +
'      <button class="ctl" id="viewToggle" title="Toggle grid/list">\u2630 List</button>\n' +
'      <button class="ctl" id="statsToggle">\uD83D\uDCCA Stats</button>\n' +
'    </div>\n' +
'  </div>\n' +
'</header>\n' +
'<main>\n' +
'  <div id="stats"></div>\n' +
'  <div class="chips" id="chips"></div>\n' +
'  <p id="count"></p>\n' +
'  <div id="grid"></div>\n' +
'  <div class="empty" id="empty" style="display:none">Nothing matches \u2014 you don\'t own that one yet \uD83C\uDF7F</div>\n' +
'</main>\n' +
'<footer>\n' +
'  Stream List \u2014 Standalone Searchable Library. Watched/queue flags are saved locally in this browser.\n' +
'</footer>\n' +
'\n' +
'<dialog id="detail"></dialog>\n' +
'\n' +
'<' + 'script id="export-data" type="application/json">' + jsonStr + '<' + '/script>\n' +
'<' + 'script>\n' +
'\'use strict\';\n' +
'const DATA = JSON.parse(document.getElementById(\'export-data\').textContent);\n' +
'const SVC = {\n' +
'  google:   {name:\'Google Play\',   letter:\'G\', cls:\'google\',   color:\'var(--google)\'},\n' +
'  amazon:   {name:\'Prime Video\',   letter:\'P\', cls:\'amazon\',   color:\'var(--amazon)\'},\n' +
'  fandango: {name:\'Fandango at Home\', letter:\'F\', cls:\'fandango\', color:\'var(--fandango)\'},\n' +
'};\n' +
'const LS = {\n' +
'  get(k,d){ try{ return JSON.parse(localStorage.getItem(\'sl_exp_\'+k)) ?? d }catch(e){ return d } },\n' +
'  set(k,v){ try{ localStorage.setItem(\'sl_exp_\'+k, JSON.stringify(v)) }catch(e){} },\n' +
'};\n' +
'let flags = {...(DATA.flags||{}), ...LS.get(\'flags\',{})};\n' +
'let posters = DATA.posters || {};\n' +
'let meta = DATA.meta || {};\n' +
'let items = (DATA.items || []).map(e => ({...e, services:{...e.services}}));\n' +
'\n' +
'const state = { q:\'\', svc:null, type:null, flag:null, multi:false, store:false, sort:\'title\', view: LS.get(\'view\',\'grid\') };\n' +
'\n' +
'function esc(s){ return String(s??\'\').replace(/[&<>"\']/g, c => ({\'&\':\'&amp;\',\'<\':\'&lt;\',\'>\':\'&gt;\',\'"\':\'&quot;\',"\'":\'&#39;\'}[c])); }\n' +
'function safeUrl(u){ try{ const p = new URL(u, location.href); return (p.protocol===\'http:\'||p.protocol===\'https:\') ? p.href : \'#\'; }catch(e){ return \'#\'; } }\n' +
'function normq(s){ return s.toLowerCase().replace(/[^a-z0-9 ]+/g,\'\'); }\n' +
'\n' +
'const chipsEl = document.getElementById(\'chips\');\n' +
'function chips(){\n' +
'  const c = [];\n' +
'  c.push({k:\'type\', v:null, label:\'All\'});\n' +
'  c.push({k:\'type\', v:\'movie\', label:\'Movies\'});\n' +
'  c.push({k:\'type\', v:\'tv\', label:\'TV\'});\n' +
'  for (const [s,d] of Object.entries(SVC)) c.push({k:\'svc\', v:s, label:d.name, dot:d.color});\n' +
'  c.push({k:\'multi\', v:true, label:\'Owned 2+ places\'});\n' +
'  if (items.some(e => e.storeHint)) c.push({k:\'store\', v:true, label:\'\uD83D\uDECD Partial / buy suggested\'});\n' +
'  else state.store = false;\n' +
'  c.push({k:\'flag\', v:\'q\', label:\'Watch next\'});\n' +
'  c.push({k:\'flag\', v:\'w\', label:\'Watched\'});\n' +
'  c.push({k:\'flag\', v:\'uw\', label:\'Unwatched\'});\n' +
'  chipsEl.innerHTML = \'\';\n' +
'  for (const ch of c){\n' +
'    const b = document.createElement(\'span\');\n' +
'    b.className = \'chip\';\n' +
'    const toggle = ch.k===\'multi\' || ch.k===\'store\';\n' +
'    const active = toggle ? state[ch.k]===true && ch.v===true\n' +
'      : state[ch.k]===ch.v && !(ch.k===\'type\'&&ch.v===null&&(state.type!==null));\n' +
'    if (ch.k===\'type\'&&ch.v===null) { if(state.type===null&&!state.svc&&!state.flag&&!state.multi&&!state.store) b.classList.add(\'active\'); }\n' +
'    else if (active) b.classList.add(\'active\');\n' +
'    b.innerHTML = (ch.dot?`<span class="dot" style="background:${ch.dot}"></span>`:\'\') + ch.label;\n' +
'    b.onclick = () => {\n' +
'      if (ch.k===\'type\'&&ch.v===null){ state.type=null; state.svc=null; state.flag=null; state.multi=false; state.store=false; }\n' +
'      else if (toggle) state[ch.k] = !state[ch.k];\n' +
'      else state[ch.k] = state[ch.k]===ch.v ? null : ch.v;\n' +
'      render();\n' +
'    };\n' +
'    chipsEl.appendChild(b);\n' +
'  }\n' +
'}\n' +
'\n' +
'function visible(){\n' +
'  let out = items.filter(e => {\n' +
'    if (state.q && !normq(e.title).includes(normq(state.q))) return false;\n' +
'    if (state.svc && !e.services[state.svc]) return false;\n' +
'    if (state.type && e.type!==state.type) return false;\n' +
'    if (state.multi && e.serviceCount<2) return false;\n' +
'    if (state.store && !e.storeHint) return false;\n' +
'    const f = flags[e.id]||{};\n' +
'    if (state.flag===\'w\' && !f.w) return false;\n' +
'    if (state.flag===\'uw\' && f.w) return false;\n' +
'    if (state.flag===\'q\' && !f.q) return false;\n' +
'    return true;\n' +
'  });\n' +
'  const y = e => meta[e.id]?.year || e.year || 0;\n' +
'  if (state.sort===\'title\') out.sort((a,b)=>a.title.localeCompare(b.title));\n' +
'  if (state.sort===\'year\') out.sort((a,b)=> y(b)-y(a) || a.title.localeCompare(b.title));\n' +
'  if (state.sort===\'services\') out.sort((a,b)=> b.serviceCount-a.serviceCount || a.title.localeCompare(b.title));\n' +
'  if (state.sort===\'random\') { for(let i=out.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[out[i],out[j]]=[out[j],out[i]];} }\n' +
'  return out;\n' +
'}\n' +
'\n' +
'function stats(){\n' +
'  const el = document.getElementById(\'stats\');\n' +
'  const per = {};\n' +
'  for (const s in SVC) per[s] = 0;\n' +
'  let movies=0, tv=0, multi=0, watched=0;\n' +
'  for (const e of items){\n' +
'    for (const s in e.services) if (s in SVC) per[s] = (per[s]||0)+1;\n' +
'    if (e.type===\'movie\') movies++; else tv++;\n' +
'    if (e.serviceCount>1) multi++;\n' +
'    if ((flags[e.id]||{}).w) watched++;\n' +
'  }\n' +
'  const total = items.length;\n' +
'  const perTotal = Object.values(per).reduce((a,b)=>a+b,0) || 1;\n' +
'  const bar = Object.entries(per).map(([s,n]) =>\n' +
'    `<i style="width:${(n/perTotal*100).toFixed(1)}%;background:${SVC[s].color}" title="${esc(SVC[s].name)}: ${n}"></i>`).join(\'\');\n' +
'  const svcTiles = Object.entries(per).map(([s,n]) =>\n' +
'    `<div class="tile"><div class="n">${n}</div><div class="l"><span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${SVC[s].color}"></span> ${esc(SVC[s].name)}</div></div>`).join(\'\');\n' +
'  el.innerHTML = `\n' +
'    <div class="tile"><div class="n">${total}</div><div class="l">titles owned</div>\n' +
'      <div class="bar">${bar}</div></div>\n' +
'    <div class="tile"><div class="n">${movies} <span style="font-size:14px;color:var(--ink3)">/ ${tv}</span></div><div class="l">movies / TV</div></div>\n' +
'    <div class="tile"><div class="n">${multi}</div><div class="l">owned on 2+ services</div></div>\n' +
'    ${svcTiles}\n' +
'    <div class="tile"><div class="n">${watched}</div><div class="l">marked watched</div></div>`;\n' +
'}\n' +
'\n' +
'function svcLinks(e, big){\n' +
'  return Object.entries(e.services).map(([s, links]) => {\n' +
'    const d = SVC[s];\n' +
'    if (!d) return \'\';\n' +
'    return links.map(l => big\n' +
'      ? `<a class="watchbtn" style="background:${d.color}" href="${safeUrl(l.url)}" target="_blank" rel="noopener">\u25B6 Watch on ${d.name}${l.note?` <small>(${esc(l.note)})</small>`:\'\'}</a>`\n' +
'      : `<a class="svc ${d.cls}" href="${safeUrl(l.url)}" target="_blank" rel="noopener" title="${esc(d.name)}${l.note?\' \u2014 \'+esc(l.note):\'\'}">${d.letter}</a>`\n' +
'    ).join(\'\');\n' +
'  }).join(\'\');\n' +
'}\n' +
'\n' +
storePoster.toString() + '\n' +
'\n' +
'const grid = document.getElementById(\'grid\');\n' +
'function render(){\n' +
'  chips(); stats();\n' +
'  const list = visible();\n' +
'  document.getElementById(\'count\').textContent = `${list.length} of ${items.length} titles`;\n' +
'  document.getElementById(\'empty\').style.display = list.length ? \'none\':\'block\';\n' +
'  grid.className = state.view===\'list\' ? \'list\' : \'\';\n' +
'  document.getElementById(\'viewToggle\').textContent = state.view===\'list\' ? \'\u25A6 Grid\' : \'\u2630 List\';\n' +
'  grid.innerHTML = \'\';\n' +
'  const frag = document.createDocumentFragment();\n' +
'  for (const e of list){\n' +
'    const f = flags[e.id]||{};\n' +
'    const y = meta[e.id]?.year || e.year;\n' +
'    const card = document.createElement(\'div\');\n' +
'    card.className = \'card\'; card.dataset.id = e.id;\n' +
'    card.innerHTML = `\n' +
'      <div class="poster"><img alt="" loading="lazy"><div class="ph">${esc(e.title)}</div>\n' +
'        <div class="flags">\n' +
'          <button class="flag q ${f.q?\'on\':\'\'}" title="Watch next">\uFF0B</button>\n' +
'          <button class="flag w ${f.w?\'on\':\'\'}" title="Watched">\u2713</button>\n' +
'        </div>\n' +
'        ${e.type===\'tv\'?\'<span class="tvtag">TV</span>\':\'\'}\n' +
'        ${e.storeHint?\'<span class="storetag" title="The store shows a purchase suggestion here \u2014 you may not own every episode or season.">\uD83D\uDECD</span>\':\'\'}\n' +
'      </div>\n' +
'      <div class="cbody">\n' +
'        <div class="ct">${esc(e.title)}</div>\n' +
'        <div class="cy">${esc(y||\'\')}${meta[e.id]?.genre?` \u00B7 ${esc(meta[e.id].genre)}`:\'\'}</div>\n' +
'        <div class="listmeta"><span class="lm">${y||\'\'}</span><span class="lm">${e.type===\'tv\'?\'TV\':\'Movie\'}</span></div>\n' +
'        <div class="svcs">${svcLinks(e)}</div>\n' +
'      </div>`;\n' +
'    const pUrl = posters[e.id] || storePoster(e);\n' +
'    const img = card.querySelector(\'img\');\n' +
'    if (pUrl) img.src = safeUrl(pUrl);\n' +
'    img.addEventListener(\'error\', () => { img.remove(); });\n' +
'    card.querySelector(\'.poster\').addEventListener(\'click\', ev => { if (ev.target.closest(\'.flag\')) return; detail(e); });\n' +
'    card.querySelector(\'.flag.w\').onclick = () => { f.w = f.w?0:1; flags[e.id]=f; LS.set(\'flags\',flags); render(); };\n' +
'    card.querySelector(\'.flag.q\').onclick = () => { f.q = f.q?0:1; flags[e.id]=f; LS.set(\'flags\',flags); render(); };\n' +
'    frag.appendChild(card);\n' +
'  }\n' +
'  grid.appendChild(frag);\n' +
'}\n' +
'\n' +
'const dlg = document.getElementById(\'detail\');\n' +
'function detail(e){\n' +
'  const f = flags[e.id]||{};\n' +
'  const y = meta[e.id]?.year || e.year;\n' +
'  const pUrl = posters[e.id] || storePoster(e);\n' +
'  dlg.innerHTML = `\n' +
'    <div class="dhead"><h2>${esc(e.title)}${y?` <span style="color:var(--ink3);font-weight:400">(${esc(y)})</span>`:\'\'}</h2>\n' +
'      <button class="x">\u2715</button></div>\n' +
'    <div class="dbody"><div class="dgrid">\n' +
'      <div class="poster">${pUrl?`<img src="${safeUrl(pUrl)}" alt="">`:`<div class="ph">${esc(e.title)}</div>`}</div>\n' +
'      <div style="flex:1">\n' +
'        <p>${e.type===\'tv\'?\'TV series\':\'Movie\'}${meta[e.id]?.genre?` \u00B7 ${esc(meta[e.id].genre)}`:\'\'} \u00B7 owned on ${e.serviceCount} service${e.serviceCount>1?\'s\':\'\'}</p>\n' +
'        ${e.storeHint?\'<p>\uD83D\uDECD The store shows a purchase suggestion \u2014 you may not own every episode or season of this.</p>\':\'\'}\n' +
'        ${svcLinks(e, true)}\n' +
'        <div class="rowbtns">\n' +
'          <button class="ctl" id="dW">${f.w?\'\u2713 Watched\':\'Mark watched\'}</button>\n' +
'          <button class="ctl" id="dQ">${f.q?\'\u2605 In watch-next\':\'Add to watch next\'}</button>\n' +
'        </div>\n' +
'      </div>\n' +
'    </div></div>`;\n' +
'  dlg.querySelector(\'.x\').onclick = () => dlg.close();\n' +
'  dlg.querySelector(\'#dW\').onclick = ()=>{ f.w=f.w?0:1; flags[e.id]=f; LS.set(\'flags\',flags); dlg.close(); render(); };\n' +
'  dlg.querySelector(\'#dQ\').onclick = ()=>{ f.q=f.q?0:1; flags[e.id]=f; LS.set(\'flags\',flags); dlg.close(); render(); };\n' +
'  dlg.showModal();\n' +
'}\n' +
'\n' +
'document.getElementById(\'search\').addEventListener(\'input\', ev => { state.q = ev.target.value; render(); });\n' +
'document.getElementById(\'sort\').addEventListener(\'change\', ev => { state.sort = ev.target.value; render(); });\n' +
'document.getElementById(\'viewToggle\').onclick = () => { state.view = state.view===\'list\'?\'grid\':\'list\'; LS.set(\'view\', state.view); render(); };\n' +
'document.getElementById(\'statsToggle\').onclick = () => document.getElementById(\'stats\').classList.toggle(\'open\');\n' +
'document.addEventListener(\'keydown\', ev => {\n' +
'  if (ev.key===\'/\' && document.activeElement!==document.getElementById(\'search\')){ ev.preventDefault(); document.getElementById(\'search\').focus(); }\n' +
'  if (ev.key===\'Escape\'){ document.getElementById(\'search\').value=\'\'; state.q=\'\'; render(); }\n' +
'});\n' +
'render();\n' +
'<' + '/script>\n' +
'</body>\n' +
'</html>';
  }

  return {norm, keyOf, parseYear, makeEntry, storePoster, mergeInto, buildLibrary, mergeLibraries, buildExportHtml};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = SLMerge;
