# Side-by-side: restyle-<view>-before.png | -after.png for each view -> restyle-compare.png
import sys, os
from PIL import Image, ImageDraw
D = sys.argv[1] if len(sys.argv) > 1 else '/workspace/mp-zen/shots/'
A = sys.argv[2] if len(sys.argv) > 2 else 'after'; B = sys.argv[3] if len(sys.argv) > 3 else 'before'
OUT = sys.argv[4] if len(sys.argv) > 4 else D + 'restyle-compare.png'
views = [v for v in ['garden', 'cove', 'planet', 'camp', 'player', 'underwater'] if os.path.exists(f'{D}restyle-{v}-{A}.png') and os.path.exists(f'{D}restyle-{v}-{B}.png')]
w, h = 640, 360
img = Image.new('RGB', (w * 2 + 6, (h + 4) * len(views) + 30), (18, 18, 22)); dr = ImageDraw.Draw(img)
dr.text((w // 2 - 20, 8), B.upper(), fill=(230, 230, 230)); dr.text((w + 6 + w // 2 - 20, 8), A.upper(), fill=(230, 230, 230))
for i, v in enumerate(views):
    for j, t in enumerate([B, A]):
        im = Image.open(f'{D}restyle-{v}-{t}.png').convert('RGB').resize((w, h), Image.LANCZOS)
        img.paste(im, (j * (w + 6), 30 + i * (h + 4)))
    dr.text((8, 34 + i * (h + 4)), v, fill=(255, 255, 255))
img.save(OUT); print(OUT, len(views))
