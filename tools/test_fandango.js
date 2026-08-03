// Tests the Fandango harvester's DOM strategy by running the real
// extension/harvest/fandango.js in a stubbed page.
//
// The behaviour under test is the one the live site broke: the grid
// renders the full library briefly and then REMOVES most of the tiles.
// A harvester that only reads the settled DOM loses them; this one must
// keep everything it ever saw.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const collectSrc = fs.readFileSync(path.join(ROOT, 'extension', 'lib', 'collect.js'), 'utf8');
const harvesterSrc = fs.readFileSync(path.join(ROOT, 'extension', 'harvest', 'fandango.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond){ console.log('  ok ' + name); pass++; }
  else { console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); fail++; }
};

const tile = (id, title, img) => ({
  getAttribute: a => a === 'href' ? `/content/browse/details/${title.toLowerCase().replace(/\W+/g, '-')}/${id}` : null,
  querySelector: () => ({
    alt: title,
    getAttribute: a => (a === 'src' && img) ? img : null,
  }),
  scrollIntoView(){},
});

// Runs the harvester against a page whose tiles change over time.
// `script` is a list of steps: each is the tile array the DOM holds at
// that point. Steps advance on every timer tick the harvester awaits.
async function run({steps, header = 'My Movies (202)', pathname = '/content/browse/mymovies'}){
  const messages = [];
  let step = 0;
  let observer = null;
  const current = () => steps[Math.min(step, steps.length - 1)];

  const sandbox = {
    console, JSON, Array, Object, String, Number, Math, Error, RegExp, Set, Map, Promise,
    encodeURIComponent, decodeURIComponent,
    setTimeout: (fn) => { step++; if (observer) observer(); fn(); return 0; },
    chrome: {runtime: {sendMessage: m => messages.push(m)}},
    MutationObserver: function (cb){ this.observe = () => { observer = cb; }; },
    location: {pathname, href: 'https://athome.fandango.com' + pathname},
    document: {
      readyState: 'complete',
      documentElement: {},
      body: {scrollHeight: 5000, get innerText(){ return header; }},
      querySelectorAll: sel => /button|role=/.test(sel) ? [] : current(),
      addEventListener(){}, removeEventListener(){},
    },
    window: {innerHeight: 800, scrollBy(){}, scrollTo(){}, addEventListener: (n, f) => f()},
  };
  sandbox.window.__proto__ = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(collectSrc.replace(/if \(typeof module[\s\S]*$/, ''), sandbox);
  await vm.runInContext(harvesterSrc, sandbox);
  await new Promise(r => setImmediate(r));
  return {done: messages.find(m => m.type === 'done'), messages};
}

(async () => {
  const many = Array.from({length: 202}, (_, i) => tile(1000 + i, 'Movie ' + i));

  // 1. THE REGRESSION: page starts empty, renders everything, then the app
  // tears it back down to 67. Starting empty matters — if step 0 already
  // held the tiles, the harvester's initial synchronous collect() would
  // pass this test with the observer deleted.
  let r = await run({steps: [[], many, many.slice(0, 67), many.slice(0, 67)]});
  ok('keeps every tile seen even after the page removes them',
     r.done.payload.items.length === 202, 'got ' + r.done.payload.items.length);

  // 2. Gradual virtualized rendering still accumulates.
  r = await run({steps: [many.slice(0, 50), many.slice(50, 120), many.slice(120, 202)]});
  ok('accumulates across successive renders',
     r.done.payload.items.length === 202, 'got ' + r.done.payload.items.length);

  // 3. Stops once the expected count is reached (no endless scrolling).
  r = await run({steps: [many]});
  const scrolls = r.messages.filter(m => m.type === 'progress').length;
  ok('stops promptly once the expected count is reached', scrolls <= 2, 'progress msgs: ' + scrolls);

  // 4. Item shape: title, details url, movie flag.
  const it = r.done.payload.items[0];
  ok('extracts title from the tile', it.title === 'Movie 0', it.title);
  ok('builds the details url', /\/content\/browse\/details\/movie-0\/1000$/.test(it.url), it.url);
  ok('flags movies as movies', it.tv === false);

  // 4b. Tile artwork is captured when the store provides it.
  r = await run({steps: [[tile(5, 'Art Movie', 'https://images2.vudu.com/poster2/5-194')]], header: 'My Movies (1)'});
  ok('captures artwork from the tile', r.done.payload.items[0].img === 'https://images2.vudu.com/poster2/5-194',
     r.done.payload.items[0].img);

  // 5. The TV page marks its titles as TV and reads its own header.
  r = await run({steps: [[tile(7, 'Some Show')]], header: 'My TV (1)', pathname: '/content/browse/mytv'});
  ok('marks titles from the TV page as TV', r.done.payload.items[0].tv === true);
  ok('reads the My TV count', r.done.expected === 1, String(r.done.expected));

  // 6. Empty library terminates instead of hanging.
  r = await run({steps: [[]], header: 'My Movies (0)'});
  ok('handles an empty library', r.done && r.done.payload.items.length === 0);

  console.log('\n' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : ''));
  process.exit(fail ? 1 : 0);
})();
