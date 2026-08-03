// Harvest owned titles from a Prime Video library page
// (/gp/video/mystuff/library/movies or .../tv).
// Injected by background.js; reports via chrome.runtime.sendMessage.
// DOM scan logic lives in extension/lib/collect.js (SLCollect), injected
// alongside this file so it's available here.
(async () => {
  'use strict';
  if (window.__slHarvesting) return; // background.js may inject twice
  window.__slHarvesting = true;
  const send = m => chrome.runtime.sendMessage({from: 'harvest', service: 'amazon', ...m});
  const isTv = location.pathname.includes('/library/tv');
  const found = new Map(); // key (ASIN) -> item

  const collect = () => {
    SLCollect.amazon(isTv).forEach(it => {
      if (found.has(it.key)) return;
      found.set(it.key, {title: it.title, url: it.url, tv: it.tv, img: it.img});
    });
  };

  // Amazon paginates with a "load more"-style control; scroll and click it.
  const clickLoadMore = () => {
    for (const b of document.querySelectorAll('button, a, [role="button"]')){
      if (/^(see|load|show)\s+more/i.test((b.textContent || '').trim())){ b.click(); return true; }
    }
    return false;
  };

  let stale = 0, last = 0;
  collect();
  while (stale < 6){
    window.scrollTo(0, document.body.scrollHeight);
    clickLoadMore();
    await new Promise(r => setTimeout(r, 900));
    collect();
    if (found.size === last) stale++; else { stale = 0; last = found.size; }
    send({type: 'progress', found: found.size});
  }
  send({type: 'done', payload: {service: 'amazon', items: [...found.values()]}});
})();
