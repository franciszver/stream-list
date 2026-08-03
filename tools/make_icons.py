#!/usr/bin/env python3
"""Generate extension/icons/icon{16,32,48,128}.png.

Flat mark: rounded blue square (same blue as the sync badge), white play
triangle over two white "list" bars. Drawn at 512px and downscaled so the
small sizes stay crisp.
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'extension', 'icons')
os.makedirs(OUT, exist_ok=True)

S = 512
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S // 5, fill=(74, 125, 255, 255))
# play triangle, upper area
d.polygon([(176, 122), (176, 310), (356, 216)], fill=(255, 255, 255, 255))
# two list bars under it
d.rounded_rectangle([150, 352, 362, 384], radius=16, fill=(255, 255, 255, 255))
d.rounded_rectangle([150, 412, 300, 444], radius=16, fill=(255, 255, 255, 230))

for size in (128, 48, 32, 16):
    img.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, f'icon{size}.png'))
    print(f'icon{size}.png')
