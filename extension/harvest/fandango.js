// Harvest owned titles from Fandango at Home's "My Movies" page.
// The grid is VIRTUALIZED: items render only as you scroll, ~15 at a
// time, so scroll gradually and keep collecting until the count shown
// in "My Movies (N)" is reached (or the list stops growing).
// Injected by background.js; reports via chrome.runtime.sendMessage.
// DOM scan logic lives in extension/lib/collect.js (SLCollect), injected
// alongside this file so it's available here.
(async () => {
  'use strict';
  const send = m => chrome.runtime.sendMessage({from: 'harvest', service: 'fandango', ...m});
  const found = new Map(); // key (fandango id) -> item

  const expectedCount = () => {
    const m = document.body.innerText.match(/My\s+Movies\s*\((\d+)\)/i);
    return m ? +m[1] : null;
  };

  const collect = () => {
    SLCollect.fandango().forEach(it => {
      if (found.has(it.key)) return;
      found.set(it.key, {title: it.title, url: it.url, tv: it.tv});
    });
  };

  let expected = expectedCount();
  let stale = 0, last = 0;
  collect();
  // Gradual scroll: one viewport at a time so the virtualizer has a
  // chance to render every row; jumping to the bottom would skip items.
  while ((expected === null || found.size < expected) && stale < 15){
    window.scrollBy(0, Math.round(window.innerHeight * 0.8));
    await new Promise(r => setTimeout(r, 700));
    if (expected === null) expected = expectedCount();
    collect();
    if (found.size === last) stale++; else { stale = 0; last = found.size; }
    send({type: 'progress', found: found.size, expected});
    // At the bottom with items still missing? The list may extend
    // scrollHeight lazily — the stale counter is our exit.
  }
  send({type: 'done', payload: {service: 'fandango', items: [...found.values()]}, expected});
})();
