// Tests the Fandango/Vudu JSON-API harvest path against a real captured
// response (tools/fixtures/vudu_contentlist.json, trimmed to the fields
// the harvester reads). Runs the actual harvest/fandango.js in a stubbed
// page so the parsing, paging and credential discovery are exercised.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const fixture = fs.readFileSync(path.join(ROOT, 'tools', 'fixtures', 'vudu_contentlist.json'), 'utf8');
const harvester = fs.readFileSync(path.join(ROOT, 'extension', 'harvest', 'fandango.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra){
  if (cond){ console.log('  ok ' + name); pass++; }
  else { console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); fail++; }
}

function makeStore(obj){
  const keys = Object.keys(obj);
  return {
    length: keys.length,
    key: i => keys[i],
    getItem: k => (k in obj ? obj[k] : null),
  };
}

// Run the harvester with a stubbed page. Returns the 'done' message.
async function run({creds, pages, domItems = [], failApi = false}){
  const messages = [];
  let requests = 0;
  const sandbox = {
    console,
    setTimeout: (fn) => fn(),           // no real waiting
    Promise, JSON, Array, Object, String, Number, Math, Error, encodeURIComponent,
    localStorage: makeStore(creds ? {vudu_session: JSON.stringify(creds)} : {}),
    sessionStorage: makeStore({}),
    chrome: {runtime: {sendMessage: m => messages.push(m)}},
    document: {
      body: {innerText: 'My Movies (202)'},
      querySelectorAll: () => [],
    },
    window: {innerHeight: 800, scrollBy(){}},
    SLCollect: {fandango: () => domItems},
    fetch: async (url, opts) => {
      requests++;
      if (failApi) return {ok: false, status: 500};
      const body = opts.body;
      const offset = +decodeURIComponent(body).match(/offset=(\d+)/)[1];
      const page = pages[offset / 50];
      if (!page) return {ok: true, text: async () => '/*-secure-{"content":[],"moreBelow":["false"]}*/'};
      return {ok: true, text: async () => page};
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  await vm.runInContext(harvester, sandbox);
  await new Promise(r => setImmediate(r));
  return {done: messages.find(m => m.type === 'done'), messages, requests};
}

(async () => {
  const creds = {user: {sessionKey: 'SESSION-ABC*', userId: 15180430}};

  // 1. Real captured response parses into items.
  let r = await run({creds, pages: [fixture]});
  ok('parses the real /*-secure- wrapped response', r.done.payload.items.length === 5,
     'got ' + r.done.payload.items.length);
  const first = r.done.payload.items[0];
  ok('extracts title', first.title === 'Gone with the Wind', first.title);
  ok('builds a details url with the contentId', first.url.endsWith('/gone-with-the-wind/10559'), first.url);
  ok('marks API results as movies', first.tv === false);

  // 2. Paging: keeps going while moreBelow is true.
  const page0 = '/*-secure-' + JSON.stringify({
    content: Array.from({length: 50}, (_, i) => ({contentId: [String(i)], title: ['T' + i]})),
    moreBelow: ['true'],
  }) + '*/';
  const page1 = '/*-secure-' + JSON.stringify({
    content: [{contentId: ['900'], title: ['Last One']}], moreBelow: ['false'],
  }) + '*/';
  r = await run({creds, pages: [page0, page1]});
  ok('pages until moreBelow is false', r.done.payload.items.length === 51, String(r.done.payload.items.length));
  ok('stops requesting after the last page', r.requests === 2, String(r.requests));

  // 3. Credentials discovered regardless of nesting/storage key.
  r = await run({creds: {a: {b: {sessionKey: 'K*', userId: '7'}}}, pages: [fixture]});
  ok('finds sessionKey/userId nested at any depth', r.done.payload.items.length === 5);

  // 4. Fallbacks: no creds, or the API failing, must use the DOM scraper.
  const dom = [{key: '1', title: 'From DOM', url: 'https://athome.fandango.com/content/browse/details/x/1', tv: false}];
  r = await run({creds: null, pages: [fixture], domItems: dom});
  ok('falls back to DOM scraping when no session key is found',
     r.done.payload.items.length === 1 && r.done.payload.items[0].title === 'From DOM');
  r = await run({creds, pages: [fixture], domItems: dom, failApi: true});
  ok('falls back to DOM scraping when the API errors',
     r.done.payload.items.length === 1 && r.done.payload.items[0].title === 'From DOM');

  // 5. Progress reporting carries the expected total from the page header.
  r = await run({creds, pages: [fixture]});
  const prog = r.messages.find(m => m.type === 'progress');
  ok('reports progress with the expected count', prog && prog.expected === 202,
     JSON.stringify(prog));

  console.log('\n' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : ''));
  process.exit(fail ? 1 : 0);
})();
