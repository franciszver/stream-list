#!/usr/bin/env node
// Headless tests for the shared merge module (extension/lib/merge.js).
// Run: node tools/test_merge.js
'use strict';
const assert = require('assert');
const SLMerge = require('../extension/lib/merge.js');

let n = 0;
function test(name, fn){ fn(); n++; console.log('  ok', name); }

test('norm strips year, edition, punctuation, trailing article', () => {
  assert.strictEqual(SLMerge.norm('Blade Runner (1982) [Final Cut]'), 'blade runner');
  assert.strictEqual(SLMerge.norm("Superman: The Movie (Extended Cut)"), 'superman the movie');
  assert.strictEqual(SLMerge.norm("Heat (Director's Cut)"), 'heat');
  assert.strictEqual(SLMerge.norm('Matrix, The'), 'matrix');
});

test('keyOf separates movie from tv', () => {
  assert.notStrictEqual(SLMerge.keyOf('Fargo', true), SLMerge.keyOf('Fargo', false));
});

test('makeEntry extracts year and cleans title', () => {
  const e = SLMerge.makeEntry({title: 'Dune (2021)', url: 'https://x/1'}, 'google');
  assert.strictEqual(e.title, 'Dune');
  assert.strictEqual(e.year, 2021);
  assert.strictEqual(e.type, 'movie');
  assert.deepStrictEqual(e.services, {google: [{url: 'https://x/1'}]});
});

test('same title on two services merges to ONE entry with both links', () => {
  const items = SLMerge.buildLibrary([
    {service: 'google', items: [{title: 'Inception (2010)', url: 'https://g/inception'}]},
    {service: 'amazon', items: [{title: 'Inception', url: 'https://a/inception'}]},
  ]);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].serviceCount, 2);
  assert.strictEqual(items[0].services.google[0].url, 'https://g/inception');
  assert.strictEqual(items[0].services.amazon[0].url, 'https://a/inception');
});

test('edition variants merge (Unrated vs plain)', () => {
  const items = SLMerge.buildLibrary([
    {service: 'amazon', items: [{title: 'Daredevil (Unrated)', url: 'https://a/dd'}]},
    {service: 'fandango', items: [{title: 'Daredevil', url: 'https://f/dd'}]},
  ]);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].serviceCount, 2);
});

test('tv and movie with same name stay separate', () => {
  const items = SLMerge.buildLibrary([
    {service: 'google', items: [{title: 'Fargo', url: 'https://g/m'}]},
    {service: 'amazon', items: [{title: 'Fargo', url: 'https://a/t', tv: true}]},
  ]);
  assert.strictEqual(items.length, 2);
  assert.deepStrictEqual(items.map(i => i.type).sort(), ['movie', 'tv']);
});

test('duplicate item on the SAME service is not double-linked', () => {
  const byNorm = {};
  const r1 = SLMerge.mergeInto(byNorm, {service: 'google', items: [
    {title: 'Up (2009)', url: 'https://g/up'},
    {title: 'Up', url: 'https://g/up2'},
  ]});
  assert.strictEqual(r1.added.length, 1);
  assert.strictEqual(r1.linked.length, 0);
  assert.strictEqual(byNorm['up'].services.google.length, 1);
});

test('mergeInto reports linked (not added) for known titles', () => {
  const byNorm = {};
  SLMerge.mergeInto(byNorm, {service: 'google', items: [{title: 'Alien', url: 'https://g/alien'}]});
  const r = SLMerge.mergeInto(byNorm, {service: 'fandango', items: [{title: 'Alien (1979)', url: 'https://f/alien'}]});
  assert.strictEqual(r.added.length, 0);
  assert.strictEqual(r.linked.length, 1);
  assert.strictEqual(r.linked[0].serviceCount, 2);
});

test('items without title or url are skipped', () => {
  const items = SLMerge.buildLibrary([
    {service: 'google', items: [{title: '', url: 'https://g/x'}, {title: 'Real', url: ''}, null, {title: 'Ok', url: 'https://g/ok'}]},
  ]);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].title, 'Ok');
});

test('buildLibrary output is sorted by title', () => {
  const items = SLMerge.buildLibrary([
    {service: 'google', items: [{title: 'Zodiac', url: 'https://g/z'}, {title: 'Amélie', url: 'https://g/a'}]},
  ]);
  assert.deepStrictEqual(items.map(i => i.title), ['Amélie', 'Zodiac']);
});

// ---------- mergeLibraries (item-shape library merging) ----------

test('mergeLibraries: new title (by id) is added', () => {
  const current = [{id: 'a', title: 'Alien', type: 'movie', year: 1979, services: {google: [{url: 'https://g/a'}]}, serviceCount: 1}];
  const incoming = [{id: 'b', title: 'Brazil', type: 'movie', year: 1985, services: {amazon: [{url: 'https://a/b'}]}, serviceCount: 1}];
  const res = SLMerge.mergeLibraries(current, incoming);
  assert.strictEqual(res.added, 1);
  assert.strictEqual(res.linked, 0);
  assert.strictEqual(res.items.length, 2);
});

test('mergeLibraries: matching id unions service links and recomputes serviceCount', () => {
  const current = [{id: 'alien', title: 'Alien', type: 'movie', year: 1979, services: {google: [{url: 'https://g/alien'}]}, serviceCount: 1}];
  const incoming = [{id: 'alien', title: 'Alien', type: 'movie', year: 1979, services: {amazon: [{url: 'https://a/alien'}]}, serviceCount: 1}];
  const res = SLMerge.mergeLibraries(current, incoming);
  assert.strictEqual(res.added, 0);
  assert.strictEqual(res.linked, 1);
  assert.strictEqual(res.items.length, 1);
  assert.strictEqual(res.items[0].serviceCount, 2);
  assert.strictEqual(res.items[0].services.google[0].url, 'https://g/alien');
  assert.strictEqual(res.items[0].services.amazon[0].url, 'https://a/alien');
});

test('mergeLibraries: no id match falls back to keyOf(title, tv)', () => {
  const current = [{id: 'x1', title: 'Dune (2021)', type: 'movie', year: 2021, services: {google: [{url: 'https://g/dune'}]}, serviceCount: 1}];
  const incoming = [{id: 'x2', title: 'Dune', type: 'movie', year: 2021, services: {fandango: [{url: 'https://f/dune'}]}, serviceCount: 1}];
  const res = SLMerge.mergeLibraries(current, incoming);
  assert.strictEqual(res.added, 0);
  assert.strictEqual(res.linked, 1);
  assert.strictEqual(res.items.length, 1);
  assert.strictEqual(res.items[0].serviceCount, 2);
});

test('mergeLibraries: same title different type (movie vs tv) stay separate', () => {
  const current = [{id: 'fargo', title: 'Fargo', type: 'movie', year: 1996, services: {google: [{url: 'https://g/fargo'}]}, serviceCount: 1}];
  const incoming = [{id: 'fargo-tv', title: 'Fargo', type: 'tv', year: 2014, services: {amazon: [{url: 'https://a/fargo'}]}, serviceCount: 1}];
  const res = SLMerge.mergeLibraries(current, incoming);
  assert.strictEqual(res.added, 1);
  assert.strictEqual(res.items.length, 2);
});

test('mergeLibraries: duplicate url on same service is not double-added', () => {
  const current = [{id: 'up', title: 'Up', type: 'movie', year: 2009, services: {google: [{url: 'https://g/up'}]}, serviceCount: 1}];
  const incoming = [{id: 'up', title: 'Up', type: 'movie', year: 2009, services: {google: [{url: 'https://g/up'}]}, serviceCount: 1}];
  const res = SLMerge.mergeLibraries(current, incoming);
  assert.strictEqual(res.linked, 0);
  assert.strictEqual(res.items[0].services.google.length, 1);
});

test('mergeLibraries: does not mutate the input current array/entries', () => {
  const current = [{id: 'a', title: 'A', type: 'movie', year: 2000, services: {google: [{url: 'https://g/a'}]}, serviceCount: 1}];
  const currentCopy = JSON.parse(JSON.stringify(current));
  SLMerge.mergeLibraries(current, [{id: 'a', title: 'A', type: 'movie', year: 2000, services: {amazon: [{url: 'https://a/a'}]}, serviceCount: 1}]);
  assert.deepStrictEqual(current, currentCopy);
});

test('mergeLibraries: multiple id-less incoming items are all kept (no undefined-id collision)', () => {
  const res = SLMerge.mergeLibraries([], [{title: 'Foo'}, {title: 'Bar'}, {title: 'Baz'}]);
  assert.strictEqual(res.added, 3);
  assert.strictEqual(res.items.length, 3);
  assert.deepStrictEqual(res.items.map(i => i.title).sort(), ['Bar', 'Baz', 'Foo']);
  assert.ok(res.items.every(i => i.id));            // ids synthesized
  assert.strictEqual(new Set(res.items.map(i => i.id)).size, 3); // and distinct
});

test('mergeLibraries: id-less incoming still dedupes against existing by title', () => {
  const current = [{id: 'inception', title: 'Inception', type: 'movie', year: 2010, services: {google: [{url: 'https://g/i'}]}, serviceCount: 1}];
  const res = SLMerge.mergeLibraries(current, [{title: 'Inception (2010)', services: {amazon: [{url: 'https://a/i'}]}}]);
  assert.strictEqual(res.added, 0);
  assert.strictEqual(res.linked, 1);
  assert.strictEqual(res.items.length, 1);
  assert.strictEqual(res.items[0].serviceCount, 2);
});

// --- store artwork fallback -------------------------------------------

test('storePoster derives Fandango artwork from the details url', () => {
  const e = {services: {fandango: [{url: 'https://athome.fandango.com/content/browse/details/example-film/12345'}]}};
  assert.strictEqual(SLMerge.storePoster(e), 'https://images2.vudu.com/poster2/12345-194');
});

test('storePoster prefers artwork captured at harvest time', () => {
  const e = {poster: 'https://cdn.example/x.jpg',
    services: {fandango: [{url: 'https://athome.fandango.com/content/browse/details/example-film/12345'}]}};
  assert.strictEqual(SLMerge.storePoster(e), 'https://cdn.example/x.jpg');
});

test('storePoster returns empty when nothing is derivable', () => {
  assert.strictEqual(SLMerge.storePoster({services: {google: [{url: 'https://play.google.com/store/movies/details?id=x'}]}}), '');
  assert.strictEqual(SLMerge.storePoster({}), '');
});

test('makeEntry keeps artwork harvested from the store tile', () => {
  const e = SLMerge.makeEntry({title: 'X', url: 'https://u', img: 'https://img/1.jpg'}, 'amazon');
  assert.strictEqual(e.poster, 'https://img/1.jpg');
});

test('makeEntry omits poster when the tile had no artwork', () => {
  assert.strictEqual('poster' in SLMerge.makeEntry({title: 'X', url: 'https://u'}, 'amazon'), false);
});

// --- store-suggestion hint (partial ownership) ------------------------

test('makeEntry flags a store-suggestion tile', () => {
  const e = SLMerge.makeEntry({title: 'X', url: 'https://u', store: true}, 'amazon');
  assert.strictEqual(e.storeHint, true);
});

test('makeEntry leaves storeHint unset for a fully-owned tile', () => {
  assert.strictEqual('storeHint' in SLMerge.makeEntry({title: 'X', url: 'https://u', store: false}, 'amazon'), false);
});

test('mergeInto sets storeHint on an existing entry when the tile now suggests a purchase', () => {
  const byNorm = {};
  SLMerge.mergeInto(byNorm, {service: 'amazon', items: [{title: 'Show', url: 'https://a/s', tv: true}]});
  SLMerge.mergeInto(byNorm, {service: 'amazon', items: [{title: 'Show', url: 'https://a/s', tv: true, store: true}]});
  assert.strictEqual(byNorm[SLMerge.keyOf('Show', true)].storeHint, true);
});

test('mergeInto clears storeHint once you own the rest (store:false)', () => {
  const byNorm = {};
  SLMerge.mergeInto(byNorm, {service: 'amazon', items: [{title: 'Show', url: 'https://a/s', tv: true, store: true}]});
  SLMerge.mergeInto(byNorm, {service: 'amazon', items: [{title: 'Show', url: 'https://a/s', tv: true, store: false}]});
  assert.strictEqual('storeHint' in byNorm[SLMerge.keyOf('Show', true)], false);
});

test('mergeInto leaves storeHint alone when a collector omits the field', () => {
  const byNorm = {};
  SLMerge.mergeInto(byNorm, {service: 'amazon', items: [{title: 'Show', url: 'https://a/s', tv: true, store: true}]});
  SLMerge.mergeInto(byNorm, {service: 'fandango', items: [{title: 'Show', url: 'https://f/s', tv: true}]});
  assert.strictEqual(byNorm[SLMerge.keyOf('Show', true)].storeHint, true);
});

console.log(`\n${n} tests passed`);
