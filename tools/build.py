#!/usr/bin/env python3
"""Build Stream List from index.template.html.

Outputs:
  index.html                 single-file app with the library JSON inlined
  extension/app/app.html+js  same app as an MV3 extension page (CSP forbids
                             inline scripts, so the main script is extracted
                             to app.js and merge.js is loaded from ../lib/;
                             ships empty — the library fills from sync)
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')

MERGE_BLOCK = """<script>
/* Shared merge logic (extension/lib/merge.js), inlined by tools/build.py */
__SHARED_MERGE__
</script>"""
MAIN_OPEN = "<script>\n'use strict';"

if len(sys.argv) > 1:
    lib_path = sys.argv[1]
else:
    default_lib = os.path.join(ROOT, 'library.json')
    lib_path = default_lib if os.path.exists(default_lib) else os.path.join(ROOT, 'library.sample.json')
print('using library file:', lib_path)
with open(lib_path, encoding='utf-8') as f:
    data = json.load(f)
with open(os.path.join(ROOT, 'index.template.html'), encoding='utf-8') as f:
    tpl = f.read()
with open(os.path.join(ROOT, 'extension', 'lib', 'merge.js'), encoding='utf-8') as f:
    shared = f.read().replace('</', '<\\/')
with open(os.path.join(ROOT, 'extension', 'lib', 'collect.js'), encoding='utf-8') as f:
    shared_collect = f.read().replace('</', '<\\/')

# --- index.html (single file, library inlined) ---
payload = json.dumps(data, separators=(',', ':')).replace('</', '<\\/')
out = tpl.replace('__LIBRARY_DATA__', payload).replace('__SHARED_MERGE__', shared).replace('__SHARED_COLLECT__', shared_collect)
with open(os.path.join(ROOT, 'index.html'), 'w', encoding='utf-8') as f:
    f.write(out)
print('index.html written:', len(out), 'bytes,', len(data['items']), 'items')

# --- extension/app/ (CSP-safe split; empty library, filled by sync) ---
empty = json.dumps({'generated': 'never', 'items': [], 'sample': False}, separators=(',', ':'))
app = tpl.replace('__LIBRARY_DATA__', empty).replace('__SHARED_COLLECT__', shared_collect)
if MERGE_BLOCK not in app:
    sys.exit('build.py: merge script block not found in template — marker drifted?')
app = app.replace(MERGE_BLOCK, '<script src="../lib/merge.js"></script>')
start = app.index(MAIN_OPEN)
end = app.index('</script>', start)
app_js = app[start + len('<script>\n'):end]
app_html = app[:start] + '<script src="app.js"></script>' + app[end + len('</script>'):]
app_dir = os.path.join(ROOT, 'extension', 'app')
os.makedirs(app_dir, exist_ok=True)
with open(os.path.join(app_dir, 'app.html'), 'w', encoding='utf-8') as f:
    f.write(app_html)
with open(os.path.join(app_dir, 'app.js'), 'w', encoding='utf-8') as f:
    f.write(app_js)
print('extension/app written:', len(app_html), '+', len(app_js), 'bytes')
