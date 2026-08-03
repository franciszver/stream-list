// Harvest owned titles from Fandango at Home ("My Movies" / "My TV").
//
// The grid is virtualized AND self-resetting: opening the page with
// ?minVisible=999 renders the whole library for a moment, then the app
// rewrites the URL and tears the extra tiles back out of the DOM. A
// collector that waits for the page to settle therefore sees only a
// fraction (owner's 202-title library reported 51, then 67).
//
// So: start a MutationObserver as early as the script can run and keep
// every tile ever seen, even ones removed a moment later. Scrolling then
// coaxes out anything that never rendered in the first pass.
//
// Injected by background.js (early, before load completes when possible);
// reports via chrome.runtime.sendMessage. DOM scan logic lives in
// extension/lib/collect.js (SLCollect).
(async () => {
  'use strict';
  if (window.__slFandangoHarvesting) return; // early + fallback injection both fired
  window.__slFandangoHarvesting = true;

  const isTv = /\/mytv/i.test(location.pathname);
  const send = m => chrome.runtime.sendMessage({from: 'harvest', service: 'fandango', ...m});
  const found = new Map(); // vudu content id -> item

  const collect = () => {
    SLCollect.fandango(isTv).forEach(it => {
      if (!found.has(it.key)) found.set(it.key, {title: it.title, url: it.url, tv: it.tv});
    });
  };

  // Observe from the earliest possible moment: tiles that appear and are
  // removed again still land in `found`.
  const observe = () => {
    collect();
    new MutationObserver(collect).observe(document.documentElement, {childList: true, subtree: true});
  };
  if (document.documentElement) observe();
  else document.addEventListener('readystatechange', function once(){
    if (document.documentElement){ document.removeEventListener('readystatechange', once); observe(); }
  });

  const expectedCount = () => {
    const m = (document.body ? document.body.innerText : '')
      .match(isTv ? /My\s+TV\s*\((\d+)\)/i : /My\s+Movies\s*\((\d+)\)/i);
    return m ? +m[1] : null;
  };

  // Prefer to scroll only after load, but never block on it: with ~1000
  // tiles requested the load event can be a long time coming, and the
  // observer above is already collecting in the meantime.
  if (document.readyState !== 'complete'){
    await new Promise(r => {
      const go = () => { clearTimeout(t); r(); };
      const t = setTimeout(go, 15000);
      window.addEventListener('load', go, {once: true});
    });
  }
  await new Promise(r => setTimeout(r, 1500));

  // Scroll to the bottom repeatedly, exactly like the Amazon harvester,
  // and click any "show more" control the grid offers. Give up only after
  // a long run of rounds that find nothing new — a virtualized grid can
  // pause before it renders the next batch.
  const clickLoadMore = () => {
    for (const b of document.querySelectorAll('button, a, [role="button"]')){
      if (/^(see|load|show)\s+more/i.test((b.textContent || '').trim())){ b.click(); return true; }
    }
    return false;
  };

  let expected = expectedCount();
  let stale = 0, last = found.size;
  send({type: 'progress', found: found.size, expected});
  while ((expected === null || found.size < expected) && stale < 25){
    window.scrollTo(0, document.body.scrollHeight);
    // Also drive the virtualizer from the last rendered tile: the grid can
    // live in an inner scroll container that window scrolling never moves.
    const anchors = document.querySelectorAll('a[href*="/content/browse/details/"]');
    if (anchors.length) anchors[anchors.length - 1].scrollIntoView({block: 'end'});
    clickLoadMore();
    await new Promise(r => setTimeout(r, 900));
    if (expected === null) expected = expectedCount();
    collect();
    if (found.size === last) stale++; else { stale = 0; last = found.size; }
    send({type: 'progress', found: found.size, expected});
  }

  send({type: 'done', payload: {service: 'fandango', items: [...found.values()]}, expected});
})();
