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

  // Wait for the page to actually load before scrolling it around.
  if (document.readyState !== 'complete'){
    await new Promise(r => window.addEventListener('load', r, {once: true}));
  }
  await new Promise(r => setTimeout(r, 1500));

  let expected = expectedCount();
  let stale = 0, last = found.size;
  send({type: 'progress', found: found.size, expected});
  while ((expected === null || found.size < expected) && stale < 25){
    // Drive the virtualizer from the last rendered tile: the grid can live
    // in an inner scroll container that window.scrollBy never moves.
    const anchors = document.querySelectorAll('a[href*="/content/browse/details/"]');
    if (anchors.length) anchors[anchors.length - 1].scrollIntoView({block: 'end'});
    window.scrollBy(0, Math.round(window.innerHeight * 0.8));
    await new Promise(r => setTimeout(r, 700));
    if (expected === null) expected = expectedCount();
    collect();
    if (found.size === last) stale++; else { stale = 0; last = found.size; }
    send({type: 'progress', found: found.size, expected});
  }

  send({type: 'done', payload: {service: 'fandango', items: [...found.values()]}, expected});
})();
