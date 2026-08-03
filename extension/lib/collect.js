// Shared DOM-scrape logic for Stream List harvesters and bookmarklets.
// Single source of truth: inlined into index.html by tools/build.py
// (replacing the shared-collect placeholder in index.template.html) and
// loaded by the Chrome extension harvesters (extension/harvest/*.js).
// Pure DOM scan of the CURRENT page only — no chrome.* APIs, no async,
// no scrolling. Callers own the scroll/retry loop and dedupe.
'use strict';
const SLCollect = (() => {
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
  function google(){
    const out = [];
    document.querySelectorAll('a[href*="/store/movies/details"],a[href*="/store/tv/show"]').forEach(a => {
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
  function amazon(isTv){
    const out = [];
    document.querySelectorAll('a[href*="/gp/video/detail/"]').forEach(a => {
      const m = a.href.match(/\/gp\/video\/detail\/([A-Z0-9]+)/);
      if (!m) return;
      const t = (a.getAttribute('aria-label') || a.textContent).trim();
      if (!t) return;
      out.push({key: m[1], title: t, url: 'https://www.amazon.com/gp/video/detail/' + m[1], tv: !!isTv, img: artwork(a)});
    });
    return out;
  }

  // Fandango at Home "My Movies" / "My TV" pages.
  function fandango(isTv){
    const out = [];
    document.querySelectorAll('a[href*="/content/browse/details/"]').forEach(a => {
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

  return {google, amazon, fandango};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = SLCollect;
