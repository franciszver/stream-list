// Shared DOM-scrape logic for Stream List harvesters and bookmarklets.
// Single source of truth: inlined into index.html by tools/build.py
// (replacing the shared-collect placeholder in index.template.html) and
// loaded by the Chrome extension harvesters (extension/harvest/*.js).
// Pure DOM scan of the CURRENT page only — no chrome.* APIs, no async,
// no scrolling. Callers own the scroll/retry loop and dedupe.
'use strict';
const SLCollect = (() => {
  // Store pages surround the owned-titles grid with rails — "recommended
  // for you", wishlist, "because you watched" — whose links look exactly
  // like owned ones and would otherwise be harvested as purchases.
  //
  // Identify rails by their heading, not by size: a library can legitimately
  // be split across containers, and picking "the biggest block" silently
  // drops the smaller half. Missing a title you own is worse than showing
  // one you don't, so this only excludes what a heading names as a rail,
  // and refuses to act if that would remove most of the page.
  // "continue watching" is deliberately absent: it can sit over titles you
  // do own and are part-way through, and dropping those is the failure we
  // care most about avoiding.
  const RAIL = /\b(recommend\w*|suggest\w*|wish\s*list|watch\s*list|because you watched|more like|similar|also (?:bought|like[ds]?|watched)|trending|popular|new releases?|coming soon|top picks|featured|sponsored|you (?:might|may))\b/i;
  function railRoots(){
    const roots = [];
    document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]').forEach(h => {
      if (!RAIL.test((h.textContent || '').trim())) return;
      // Climb to the nearest ancestor that actually holds the rail's links.
      let p = h.parentElement;
      for (let i = 0; p && i < 5; p = p.parentElement, i++){
        if (p.querySelector('a[href]')){ roots.push(p); return; }
      }
    });
    return roots;
  }
  // includeRails: return everything, so a caller can diff the two lists to
  // see which links are currently inside a rail.
  function ownedLinks(selector, includeRails){
    const links = [...document.querySelectorAll(selector)];
    if (includeRails) return links;
    const rails = railRoots();
    if (!rails.length) return links;
    const kept = links.filter(a => !rails.some(r => r.contains(a)));
    // Safety valve: never trust a heading that would sweep away half the
    // page (a page-level banner, or a climb that overshot into the grid).
    return kept.length >= links.length * 0.5 ? kept : links;
  }

  // Artwork shown on the store's own tile, used as a poster fallback.
  // Lazy-loading grids often park a placeholder in src until the tile is
  // near the viewport, so prefer the real URL in data-src/srcset.
  function artwork(a){
    const img = a.querySelector('img');
    if (!img) return '';
    const src = img.getAttribute('data-src') || img.getAttribute('src') || '';
    if (/^https?:/.test(src) && !/^data:/.test(src)) return src;
    const set = img.getAttribute('srcset') || '';
    const first = set.split(',')[0].trim().split(' ')[0];
    return /^https?:/.test(first) ? first : '';
  }

  // Google Play library page: one scan of visible anchors.
  function google(includeRails){
    const out = [];
    ownedLinks('a[href*="/store/movies/details"],a[href*="/store/tv/show"]', includeRails).forEach(a => {
      const u = new URL(a.href, location.origin);
      let t = a.textContent.trim()
        .replace(/(\d\.\d)?star.*$/, '')
        .replace(/\$\d+\.\d\d.*$/, '')
        .trim();
      if (!t && a.getAttribute('aria-label')) t = a.getAttribute('aria-label').trim();
      if (!t) return;
      out.push({key: u.pathname, title: t, url: u.origin + u.pathname, tv: u.pathname.includes('/tv/'), img: artwork(a)});
    });
    return out;
  }

  // Prime Video library page (movies or tv, per isTv).
  function amazon(isTv, includeRails){
    const out = [];
    ownedLinks('a[href*="/gp/video/detail/"]', includeRails).forEach(a => {
      const m = a.href.match(/\/gp\/video\/detail\/([A-Z0-9]+)/);
      if (!m) return;
      const t = (a.getAttribute('aria-label') || a.textContent).trim();
      if (!t) return;
      out.push({key: m[1], title: t, url: 'https://www.amazon.com/gp/video/detail/' + m[1], tv: !!isTv, img: artwork(a)});
    });
    return out;
  }

  // Fandango at Home "My Movies" / "My TV" pages.
  function fandango(isTv, includeRails){
    const out = [];
    ownedLinks('a[href*="/content/browse/details/"]', includeRails).forEach(a => {
      const m = (a.getAttribute('href') || '').match(/\/content\/browse\/details\/([^/]+)\/(\d+)/);
      if (!m) return;
      const img = a.querySelector('img');
      const t = (img && img.alt || a.getAttribute('aria-label') || '').trim()
        || m[1].replace(/-/g, ' ').trim();
      out.push({
        key: m[2],
        title: t,
        url: 'https://athome.fandango.com/content/browse/details/' + m[1] + '/' + m[2],
        tv: !!isTv,
        img: artwork(a),
      });
    });
    return out;
  }

  return {google, amazon, fandango, ownedLinks};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = SLCollect;
