// Harvest owned titles from Fandango at Home ("My Movies").
//
// Primary path: the same JSON API the site's own app uses
// (POST api.vudu.com/api2/, _type=contentSearch&listType=rentedOrOwned),
// paged 50 at a time until moreBelow is false. This is immune to the
// virtualized grid, which never renders more than a fraction of a large
// library no matter how it's scrolled (owner's 202-title library yielded
// only 51-67 via the DOM).
//
// Fallback: the original scroll-and-scrape, used when the session key
// can't be found or the API errors out.
//
// Injected by background.js; reports via chrome.runtime.sendMessage.
// DOM scan logic lives in extension/lib/collect.js (SLCollect).
(async () => {
  'use strict';
  const send = m => chrome.runtime.sendMessage({from: 'harvest', service: 'fandango', ...m});
  const found = new Map(); // key (vudu contentId) -> item

  const expectedCount = () => {
    const m = document.body.innerText.match(/My\s+Movies\s*\((\d+)\)/i);
    return m ? +m[1] : null;
  };

  // The site keeps its API credentials in web storage; find them without
  // caring which key they're filed under (that has changed before).
  function findCreds(){
    for (const store of [localStorage, sessionStorage]){
      for (let i = 0; i < store.length; i++){
        const raw = store.getItem(store.key(i));
        if (!raw || raw.indexOf('sessionKey') === -1) continue;
        try {
          const hit = {};
          (function walk(v){
            if (!v || typeof v !== 'object') return;
            for (const k of Object.keys(v)){
              if (k === 'sessionKey' && typeof v[k] === 'string') hit.sessionKey = v[k];
              if (k === 'userId' && (typeof v[k] === 'string' || typeof v[k] === 'number')) hit.userId = String(v[k]);
              walk(v[k]);
            }
          })(JSON.parse(raw));
          if (hit.sessionKey && hit.userId) return hit;
        } catch (e){ /* not JSON — keep looking */ }
      }
    }
    return null;
  }

  // Responses are JSON wrapped in a /*-secure- ... */ comment.
  function parseSecure(text){
    return JSON.parse(text.trim().replace(/^\/\*-secure-/, '').replace(/\*\/$/, ''));
  }
  const first = v => Array.isArray(v) ? v[0] : v;

  async function fetchPage(creds, offset, count){
    const query = [
      '_type=contentSearch', 'claimedAppId=winWeb', 'contentEncoding=gzip',
      'count=' + count, 'format=' + encodeURIComponent('application/json'),
      'listType=rentedOrOwned', 'noCache=true', 'offset=' + offset,
      'responseSubset=micro', 'sessionKey=' + encodeURIComponent(creds.sessionKey),
      'sortBy=-purchaseTime', 'superType=movies', 'type=bundle', 'type=program',
      'userId=' + encodeURIComponent(creds.userId),
    ].join('&');
    const body = 'contentType=' + encodeURIComponent('application/x-vudu-url-note') +
      '&query=' + encodeURIComponent(query);
    const r = await fetch('https://api.vudu.com/api2/', {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body,
    });
    if (!r.ok) throw new Error('api ' + r.status);
    return parseSecure(await r.text());
  }

  function addApiItem(c){
    const id = first(c.contentId);
    const title = first(c.title);
    if (!id || !title) return;
    const slug = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    found.set(String(id), {
      title: String(title),
      url: 'https://athome.fandango.com/content/browse/details/' + (slug || 'title') + '/' + id,
      tv: false,
    });
  }

  let expected = expectedCount();
  let viaApi = false;
  const creds = findCreds();
  if (creds){
    try {
      const COUNT = 50;
      for (let offset = 0; offset < 5000; offset += COUNT){
        const j = await fetchPage(creds, offset, COUNT);
        const page = j.content || [];
        page.forEach(addApiItem);
        send({type: 'progress', found: found.size, expected});
        if (first(j.moreBelow) !== 'true' || !page.length) break;
      }
      viaApi = found.size > 0;
    } catch (err){
      send({type: 'progress', found: found.size, expected}); // fall through to DOM
    }
  }

  if (!viaApi){
    const collect = () => {
      SLCollect.fandango().forEach(it => {
        if (found.has(it.key)) return;
        found.set(it.key, {title: it.title, url: it.url, tv: it.tv});
      });
    };
    let stale = 0, last = 0;
    await new Promise(r => setTimeout(r, 1500));
    collect();
    while ((expected === null || found.size < expected) && stale < 20){
      const anchors = document.querySelectorAll('a[href*="/content/browse/details/"]');
      if (anchors.length) anchors[anchors.length - 1].scrollIntoView({block: 'end'});
      window.scrollBy(0, Math.round(window.innerHeight * 0.8));
      await new Promise(r => setTimeout(r, 700));
      if (expected === null) expected = expectedCount();
      collect();
      if (found.size === last) stale++; else { stale = 0; last = found.size; }
      send({type: 'progress', found: found.size, expected});
    }
  }

  send({type: 'done', payload: {service: 'fandango', items: [...found.values()]}, expected});
})();
