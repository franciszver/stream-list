#!/usr/bin/env node
// Headless tests for the shared DOM-collect module (extension/lib/collect.js).
// Cheap parity check: the source still contains the selectors/regexes the
// harvesters and bookmarklets depend on, and each function runs against a
// fake DOM without throwing.
// Run: node tools/test_collect.js
'use strict';
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

console.log('\n' + n + ' tests passed');
