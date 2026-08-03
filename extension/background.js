// Stream List Sync — background orchestrator.
// Opens each store's library page, injects the matching harvester
// (extension/harvest/*.js), and stores results in chrome.storage.local.
// The popup reads status/results from storage and renders them.
'use strict';

const SERVICES = {
  google: {
    label: 'Google Play',
    pages: [{url: 'https://play.google.com/movies'}],
    script: 'harvest/google.js',
    loginHosts: ['accounts.google.com'],
    timeoutMs: 60000,
  },
  amazon: {
    label: 'Prime Video',
    pages: [
      {url: 'https://www.amazon.com/gp/video/mystuff/library/movies'},
      {url: 'https://www.amazon.com/gp/video/mystuff/library/tv'},
    ],
    script: 'harvest/amazon.js',
    loginHosts: ['www.amazon.com/ap/'],
    timeoutMs: 90000, // per page
  },
  fandango: {
    label: 'Fandango at Home',
    // minVisible pre-renders that many grid items up front (the grid is
    // virtualized; scrolling alone proved unreliable). Owner-verified: the
    // param only takes effect together with SORT_ORDER, and 999 is the max
    // that works (bare ?minVisible=1000 rendered ~67). The SPA rewrites the
    // URL after load — harmless, the tiles stay rendered.
    pages: [
      {url: 'https://athome.fandango.com/content/browse/mymovies?SORT_ORDER=A%2520-%2520Z&minVisible=999'},
      // TV lives on its own page; not everyone owns any, so a failure here
      // must not discard the movies we already harvested.
      {url: 'https://athome.fandango.com/content/browse/mytv?SORT_ORDER=A%2520-%2520Z&minVisible=999', optional: true},
    ],
    script: 'harvest/fandango.js',
    loginHosts: ['athome.fandango.com/login', 'auth.athome.fandango.com'],
    timeoutMs: 240000, // virtualized grid, auto-scroll can be slow
    // The page renders the full grid briefly and then tears it down, so the
    // collector's observer has to be running before that happens.
    injectEarly: true,
  },
};

function setBadge(text, color){
  chrome.action.setBadgeText({text});
  if (color) chrome.action.setBadgeBackgroundColor({color});
}

async function setStatus(service, patch){
  const {status = {}} = await chrome.storage.local.get('status');
  status[service] = {...(status[service] || {}), ...patch, when: Date.now()};
  await chrome.storage.local.set({status});
}

function waitForLoad(tabId, timeoutMs = 30000){
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('page load timed out'));
    }, timeoutMs);
    const done = tab => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); resolve(tab); };
    const listener = (id, info, tab) => { if (id === tabId && info.status === 'complete') done(tab); };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then(tab => { if (tab.status === 'complete') done(tab); });
  });
}

// Resolve when the harvester in tabId sends {from:'harvest', type:'done'}.
function waitForHarvest(tabId, service, timeoutMs){
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error('harvest timed out'));
    }, timeoutMs);
    const listener = (msg, sender) => {
      if (sender.tab?.id !== tabId || msg?.from !== 'harvest') return;
      if (msg.type === 'progress'){
        setStatus(service, {state: 'running', found: msg.found, expected: msg.expected ?? null});
      } else if (msg.type === 'done'){
        clearTimeout(timer);
        chrome.runtime.onMessage.removeListener(listener);
        resolve(msg);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
  });
}

async function harvestPage(service, page){
  const cfg = SERVICES[service];
  const tab = await chrome.tabs.create({url: page.url, active: true});
  let keepOpen = false;
  const files = ['lib/collect.js', cfg.script];
  try {
    // Listen before injecting so an early harvester can't finish unheard.
    const done = waitForHarvest(tab.id, service, cfg.timeoutMs);
    done.catch(() => {}); // don't leave this rejection unhandled if we bail below
    // Some pages must be watched from before they finish rendering.
    const early = cfg.injectEarly
      ? chrome.scripting.executeScript({target: {tabId: tab.id}, files, injectImmediately: true}).catch(() => null)
      : null;
    await waitForLoad(tab.id);
    // Give SPAs a moment to render/redirect after "complete".
    await new Promise(r => setTimeout(r, 2500));
    const now = await chrome.tabs.get(tab.id);
    if (cfg.loginHosts.some(h => (now.url || '').includes(h))){
      await setStatus(service, {state: 'login', found: 0});
      keepOpen = true; // leave the tab open so the user can sign in
      return null;
    }
    await setStatus(service, {state: 'running', found: 0});
    // The harvester no-ops if it's already running from the early pass.
    if (!(early && await early)){
      await chrome.scripting.executeScript({target: {tabId: tab.id}, files});
    }
    const msg = await done;
    return msg.payload; // {service, items:[{title,url,tv}]}
  } catch (err){
    await setStatus(service, {state: 'error', error: String(err.message || err)});
    return null;
  } finally {
    if (!keepOpen) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function syncService(service){
  const cfg = SERVICES[service];
  await setStatus(service, {state: 'opening'});
  const items = [];
  for (const page of cfg.pages){
    const payload = await harvestPage(service, page);
    if (!payload){
      if (page.optional) continue; // e.g. a TV page the user has nothing on
      return; // status already set (login/error)
    }
    items.push(...payload.items);
  }
  const {results = {}} = await chrome.storage.local.get('results');
  results[service] = {service, items, when: Date.now()};
  await chrome.storage.local.set({results});
  await setStatus(service, {state: 'done', found: items.length});
}

// The worker can be killed mid-sync (extension reload, browser restart);
// the finally-cleanup below never runs then, leaving 'running' statuses and
// the ↻ badge stranded forever. Sweep them on every worker start.
(async () => {
  const {status = {}} = await chrome.storage.local.get('status');
  let dirty = false;
  for (const s of Object.keys(status)){
    if (status[s].state === 'opening' || status[s].state === 'running'){
      status[s] = {...status[s], state: 'error', error: 'interrupted — sync again', when: Date.now()};
      dirty = true;
    }
  }
  if (dirty){
    await chrome.storage.local.set({status});
    setBadge('!', '#d93025');
  }
})();

let syncing = false;
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.cmd !== 'sync') return;
  if (syncing){ sendResponse({busy: true}); return; }
  const services = msg.service ? [msg.service] : Object.keys(SERVICES);
  syncing = true;
  setBadge('↻', '#4a7dff');
  (async () => {
    try {
      for (const s of services) await syncService(s);
    } finally {
      syncing = false;
      const {status = {}} = await chrome.storage.local.get('status');
      const ok = services.every(s => status[s]?.state === 'done');
      setBadge(ok ? '✓' : '!', ok ? '#1a9c4b' : '#d93025');
    }
  })();
  sendResponse({started: true});
});
