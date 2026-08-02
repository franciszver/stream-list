#!/usr/bin/env python3
"""Inject a library JSON file into index.template.html -> index.html (single file)."""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
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
payload = json.dumps(data, separators=(',', ':')).replace('</', '<\\/')
out = tpl.replace('__LIBRARY_DATA__', payload).replace('__SHARED_MERGE__', shared).replace('__SHARED_COLLECT__', shared_collect)
with open(os.path.join(ROOT, 'index.html'), 'w', encoding='utf-8') as f:
    f.write(out)
print('index.html written:', len(out), 'bytes,', len(data['items']), 'items')
