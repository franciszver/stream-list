'use strict';
const DATA = JSON.parse(document.getElementById('library-data').textContent);
// True when this page ships inside the Chrome extension (app/app.html);
// gates the sync UI and the chrome.storage auto-merge bridge.
const IS_EXT = location.protocol === 'chrome-extension:';
const SVC = {
  google:   {name:'Google Play',   letter:'G', cls:'google',   color:'var(--google)'},
  amazon:   {name:'Prime Video',   letter:'P', cls:'amazon',   color:'var(--amazon)'},
  fandango: {name:'Fandango at Home', letter:'F', cls:'fandango', color:'var(--fandango)'},
};
const LS = {
  get(k,d){ try{ return JSON.parse(localStorage.getItem('sl_'+k)) ?? d }catch(e){ return d } },
  set(k,v){ try{ localStorage.setItem('sl_'+k, JSON.stringify(v)) }catch(e){} },
};
let flags = LS.get('flags', {});           // id -> {w:1 watched, q:1 queue}
let posters = LS.get('posters', {});       // id -> url ('' = looked up, not found)
// A failed lookup is cached as '' so we don't re-query every load — but
// that also means improving the lookup can never help a title that once
// failed. Stamp the cache with the lookup version and drop the misses
// (never the hits) whenever that version changes.
const POSTER_LOOKUP_VER = 2;
if (LS.get('posterVer', 0) !== POSTER_LOOKUP_VER){
  for (const id of Object.keys(posters)) if (!posters[id]) delete posters[id];
  LS.set('posters', posters); LS.set('posterVer', POSTER_LOOKUP_VER);
}
let meta = LS.get('meta', {});             // id -> {year, genre}

// localStorage IS the database: sl_library holds the full items array.
let library = LS.get('library', null);
let sample = LS.get('sample', false);
if (library === null){
  library = DATA.items.map(e => ({...e, services:{...e.services}}));
  sample = DATA.sample === true;
  const legacyExtra = LS.get('extra', null);
  if (legacyExtra && legacyExtra.length){
    library = SLMerge.mergeLibraries(library, legacyExtra).items;
  }
  LS.set('library', library); LS.set('sample', sample);
  try{ localStorage.removeItem('sl_extra'); }catch(e){}
}
document.getElementById('genDate').textContent = 'updated ' + (LS.get('gen', DATA.generated));

let items = [];
function rebuild(){
  items = library.map(e => ({...e, services:{...e.services}}));
}
rebuild();

const state = { q:'', svc:null, type:null, flag:null, multi:false, store:false, sort:'title', view: LS.get('view','grid') };

// ---------- chips ----------
const chipsEl = document.getElementById('chips');
function chips(){
  const c = [];
  c.push({k:'type', v:null, label:'All'});
  c.push({k:'type', v:'movie', label:'Movies'});
  c.push({k:'type', v:'tv', label:'TV'});
  for (const [s,d] of Object.entries(SVC)) c.push({k:'svc', v:s, label:d.name, dot:d.color});
  c.push({k:'multi', v:true, label:'Owned 2+ places'});
  // Chip only exists while some title carries the hint. If the last one
  // self-heals away while the filter is on, clear it so the grid doesn't
  // silently filter to empty with no active chip to explain why.
  if (items.some(e => e.storeHint)) c.push({k:'store', v:true, label:'🛍 Partial / buy suggested'});
  else state.store = false;
  c.push({k:'flag', v:'q', label:'Watch next'});
  c.push({k:'flag', v:'w', label:'Watched'});
  c.push({k:'flag', v:'uw', label:'Unwatched'});
  chipsEl.innerHTML = '';
  for (const ch of c){
    const b = document.createElement('span');
    b.className = 'chip';
    const toggle = ch.k==='multi' || ch.k==='store';
    const active = toggle ? state[ch.k]===true && ch.v===true
      : state[ch.k]===ch.v && !(ch.k==='type'&&ch.v===null&&(state.type!==null));
    if (ch.k==='type'&&ch.v===null) { if(state.type===null&&!state.svc&&!state.flag&&!state.multi&&!state.store) b.classList.add('active'); }
    else if (active) b.classList.add('active');
    b.innerHTML = (ch.dot?`<span class="dot" style="background:${ch.dot}"></span>`:'') + ch.label;
    b.onclick = () => {
      if (ch.k==='type'&&ch.v===null){ state.type=null; state.svc=null; state.flag=null; state.multi=false; state.store=false; }
      else if (toggle) state[ch.k] = !state[ch.k];
      else state[ch.k] = state[ch.k]===ch.v ? null : ch.v;
      render();
    };
    chipsEl.appendChild(b);
  }
}

// ---------- untrusted-data guards ----------
// Titles/urls can arrive from imported files, bookmarklets, or harvested
// store pages, so escape before innerHTML and allowlist link schemes.
function esc(s){ return String(s??'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function safeUrl(u){ try{ const p = new URL(u, location.href); return (p.protocol==='http:'||p.protocol==='https:') ? p.href : '#'; }catch(e){ return '#'; } }

// ---------- filtering ----------
function normq(s){ return s.toLowerCase().replace(/[^a-z0-9 ]+/g,'') }
function visible(){
  let out = items.filter(e => {
    if (state.q && !normq(e.title).includes(normq(state.q))) return false;
    if (state.svc && !e.services[state.svc]) return false;
    if (state.type && e.type!==state.type) return false;
    if (state.multi && e.serviceCount<2) return false;
    if (state.store && !e.storeHint) return false;
    const f = flags[e.id]||{};
    if (state.flag==='w' && !f.w) return false;
    if (state.flag==='uw' && f.w) return false;
    if (state.flag==='q' && !f.q) return false;
    return true;
  });
  const y = e => meta[e.id]?.year || e.year || 0;
  if (state.sort==='title') out.sort((a,b)=>a.title.localeCompare(b.title));
  if (state.sort==='year') out.sort((a,b)=> y(b)-y(a) || a.title.localeCompare(b.title));
  if (state.sort==='services') out.sort((a,b)=> b.serviceCount-a.serviceCount || a.title.localeCompare(b.title));
  if (state.sort==='random') { for(let i=out.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[out[i],out[j]]=[out[j],out[i]];} }
  return out;
}

// ---------- stats ----------
function stats(){
  const el = document.getElementById('stats');
  const per = {};
  for (const s in SVC) per[s] = 0;
  let movies=0, tv=0, multi=0, watched=0;
  for (const e of items){
    // Ignore services this build doesn't know: an imported or legacy entry
    // with an unknown key would otherwise throw here and blank the app.
    for (const s in e.services) if (s in SVC) per[s] = (per[s]||0)+1;
    if (e.type==='movie') movies++; else tv++;
    if (e.serviceCount>1) multi++;
    if ((flags[e.id]||{}).w) watched++;
  }
  const total = items.length;
  const perTotal = Object.values(per).reduce((a,b)=>a+b,0) || 1;
  const bar = Object.entries(per).map(([s,n]) =>
    `<i style="width:${(n/perTotal*100).toFixed(1)}%;background:${SVC[s].color}" title="${esc(SVC[s].name)}: ${n}"></i>`).join('');
  const svcTiles = Object.entries(per).map(([s,n]) =>
    `<div class="tile"><div class="n">${n}</div><div class="l"><span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${SVC[s].color}"></span> ${esc(SVC[s].name)}</div></div>`).join('');
  el.innerHTML = `
    <div class="tile"><div class="n">${total}</div><div class="l">titles owned</div>
      <div class="bar">${bar}</div></div>
    <div class="tile"><div class="n">${movies} <span style="font-size:14px;color:var(--ink3)">/ ${tv}</span></div><div class="l">movies / TV</div></div>
    <div class="tile"><div class="n">${multi}</div><div class="l">owned on 2+ services</div></div>
    ${svcTiles}
    <div class="tile"><div class="n">${watched}</div><div class="l">marked watched</div></div>`;
}

// ---------- posters ----------
const pQueue = []; let pBusy = false;
function wantPoster(e, img){
  if (posters[e.id] !== undefined){ if (posters[e.id]) img.src = posters[e.id]; return; }
  pQueue.push([e, img]); pump();
}
// Store listings decorate titles ("Movie (4K UHD)", "Film [Extended Edition]",
// "Show - Season 1"), which poster lookups match badly or not at all.
function searchTitle(t){
  return String(t || '')
    .replace(/[\(\[][^)\]]*\b(4k|uhd|hd|sd|extended|unrated|theatrical|director'?s|special|collector'?s|ultimate|deluxe|anniversary|remastered|edition|version|cut|dubbed|subtitled|bundle)\b[^)\]]*[\)\]]/gi, ' ')
    .replace(/\s*[-–—:]\s*(4k|uhd|hd)\b.*$/i, ' ')
    .replace(/\s+/g, ' ').trim() || String(t || '');
}
async function pump(){
  if (pBusy) return; pBusy = true;
  while (pQueue.length){
    const [e, img] = pQueue.shift();
    if (posters[e.id] !== undefined){ if(posters[e.id]) img.src = posters[e.id]; continue; }
    try {
      const key = LS.get('tmdb', '');
      const st = searchTitle(e.title);
      let url = '', year = null, genre = null;
      try {
        if (key){
          const kind = e.type==='tv' ? 'tv' : 'movie';
          const r = await fetch(`https://api.themoviedb.org/3/search/${kind}?api_key=${key}&query=${encodeURIComponent(st)}${e.year?`&year=${e.year}`:''}`);
          const j = await r.json();
          const hit = (j.results||[])[0];
          if (hit){ url = hit.poster_path ? 'https://image.tmdb.org/t/p/w342'+hit.poster_path : '';
            year = (hit.release_date||hit.first_air_date||'').slice(0,4)||null; }
        } else {
          const kind = e.type==='tv' ? 'tvShow' : 'movie';
          const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(st)}&media=${e.type==='tv'?'tvShow':'movie'}&entity=${kind}&limit=5`);
          const j = await r.json();
          let hits = j.results||[];
          const tnorm = normq(st);
          let hit = hits.find(h => normq(h.trackName||h.collectionName||'')===tnorm) || hits[0];
          if (e.year) { const hy = hits.find(h => (h.releaseDate||'').startsWith(String(e.year)) && normq(h.trackName||h.collectionName||'').includes(tnorm.slice(0,10))); if (hy) hit = hy; }
          if (hit){ url = (hit.artworkUrl100||'').replace('100x100','342x513');
            year = (hit.releaseDate||'').slice(0,4)||null; genre = hit.primaryGenreName||null; }
        }
      } catch(err){ /* TMDB/iTunes unreachable (e.g. iTunes blocks file:// origins) — fall through to Wikipedia */ }
      // Keyless fallback: Wikipedia lead images. Film/TV posters are
      // fair-use, so pilicense=any is required; origin=* enables CORS from
      // any origin, including file:// and chrome-extension:. Narrow query
      // first (year disambiguates remakes), widening only if it misses.
      // Always keep the film/TV word: a bare title search returns whatever
      // the name means generally ("1776" -> a painting of the Declaration
      // of Independence), and a confidently wrong poster is worse than none.
      const kindWord = e.type==='tv' ? 'TV series' : 'film';
      for (const q of [e.year ? `${st} ${e.year} ${kindWord}` : null, `${st} ${kindWord}`]){
        if (url || !q) continue;
        const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=1&prop=pageimages&piprop=thumbnail&pithumbsize=342&pilicense=any&format=json&origin=*`);
        const j = await r.json();
        const page = Object.values(j.query?.pages || {})[0];
        url = page?.thumbnail?.source || '';
      }
      // Last resort: whatever artwork the store itself showed.
      if (!url) url = SLMerge.storePoster(e);
      posters[e.id] = url || '';
      if (year || genre){ meta[e.id] = {...(meta[e.id]||{}), ...(year?{year:+year}:{}), ...(genre?{genre}:{})}; }
      if (url) img.src = url;
      if (pQueue.length % 10 === 0){ LS.set('posters', posters); LS.set('meta', meta); }
      await new Promise(r=>setTimeout(r, 260)); // be polite to the API
    } catch(err){ /* offline or blocked: try again next session */ }
  }
  LS.set('posters', posters); LS.set('meta', meta);
  pBusy = false;
}

// ---------- render ----------
const grid = document.getElementById('grid');
const io = new IntersectionObserver(en => {
  for (const x of en) if (x.isIntersecting){ io.unobserve(x.target); const e = items.find(i=>i.id===x.target.dataset.id); if (e) wantPoster(e, x.target.querySelector('img')); }
}, {rootMargin:'400px'});

function svcLinks(e, big){
  return Object.entries(e.services).map(([s, links]) => {
    const d = SVC[s];
    if (!d) return ''; // unknown service (imported/legacy data) — skip, don't crash
    return links.map(l => big
      ? `<a class="watchbtn" style="background:${d.color}" href="${safeUrl(l.url)}" target="_blank" rel="noopener">▶ Watch on ${d.name}${l.note?` <small>(${esc(l.note)})</small>`:''}</a>`
      : `<a class="svc ${d.cls}" href="${safeUrl(l.url)}" target="_blank" rel="noopener" title="${esc(d.name)}${l.note?' — '+esc(l.note):''}">${d.letter}</a>`
    ).join('');
  }).join('');
}
function render(){
  document.getElementById('sampleBanner').style.display = sample ? 'flex' : 'none';
  chips(); stats();
  const list = visible();
  document.getElementById('count').textContent = `${list.length} of ${items.length} titles`;
  document.getElementById('empty').style.display = list.length ? 'none':'block';
  document.getElementById('empty').textContent = (IS_EXT && !items.length)
    ? 'Your library is empty — click ⇄ Sync stores to scan what you own.'
    : "Nothing matches — you don't own that one yet 🍿";
  grid.className = state.view==='list' ? 'list' : '';
  document.getElementById('viewToggle').textContent = state.view==='list' ? '▦ Grid' : '☰ List';
  grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const e of list){
    const f = flags[e.id]||{};
    const y = meta[e.id]?.year || e.year;
    const card = document.createElement('div');
    card.className = 'card'; card.dataset.id = e.id;
    card.innerHTML = `
      <div class="poster"><img alt="" loading="lazy"><div class="ph">${esc(e.title)}</div>
        <div class="flags">
          <button class="flag q ${f.q?'on':''}" title="Watch next">＋</button>
          <button class="flag w ${f.w?'on':''}" title="Watched">✓</button>
        </div>
        ${e.type==='tv'?'<span class="tvtag">TV</span>':''}
        ${e.storeHint?'<span class="storetag" title="The store shows a purchase suggestion here — you may not own every episode or season.">🛍</span>':''}
      </div>
      <div class="cbody">
        <div class="ct">${esc(e.title)}</div>
        <div class="cy">${esc(y||'')}${meta[e.id]?.genre?` · ${esc(meta[e.id].genre)}`:''}</div>
        <div class="listmeta"><span class="lm">${y||''}</span><span class="lm">${e.type==='tv'?'TV':'Movie'}</span></div>
        <div class="svcs">${svcLinks(e)}</div>
      </div>`;
    const img = card.querySelector('img');
    // A cached URL that 404s (e.g. a synthesized store poster for a title
    // whose CDN has no art) would otherwise be retried on every render and
    // never re-looked-up. Forget it so the next session tries properly.
    img.addEventListener('error', () => {
      if (posters[e.id]){ delete posters[e.id]; LS.set('posters', posters); }
      img.remove();
    });
    if (posters[e.id]) img.src = posters[e.id];
    card.querySelector('.poster').addEventListener('click', ev => { if (ev.target.closest('.flag')) return; detail(e); });
    card.querySelector('.flag.w').onclick = () => { f.w = f.w?0:1; flags[e.id]=f; LS.set('flags',flags); render(); };
    card.querySelector('.flag.q').onclick = () => { f.q = f.q?0:1; flags[e.id]=f; LS.set('flags',flags); render(); };
    frag.appendChild(card);
    if (posters[e.id]===undefined) io.observe(card);
  }
  grid.appendChild(frag);
}

// ---------- detail ----------
const dlg = document.getElementById('detail');
function detail(e){
  const f = flags[e.id]||{};
  const y = meta[e.id]?.year || e.year;
  dlg.innerHTML = `
    <div class="dhead"><h2>${esc(e.title)}${y?` <span style="color:var(--ink3);font-weight:400">(${esc(y)})</span>`:''}</h2>
      <button class="x">✕</button></div>
    <div class="dbody"><div class="dgrid">
      <div class="poster">${posters[e.id]?`<img src="${safeUrl(posters[e.id])}" alt="">`:`<div class="ph">${esc(e.title)}</div>`}</div>
      <div style="flex:1">
        <p>${e.type==='tv'?'TV series':'Movie'}${meta[e.id]?.genre?` · ${esc(meta[e.id].genre)}`:''} · owned on ${e.serviceCount} service${e.serviceCount>1?'s':''}</p>
        ${e.storeHint?'<p>🛍 The store shows a purchase suggestion — you may not own every episode or season of this.</p>':''}
        ${svcLinks(e, true)}
        <div class="rowbtns">
          <button class="ctl" id="dW">${f.w?'✓ Watched':'Mark watched'}</button>
          <button class="ctl" id="dQ">${f.q?'★ In watch-next':'Add to watch next'}</button>
          <button class="ctl" id="dRm" title="I don't actually own this">Remove</button>
        </div>
      </div>
    </div></div>`;
  dlg.querySelector('.x').onclick = () => dlg.close();
  // A sync only ever adds, and store pages can surface titles you don't own
  // (wishlist/recommended rails), so removal has to be possible by hand.
  dlg.querySelector('#dRm').onclick = () => {
    if (!confirm(`Remove "${e.title}" from your library?`)) return;
    library = library.filter(x => x.id !== e.id);
    LS.set('library', library);
    delete posters[e.id]; LS.set('posters', posters);
    dlg.close(); rebuild(); render();
  };
  dlg.querySelector('#dW').onclick = ()=>{ f.w=f.w?0:1; flags[e.id]=f; LS.set('flags',flags); dlg.close(); render(); };
  dlg.querySelector('#dQ').onclick = ()=>{ f.q=f.q?0:1; flags[e.id]=f; LS.set('flags',flags); dlg.close(); render(); };
  dlg.showModal();
}

// ---------- update / import ----------
const upd = document.getElementById('update');
// Returns true if the caller may proceed with its merge. On the sample
// library, a confirmed "replace" wipes it and clears the sample flag; a
// cancel aborts entirely (sample data + banner stay put) so the user keeps
// the "Clear sample" escape hatch instead of silently welding samples in.
function replaceSampleIfNeeded(){
  if (!sample) return true;
  if (!confirm('Replace the sample library with your data?')) return false;
  library = []; sample = false; LS.set('sample', sample);
  return true;
}
const U = {
  open(){ document.getElementById('tmdbKey').value = LS.get('tmdb',''); upd.showModal(); },
  close(){ upd.close(); },
  mergeBookmarklet(payload){
    if (!replaceSampleIfNeeded()) return;
    const byNorm = {}; for (const e of library) byNorm[SLMerge.keyOf(e.title, e.type==='tv')] = e;
    const res = SLMerge.mergeInto(byNorm, payload);
    library.push(...res.added);
    LS.set('library', library); LS.set('gen', new Date().toISOString().slice(0,10));
    rebuild(); render();
    document.getElementById('mergeMsg').textContent = `Merged: ${res.added.length} new title${res.added.length!==1?'s':''}, ${res.linked.length} new service link${res.linked.length!==1?'s':''}.`;
  },
  merge(){
    let j; try{ j = JSON.parse(document.getElementById('pasteBox').value) }catch(e){ alert('That is not valid JSON'); return }
    if (typeof j.service !== 'string' || !Array.isArray(j.items)){ alert('Expected {service, items} from a bookmarklet'); return }
    if (!(j.service in SVC)){ alert('Unknown service: ' + j.service); return }
    U.mergeBookmarklet(j);
  },
  importData(j){
    if (!j || typeof j !== 'object'){ alert('Unrecognized file — expected a Stream List backup, library.json, or bookmarklet export.'); return }
    if (j.streamList === 1 && j.library){
      if (!confirm('Replace your entire library with this backup?')) return;
      library = j.library; LS.set('library', library);
      flags = j.flags||{}; LS.set('flags', flags);
      posters = j.posters||{}; LS.set('posters', posters);
      meta = j.meta||{}; LS.set('meta', meta);
      sample = false; LS.set('sample', sample);
      rebuild(); render();
      document.getElementById('mergeMsg').textContent = 'Backup restored.';
      return;
    }
    if (typeof j.service === 'string' && Array.isArray(j.items)){
      U.mergeBookmarklet(j);
      return;
    }
    if (Array.isArray(j.items)){
      if (!replaceSampleIfNeeded()) return;
      const res = SLMerge.mergeLibraries(library, j.items);
      library = res.items; LS.set('library', library);
      rebuild(); render();
      document.getElementById('mergeMsg').textContent = `Merged: ${res.added} new title${res.added!==1?'s':''}, ${res.linked} title${res.linked!==1?'s':''} with new service link${res.linked!==1?'s':''}.`;
      return;
    }
    alert('Unrecognized file — expected a Stream List backup, library.json, or bookmarklet export.');
  },
  exportHtml(){
    const html = SLMerge.buildExportHtml({
      generated: LS.get('gen', DATA.generated) || new Date().toISOString().slice(0, 10),
      library,
      flags,
      posters,
      meta,
    });
    U.dl('stream-list.html', html, 'text/html;charset=utf-8');
  },
  exportLib(){
    const out = {generated: new Date().toISOString().slice(0,10), sources: Object.keys(SVC), items};
    U.dl('library.json', JSON.stringify(out, null, 1), 'application/json');
  },
  exportBackup(){
    const out = {streamList:1, exported: new Date().toISOString().slice(0,10), library, flags, posters, meta};
    U.dl('stream-list-backup.json', JSON.stringify(out, null, 1), 'application/json');
  },
  resetFlags(){ if(confirm('Clear all watched/watch-next flags?')){ flags={}; LS.set('flags',flags); render(); } },
  // Empty the library. Also forgets which sync results were already
  // merged, so the next sync (or reopening the app) refills it instead of
  // leaving you empty because those results counted as "already merged".
  clearLibrary(){
    if (!confirm('Remove every title from your library? Watched/watch-next flags are kept.')) return;
    library = []; sample = false;
    LS.set('library', library); LS.set('sample', sample); LS.set('mergedAt', {});
    rebuild(); render();
    document.getElementById('mergeMsg').textContent = 'Library cleared — sync or import to refill it.';
  },
  dl(name, text, mime='application/json'){
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], {type: mime}));
    a.download = name; a.click();
  },
};
document.getElementById('exportBtn').onclick = U.exportHtml;
document.getElementById('exportHtmlBtn').onclick = U.exportHtml;
document.getElementById('updateBtn').onclick = U.open;
document.getElementById('updClose').onclick = U.close;
document.getElementById('mergeBtn').onclick = U.merge;
document.getElementById('importBtn').onclick = () => document.getElementById('importFile').click();
document.getElementById('exportLibBtn').onclick = U.exportLib;
document.getElementById('exportBackupBtn').onclick = U.exportBackup;
document.getElementById('resetFlagsBtn').onclick = U.resetFlags;
document.getElementById('clearLibBtn').onclick = U.clearLibrary;
document.getElementById('tmdbKey').addEventListener('change', ev => { LS.set('tmdb', ev.target.value.trim()); posters={}; LS.set('posters',posters); });
document.getElementById('importFile').addEventListener('change', ev => {
  const file = ev.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let j; try{ j = JSON.parse(reader.result) }catch(e){ alert('That is not valid JSON'); ev.target.value=''; return }
    U.importData(j);
    ev.target.value = '';
  };
  reader.readAsText(file);
});
document.getElementById('clearSampleBtn').onclick = () => {
  if (!confirm('Clear the sample library?')) return;
  library = []; LS.set('library', library);
  sample = false; LS.set('sample', sample);
  rebuild(); render();
};

// bookmarklets
function bkm(code){ return 'javascript:' + encodeURIComponent(`(()=>{${code}})()`); }
// Bookmarklets run on the store page, so they can't see this page's
// SLCollect — embed the collector source (extension/lib/collect.js,
// inlined by tools/build.py) ahead of each bookmarklet's own logic.
const COLLECT_SRC = document.getElementById('collect-src').textContent;
document.getElementById('bkGoogle').href = bkm(COLLECT_SRC + `
const out=[],seen=new Set();
SLCollect.google().forEach(it=>{if(seen.has(it.key))return;seen.add(it.key);out.push({title:it.title,url:it.url,tv:it.tv,img:it.img})});
const j=JSON.stringify({service:'google',items:out});navigator.clipboard.writeText(j).then(()=>alert('Copied '+out.length+' titles — paste into Stream List'));`);
document.getElementById('bkAmazon').href = bkm(COLLECT_SRC + `
const out=[],seen=new Set();
SLCollect.amazon(location.pathname.includes('/tv')).forEach(it=>{if(seen.has(it.key))return;seen.add(it.key);out.push({title:it.title,url:it.url,tv:it.tv,img:it.img,store:it.store})});
const j=JSON.stringify({service:'amazon',items:out});navigator.clipboard.writeText(j).then(()=>alert('Copied '+out.length+' titles — paste into Stream List'));`);
document.getElementById('bkFandango').href = bkm(COLLECT_SRC + `
const out=[],seen=new Set();
SLCollect.fandango(location.pathname.includes('/mytv')).forEach(it=>{if(seen.has(it.key))return;seen.add(it.key);out.push({title:it.title,url:it.url,tv:it.tv,img:it.img})});
const j=JSON.stringify({service:'fandango',items:out});navigator.clipboard.writeText(j).then(()=>alert('Copied '+out.length+' titles (scroll the whole page first!) — paste into Stream List'));`);

// ---------- extension integration ----------
// Inside the extension the app page is the whole product: the Sync button
// drives background.js, the strip mirrors per-service status live, and
// finished results auto-merge additively (nothing is ever deleted).
// mergeInto is idempotent, so re-merging stored results is safe.
if (IS_EXT){
  const syncBtn = document.getElementById('syncBtn');
  const stripEl = document.getElementById('syncStrip');
  syncBtn.style.display = '';
  // Bookmarklets and paste-merge don't apply inside the extension.
  document.getElementById('bkSection').style.display = 'none';
  document.getElementById('mergeBtn').style.display = 'none';

  let armed = false, armTimer = 0;
  syncBtn.addEventListener('click', () => {
    if (!armed){
      armed = true; syncBtn.textContent = '▶ Open store tabs & scan?';
      armTimer = setTimeout(() => { armed = false; syncBtn.textContent = '⇄ Sync stores'; }, 8000);
      return;
    }
    clearTimeout(armTimer); armed = false; syncBtn.textContent = '⇄ Sync stores';
    chrome.runtime.sendMessage({cmd: 'sync'});
    stripEl.classList.add('open');
  });

  function stText(st){
    if (!st) return 'not synced yet';
    switch (st.state){
      case 'opening': return 'opening…';
      case 'running': return `scanning… ${st.found ?? 0}${st.expected ? '/' + st.expected : ''}`;
      case 'login':   return 'login needed — sign in on the open tab, then sync again';
      case 'error':   return 'error: ' + (st.error || 'unknown');
      case 'done':    return `${st.found} titles ✓`;
      default:        return st.state;
    }
  }
  async function renderStrip(){
    const {status = {}} = await chrome.storage.local.get('status');
    if (!Object.keys(status).length) return;
    stripEl.classList.add('open');
    stripEl.innerHTML = Object.entries(SVC).map(([s, d]) =>
      `<span><span class="sdot" style="background:${d.color}"></span>${esc(d.name)}: ${esc(stText(status[s]))}</span>`).join('');
  }
  async function autoMerge(){
    const {results = {}} = await chrome.storage.local.get('results');
    // Watermark per service: merge each stored result once. Without this,
    // every page load re-merges old results and silently resurrects titles
    // the user removed via a backup restore.
    const mergedAt = LS.get('mergedAt', {});
    let added = 0, linked = 0, consumed = false;
    for (const r of Object.values(results)){
      if (!r || typeof r.service !== 'string' || !Array.isArray(r.items)) continue;
      if (!(r.when > (mergedAt[r.service] || 0))) continue;
      const byNorm = {}; for (const e of library) byNorm[SLMerge.keyOf(e.title, e.type === 'tv')] = e;
      const res = SLMerge.mergeInto(byNorm, {service: r.service, items: r.items});
      library.push(...res.added); added += res.added.length; linked += res.linked.length;
      mergedAt[r.service] = r.when; consumed = true;
    }
    if (consumed) LS.set('mergedAt', mergedAt);
    if (added || linked){
      LS.set('library', library); LS.set('gen', new Date().toISOString().slice(0, 10));
      rebuild(); render();
    }
  }
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.status) renderStrip();
    if (ch.results) autoMerge();
  });
  renderStrip(); autoMerge();
}

// ---------- wiring ----------
document.getElementById('search').addEventListener('input', ev => { state.q = ev.target.value; render(); });
document.getElementById('sort').addEventListener('change', ev => { state.sort = ev.target.value; render(); });
document.getElementById('viewToggle').onclick = () => { state.view = state.view==='list'?'grid':'list'; LS.set('view', state.view); render(); };
document.getElementById('statsToggle').onclick = () => document.getElementById('stats').classList.toggle('open');
document.addEventListener('keydown', ev => {
  if (ev.key==='/' && document.activeElement!==document.getElementById('search')){ ev.preventDefault(); document.getElementById('search').focus(); }
  if (ev.key==='Escape'){ document.getElementById('search').value=''; state.q=''; render(); }
});
render();
