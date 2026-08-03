#!/usr/bin/env node
// Headless tests for the shared DOM-collect module (extension/lib/collect.js).
// Cheap parity check: the source still contains the selectors/regexes the
// harvesters and bookmarklets depend on, and each function runs against a
// fake DOM without throwing.
// Run: node tools/test_collect.js
'use strict';
// NOTE: ownedLinks() scoping tests live at the bottom of this file.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
function test(name, fn){ fn(); n++; console.log('  ok', name); }

const srcPath = path.join(__dirname, '..', 'extension', 'lib', 'collect.js');
const src = fs.readFileSync(srcPath, 'utf-8');

test('source contains the Google selector', () => {
  assert.ok(src.includes('a[href*="/store/movies/details"],a[href*="/store/tv/show"]'));
});

test('source contains the Amazon selector and ASIN regex', () => {
  assert.ok(src.includes('a[href*="/gp/video/detail/"]'));
  assert.ok(src.includes('/\\/gp\\/video\\/detail\\/([A-Z0-9]+)/'));
});

test('source contains the Fandango selector and id regex', () => {
  assert.ok(src.includes('a[href*="/content/browse/details/"]'));
  assert.ok(src.includes('/\\/content\\/browse\\/details\\/([^/]+)\\/(\\d+)/'));
});

// Minimal fake DOM: no elements found, just proving each function runs.
global.document = {querySelectorAll: () => []};
const SLCollect = require(srcPath);

test('google() runs against an empty DOM and returns []', () => {
  assert.deepStrictEqual(SLCollect.google(), []);
});

test('amazon() runs against an empty DOM and returns []', () => {
  assert.deepStrictEqual(SLCollect.amazon(false), []);
  assert.deepStrictEqual(SLCollect.amazon(true), []);
});

test('fandango() runs against an empty DOM and returns []', () => {
  assert.deepStrictEqual(SLCollect.fandango(), []);
});

// --- ownedLinks() rail exclusion --------------------------------------
// Store pages put wishlist / "recommended" rails next to the owned grid,
// with identical-looking links. Rails must be excluded — but never at the
// cost of dropping titles the user actually owns.
//
// Fake DOM: an element is {parentElement, kids}; contains() walks down.
function el(parent, tag){
  const e = {parentElement: parent || null, kids: [], tag: tag || '', textContent: ''};
  if (parent) parent.kids.push(e);
  e.contains = x => { for (let p = x; p; p = p.parentElement) if (p === e) return true; return false; };
  e.querySelector = () => e.kids.find(k => k.tag === 'a') || null;
  return e;
}
// sections: [{heading, links}] — heading '' means no heading element.
function page(sections){
  const root = el(null);
  const links = [], headings = [];
  for (const s of sections){
    const box = el(root);
    if (s.heading){
      const h = el(box, 'h2');
      h.textContent = s.heading;
      headings.push(h);
    }
    for (let i = 0; i < s.n; i++) links.push(Object.assign(el(box, 'a'), {href: '/x/' + i, owned: !s.rail}));
  }
  global.document = {
    querySelectorAll: sel => /h1|heading/.test(sel) ? headings : links,
  };
  return links;
}

test('ownedLinks drops a rail identified by its heading', () => {
  page([{heading: 'My Movies', n: 200}, {heading: 'Recommended for you', n: 6, rail: true}]);
  const got = SLCollect.ownedLinks('a');
  assert.strictEqual(got.length, 200);
  assert.ok(got.every(a => a.owned));
});

test('ownedLinks matches wishlist and because-you-watched rails', () => {
  for (const h of ['Your Wishlist', 'Because you watched Alien', 'More like this', 'Trending now']){
    page([{heading: 'My Movies', n: 50}, {heading: h, n: 8, rail: true}]);
    assert.strictEqual(SLCollect.ownedLinks('a').length, 50, h);
  }
});

// The regression the reviewer found: a library split across containers.
test('ownedLinks keeps a library split across sibling sections', () => {
  page([{heading: 'My Movies A-M', n: 55}, {heading: 'My Movies N-Z', n: 5}]);
  assert.strictEqual(SLCollect.ownedLinks('a').length, 60);
});

test('ownedLinks keeps everything when no rail heading is present', () => {
  page([{heading: '', n: 10}, {heading: '', n: 9}]);
  assert.strictEqual(SLCollect.ownedLinks('a').length, 19);
});

test('ownedLinks ignores a rail heading that would swallow most of the page', () => {
  // e.g. a page-level "Browse" banner wrapping everything
  page([{heading: 'Recommended', n: 40, rail: true}, {heading: 'My Movies', n: 10}]);
  assert.strictEqual(SLCollect.ownedLinks('a').length, 50);
});

test('ownedLinks never returns empty', () => {
  page([{heading: 'Recommended for you', n: 12, rail: true}]);
  assert.strictEqual(SLCollect.ownedLinks('a').length, 12);
});

test('ownedLinks matches "You may also like" phrasings', () => {
  for (const h of ['You may also like', 'Customers also liked', 'Suggested for you']){
    page([{heading: 'My Movies', n: 40}, {heading: h, n: 6, rail: true}]);
    assert.strictEqual(SLCollect.ownedLinks('a').length, 40, h);
  }
});

test('ownedLinks does NOT treat "Continue watching" as a rail', () => {
  // It can sit over titles you own and are part-way through.
  page([{heading: 'My Movies', n: 40}, {heading: 'Continue watching', n: 6}]);
  assert.strictEqual(SLCollect.ownedLinks('a').length, 46);
});

test('ownedLinks(selector, true) returns rails too, for diffing', () => {
  page([{heading: 'My Movies', n: 40}, {heading: 'Recommended for you', n: 6, rail: true}]);
  assert.strictEqual(SLCollect.ownedLinks('a', true).length, 46);
  assert.strictEqual(SLCollect.ownedLinks('a').length, 40);
});

global.document = {querySelectorAll: () => []};

console.log('\n' + n + ' tests passed');
