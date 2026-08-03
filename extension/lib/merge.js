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
  return {norm, keyOf, parseYear, makeEntry, storePoster, mergeInto, buildLibrary, mergeLibraries};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = SLMerge;
