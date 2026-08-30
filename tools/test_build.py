#!/usr/bin/env python3
"""Regression checks on build.py output: the extension app page must be
MV3-CSP-safe (no inline executable scripts, no inline event handlers) and
both builds must carry the shared logic. Run after tools/build.py."""
import os, re, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
def read(*p):
    with open(os.path.join(ROOT, *p), encoding='utf-8') as f:
        return f.read()

app_html = read('extension', 'app', 'app.html')
app_js = read('extension', 'app', 'app.js')
index = read('index.html')
fails = []

# 1. No inline event handlers anywhere in the generated markup (CSP).
for name, html in (('app.html', app_html), ('index.html', index)):
    hits = re.findall(r'\son(?:click|error|load|change|input|submit)\s*=', html)
    if hits:
        fails.append(f'{name}: inline event handlers present: {hits}')

# 2. Every <script> in app.html is either external or non-executable.
for tag in re.findall(r'<script\b[^>]*>', app_html):
    if 'src=' in tag or 'application/json' in tag or 'text/plain' in tag:
        continue
    fails.append(f'app.html: executable inline script tag: {tag}')

# 3. app.js is the extracted main script; merge loads as a file, not inline.
if "'use strict';" not in app_js or 'IS_EXT' not in app_js:
    fails.append('app.js: main script not extracted correctly')
if '../lib/merge.js' not in app_html:
    fails.append('app.html: merge.js not referenced')
if 'const SLMerge' in app_html or 'const SLMerge' in app_js:
    fails.append('extension app: merge logic inlined instead of loaded from lib/')

# 4. index.html keeps the single-file contract: merge inlined, data embedded.
# (Placeholders sit alone on a line or inside a tag; merge.js's header
# comment legitimately *mentions* one, so match unsubstituted forms only.)
def unreplaced(html):
    return re.search(r'(^__SHARED_(MERGE|COLLECT)__$|>__LIBRARY_DATA__<)', html, re.M)
if 'const SLMerge' not in index:
    fails.append('index.html: shared merge logic missing')
if unreplaced(index):
    fails.append('index.html: unreplaced placeholder')
if unreplaced(app_html):
    fails.append('app.html: unreplaced placeholder')

# 5. Extension app ships empty (fills from sync), standalone ships the library.
if '"items":[]' not in app_html:
    fails.append('app.html: expected an empty embedded library')

# 6. Script-extraction integrity: a mis-split (</script> inside the main
# script) leaves unbalanced tags in app.html and script tags in app.js.
if app_html.count('<script') != app_html.count('</script>'):
    fails.append('app.html: unbalanced script tags (extraction mis-split?)')
if '<script' in app_js:
    fails.append('app.js: contains a script tag (extraction mis-split?)')

# 7. Export button integrity: export buttons exist in markup and are wired.
if 'id="exportBtn"' not in app_html or 'id="exportBtn"' not in index:
    fails.append('exportBtn missing from app.html or index.html')
if 'id="exportHtmlBtn"' not in app_html or 'id="exportHtmlBtn"' not in index:
    fails.append('exportHtmlBtn missing from app.html or index.html')
if 'exportHtml' not in app_js:
    fails.append('app.js: exportHtml wiring missing')

for f_ in fails:
    print('FAIL:', f_)
print('7/7 groups OK' if not fails else f'{len(fails)} failure(s)')
sys.exit(1 if fails else 0)
