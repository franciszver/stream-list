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

// --- ownedLinks() scoping ---------------------------------------------
// Store pages put wishlist / "recommended" rails next to the owned grid,
// with identical-looking links. Only the grid's links may be harvested.
//
// Fake DOM: an element is {parentElement, kids}; contains() walks down.
function el(parent){
  const e = {parentElement: parent || null, kids: []};
  if (parent) parent.kids.push(e);
  e.contains = x => { for (let p = x; p; p = p.parentElement) if (p === e) return true; return false; };
  return e;
}
function page({owned, rail}){
  const root = el(null), grid = el(root), sidebar = el(root);
  const links = [];
  for (let i = 0; i < owned; i++) links.push(Object.assign(el(grid), {href: '/owned/' + i, tag: 'owned'}));
  for (let i = 0; i < rail; i++) links.push(Object.assign(el(sidebar), {href: '/rail/' + i, tag: 'rail'}));
  global.document = {querySelectorAll: () => links};
  return links;
}

test('ownedLinks keeps the grid and drops a recommendation rail', () => {
  page({owned: 200, rail: 6});
  const got = SLCollect.ownedLinks('a');
  assert.strictEqual(got.length, 200);
  assert.ok(got.every(a => a.tag === 'owned'));
});

test('ownedLinks keeps everything when no container dominates', () => {
  page({owned: 10, rail: 9}); // 10/19 — below the 70% bar, so don't guess
  assert.strictEqual(SLCollect.ownedLinks('a').length, 19);
});

test('ownedLinks leaves small pages alone', () => {
  page({owned: 4, rail: 2});
  assert.strictEqual(SLCollect.ownedLinks('a').length, 6);
});

test('ownedLinks is a no-op when every link is in the grid', () => {
  page({owned: 50, rail: 0});
  assert.strictEqual(SLCollect.ownedLinks('a').length, 50);
});

global.document = {querySelectorAll: () => []};

console.log('\n' + n + ' tests passed');
