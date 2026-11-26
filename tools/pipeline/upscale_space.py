# Real-ESRGAN (ncnn-vulkan, runs on lavapipe CPU Vulkan on the box) -> resize -> KTX2 ETC1S sRGB, listed in ktx2.json.
# Only for textures that look blurry when seen large: the Earth day map and the Moon map (space flight).
# usage: python3 -P upscale_space.py REPO [--skip-esrgan]   (heavy: ~40 min CPU; run alone)
# Not for normal/ARM/lightmaps or the sky photos (ESRGAN invents detail there).
import json, os, subprocess, sys, tempfile
from PIL import Image
repo = sys.argv[1]; A = repo + '/assets/'
BIN = os.environ.get('REALESRGAN', 'realesrgan-ncnn-vulkan')  # path to the ncnn-vulkan binary (its models/ folder beside it)
W = os.path.join(tempfile.gettempdir(), 'esr'); os.makedirs(W, exist_ok=True)
# source webp -> [(ktx2 name, output size)]
JOBS = {'space/earth-pc': [('space/earth-pc', (4096, 2048)), ('space/earth-phone', (2048, 1024))],
        'space/moon': [('space/moon', (2048, 1024))]}
ETC1S_SRGB = ['--format', 'R8G8B8_SRGB', '--encode', 'basis-lz', '--clevel', '4', '--qlevel', '230']
made = []
for src, outs in JOBS.items():
    tag = src.split('/')[-1]; inp = f'{W}/{tag}.png'; up = f'{W}/{tag}-x4.png'
    Image.open(A + src + '.webp').convert('RGB').save(inp)
    if '--skip-esrgan' not in sys.argv or not os.path.exists(up):
        subprocess.run([BIN, '-i', inp, '-o', up, '-n', 'realesrgan-x4plus', '-t', '256', '-j', '1:2:1'], check=True,
                       cwd=os.path.dirname(BIN) or None, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    big = Image.open(up).convert('RGB')
    for name, size in outs:
        # three loads the WebP with flipY=true; KTX2 uploads unflipped, so flip here (same as ktx2/convert.py)
        im = big.resize(size, Image.LANCZOS).transpose(Image.FLIP_TOP_BOTTOM)
        with tempfile.TemporaryDirectory() as d:
            im.save(d + '/i.png')
            subprocess.run(['ktx', 'create', '--generate-mipmap', '--threads', '2', *ETC1S_SRGB, d + '/i.png', A + name + '.ktx2'], check=True)
        im.transpose(Image.FLIP_TOP_BOTTOM).save(f'{W}/{name.split("/")[-1]}-final.png')
        made.append(name + '.ktx2'); print(name, size, os.path.getsize(A + name + '.ktx2') // 1024, 'KB')
m = json.load(open(A + 'ktx2.json'))
m['files'] += [f for f in made if f not in m['files']]
json.dump(m, open(A + 'ktx2.json', 'w'), indent=0)
