#!/usr/bin/env python3
"""Zip the extension for the Chrome Web Store (or drag-drop install).

Produces dist/stream-list-<version>.zip with manifest.json at the zip root,
which is what the Web Store dashboard and chrome://extensions expect.
Run tools/build.py first so extension/app/ is current.
"""
import json, os, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
EXT = os.path.join(ROOT, 'extension')

with open(os.path.join(EXT, 'manifest.json'), encoding='utf-8') as f:
    version = json.load(f)['version']

dist = os.path.join(ROOT, 'dist')
os.makedirs(dist, exist_ok=True)
out = os.path.join(dist, f'stream-list-{version}.zip')

with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for dirpath, dirnames, filenames in os.walk(EXT):
        for name in sorted(filenames):
            full = os.path.join(dirpath, name)
            z.write(full, os.path.relpath(full, EXT))

names = zipfile.ZipFile(out).namelist()
assert 'manifest.json' in names and 'app/app.html' in names, names
print(f'{out}: {len(names)} files, {os.path.getsize(out)} bytes')
