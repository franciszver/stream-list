// Harvest owned titles from the Google Play library page.
// Injected by background.js; reports via chrome.runtime.sendMessage.
// DOM scan logic lives in extension/lib/collect.js (SLCollect), injected
// alongside this file so it's available here.
(async () => {
  'use strict';
  const send = m => chrome.runtime.sendMessage({from: 'harvest', service: 'google', ...m});
  const found = new Map(); // key -> item

  const collect = () => {
    SLCollect.google().forEach(it => {
      if (found.has(it.key)) return;
      found.set(it.key, {title: it.title, url: it.url, tv: it.tv, img: it.img});
    });
  };

  // Scroll to the bottom until no new items appear for a few rounds.
  let stale = 0, last = 0;
  collect();
  while (stale < 6){
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise(r => setTimeout(r, 800));
    collect();
    if (found.size === last) stale++; else { stale = 0; last = found.size; }
    send({type: 'progress', found: found.size});
  }
  send({type: 'done', payload: {service: 'google', items: [...found.values()]}});
})();
