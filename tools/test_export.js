// Test suite for Stream List standalone searchable HTML export
'use strict';
const assert = require('assert');
const SLMerge = require('../extension/lib/merge.js');

let n = 0;
function test(name, fn){ fn(); n++; console.log('  ok', name); }

const sampleLibrary = [
  {
    id: 'inception-2010',
    title: 'Inception',
    type: 'movie',
    year: 2010,
    services: {
      google: [{url: 'https://play.google.com/store/movies/details?id=123'}],
      amazon: [{url: 'https://www.amazon.com/gp/video/detail/B0047WJ11G'}]
    },
    serviceCount: 2
  },
  {
    id: 'breaking-bad-tv',
    title: 'Breaking Bad',
    type: 'tv',
    year: 2008,
    services: {
      fandango: [{url: 'https://athome.fandango.com/content/browse/details/Breaking-Bad/12345'}]
    },
    serviceCount: 1,
    storeHint: true
  }
];

const sampleFlags = {'inception-2010': {w: 1, q: 0}, 'breaking-bad-tv': {w: 0, q: 1}};
const samplePosters = {'inception-2010': 'https://image.tmdb.org/t/p/w342/inception.jpg'};
const sampleMeta = {'inception-2010': {year: 2010, genre: 'Sci-Fi'}};

test('buildExportHtml is exported and callable', () => {
  assert.strictEqual(typeof SLMerge.buildExportHtml, 'function');
});

test('buildExportHtml returns valid HTML starting with doctype', () => {
  const html = SLMerge.buildExportHtml({
    generated: '2026-08-18',
    library: sampleLibrary,
    flags: sampleFlags,
    posters: samplePosters,
    meta: sampleMeta
  });
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('<html lang="en">'));
  assert.ok(html.includes('<meta name="viewport" content="width=device-width, initial-scale=1.0">'));
  assert.ok(html.includes('</html>'));
});

test('buildExportHtml embeds full library data, flags, posters, and meta', () => {
  const html = SLMerge.buildExportHtml({
    generated: '2026-08-18',
    library: sampleLibrary,
    flags: sampleFlags,
    posters: samplePosters,
    meta: sampleMeta
  });
  // Must embed the data script
  assert.ok(html.includes('<script id="export-data" type="application/json">'));
  const match = html.match(/<script id="export-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'export-data script tag found');
  const parsed = JSON.parse(match[1]);
  assert.strictEqual(parsed.generated, '2026-08-18');
  assert.strictEqual(parsed.items.length, 2);
  assert.strictEqual(parsed.items[0].title, 'Inception');
  assert.strictEqual(parsed.flags['inception-2010'].w, 1);
  assert.strictEqual(parsed.posters['inception-2010'], 'https://image.tmdb.org/t/p/w342/inception.jpg');
  assert.strictEqual(parsed.meta['inception-2010'].genre, 'Sci-Fi');
});

test('buildExportHtml safely escapes </script> tags in item titles or notes', () => {
  const maliciousLib = [
    {
      id: 'xss-test',
      title: 'Evil </script><script>alert("xss")</script>',
      type: 'movie',
      year: 2024,
      services: {google: [{url: 'https://play.google.com/test', note: '</script><script>'}]},
      serviceCount: 1
    }
  ];
  const html = SLMerge.buildExportHtml({
    generated: '2026-08-18',
    library: maliciousLib,
    flags: {},
    posters: {},
    meta: {}
  });
  // Check that no unescaped </script> breaks the JSON container early
  const parts = html.split('<script id="export-data" type="application/json">');
  assert.strictEqual(parts.length, 2);
  const afterTag = parts[1];
  const endIdx = afterTag.indexOf('</script>');
  const insideJson = afterTag.slice(0, endIdx);
  assert.ok(!insideJson.includes('</script>'), 'no raw </script> inside JSON tag');
  const unescapedParsed = JSON.parse(insideJson.replace(/<\\\/script>/g, '</script>').replace(/<\\\//g, '</'));
  assert.strictEqual(unescapedParsed.items[0].title, 'Evil </script><script>alert("xss")</script>');
});

test('buildExportHtml has balanced script tags', () => {
  const html = SLMerge.buildExportHtml({
    generated: '2026-08-18',
    library: sampleLibrary,
    flags: sampleFlags,
    posters: samplePosters,
    meta: sampleMeta
  });
  const openCount = (html.match(/<script\b/g) || []).length;
  const closeCount = (html.match(/<\/script>/g) || []).length;
  assert.strictEqual(openCount, closeCount, `Script tags must balance: ${openCount} open, ${closeCount} close`);
});

test('buildExportHtml excludes sensitive extension/update UI controls', () => {
  const html = SLMerge.buildExportHtml({
    generated: '2026-08-18',
    library: sampleLibrary,
    flags: {},
    posters: {},
    meta: {}
  });
  // Search and view controls must be present
  assert.ok(html.includes('id="search"'));
  assert.ok(html.includes('id="sort"'));
  assert.ok(html.includes('id="viewToggle"'));
  assert.ok(html.includes('id="statsToggle"'));
  assert.ok(html.includes('id="chips"'));
  assert.ok(html.includes('id="grid"'));
  assert.ok(html.includes('id="detail"'));
  // Update dialog and sync buttons should be excluded from the standalone export viewer
  assert.ok(!html.includes('id="syncBtn"'));
  assert.ok(!html.includes('id="updateBtn"'));
  assert.ok(!html.includes('id="exportBtn"'));
  assert.ok(!html.includes('id="mergeBtn"'));
  assert.ok(!html.includes('id="importBtn"'));
  assert.ok(!html.includes('tmdbKey'));
});

test('buildExportHtml generates full page from sample library', () => {
  const fs = require('fs');
  const path = require('path');
  const sample = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'library.sample.json'), 'utf8'));
  const html = SLMerge.buildExportHtml({
    generated: sample.generated,
    library: sample.items,
    flags: {'inception': {w: 1, q: 0}},
    posters: {},
    meta: {}
  });
  assert.ok(html.includes('Inception'));
  assert.ok(html.includes('Casablanca'));
  assert.ok(html.includes('id="grid"'));
  assert.ok(html.includes('id="search"'));
  assert.ok(html.includes('id="detail"'));
});

console.log(`\n${n} test_export tests passed`);
