// Stream List Sync — popup UI. Reads status/results written by
// background.js from chrome.storage.local; merges results with the
// shared SLMerge module (lib/merge.js) to produce library.json.
'use strict';

const SERVICES = [
  {id: 'google', name: 'Google Play', color: '#2a78d6'},
  {id: 'amazon', name: 'Prime Video', color: '#eb6834'},
  {id: 'fandango', name: 'Fandango at Home', color: '#1baf7a'},
];

const servicesEl = document.getElementById('services');
const msgEl = document.getElementById('msg');

function stateText(st, res){
  if (!st) return res ? `${res.items.length} titles` : 'not synced yet';
  switch (st.state){
    case 'opening': return 'opening…';
    case 'running': return `scanning… ${st.found ?? 0}${st.expected ? '/' + st.expected : ''}`;
    case 'login':   return 'login needed — sign in, then sync again';
    case 'error':   return 'error: ' + (st.error || 'unknown');
    case 'done':    return `${st.found} titles ✓`;
    default:        return st.state;
  }
}

async function render(){
  const {status = {}, results = {}} = await chrome.storage.local.get(['status', 'results']);
  servicesEl.innerHTML = '';
  for (const s of SERVICES){
    const row = document.createElement('div');
    row.className = 'svc';
    row.innerHTML = `
      <span class="dot" style="background:${s.color}"></span>
      <span class="name">${s.name}<br><span class="st"></span></span>
      <button data-copy="${s.id}" title="Copy JSON for the app's Update dialog">Copy</button>
      <button data-sync="${s.id}" title="Sync just this service">↻</button>`;
    row.querySelector('.st').textContent = stateText(status[s.id], results[s.id]);
    row.querySelector('[data-copy]').disabled = !results[s.id];
    servicesEl.appendChild(row);
  }
  document.getElementById('download').disabled = !Object.keys(results).length;
}

function say(t){ msgEl.textContent = t; }

// First click warns (sync takes over the browser: opens store tabs,
// focuses them, auto-scrolls); second click actually starts.
const syncAllBtn = document.getElementById('syncAll');
let armed = null;
function requestSync(service){
  const key = service || 'all';
  if (armed !== key){
    armed = key;
    if (key === 'all') syncAllBtn.textContent = '▶ Yes — open store tabs & sync';
    say('Heads-up: this opens each store’s library page in new tabs and auto-scrolls while it scans. Click again to start.');
    return;
  }
  armed = null;
  syncAllBtn.textContent = '⟳ Sync all libraries';
  chrome.runtime.sendMessage({cmd: 'sync', service}, r =>
    say(r?.busy ? 'A sync is already running…' : service ? 'Syncing ' + service + '…' : 'Syncing — tabs will open for each store.'));
}

syncAllBtn.addEventListener('click', () => requestSync(undefined));

servicesEl.addEventListener('click', async ev => {
  const b = ev.target.closest('button');
  if (!b) return;
  if (b.dataset.sync){
    requestSync(b.dataset.sync);
  } else if (b.dataset.copy){
    const {results = {}} = await chrome.storage.local.get('results');
    const r = results[b.dataset.copy];
    if (!r) return;
    await navigator.clipboard.writeText(JSON.stringify({service: r.service, items: r.items}));
    say(`Copied ${r.items.length} ${b.dataset.copy} titles — paste into the app's Update dialog.`);
  }
});

document.getElementById('download').addEventListener('click', async () => {
  const {results = {}} = await chrome.storage.local.get('results');
  const payloads = SERVICES.map(s => results[s.id]).filter(Boolean)
    .map(r => ({service: r.service, items: r.items}));
  const items = SLMerge.buildLibrary(payloads);
  const out = {
    generated: new Date().toISOString().slice(0, 10),
    sources: payloads.map(p => p.service),
    items,
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], {type: 'application/json'}));
  a.download = 'library.json';
  a.click();
  say(`library.json: ${items.length} merged titles from ${payloads.length} service(s).`);
});

chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local') render(); });
render();
