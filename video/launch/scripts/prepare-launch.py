"""Crops cards, lanes, the Agent rail and dialogs out of the launch captures.

Scenes load these small pieces instead of mounting a full 4K capture for every
moving element. Run after scripts/capture-launch.mjs: python3 scripts/prepare-launch.py [en|zh-Hans]
"""
from pathlib import Path
import json
import math
import re
import shutil
import sys

from PIL import Image

root = Path(__file__).resolve().parents[1]
folder = root / 'public/v3' / (sys.argv[1] if len(sys.argv) > 1 else 'en')
layout = json.loads((folder / 'layout.json').read_text())
scale = layout['scale']
pieces = folder / 'pieces'
shutil.rmtree(pieces, ignore_errors=True)


def slug(value):
    return re.sub(r'[^a-z0-9]+', '-', value.lower()).strip('-')


def crop(image, rect):
    left, top = math.floor(rect['x'] * scale), math.floor(rect['y'] * scale)
    right, bottom = math.ceil((rect['x'] + rect['w']) * scale), math.ceil((rect['y'] + rect['h']) * scale)
    return image.crop((left, top, right, bottom))


count = 0
for state, data in layout['states'].items():
    image = Image.open(folder / f'{state}.png').convert('RGB')
    target = pieces / state
    target.mkdir(parents=True, exist_ok=True)
    for kind in ['cards', 'lanes']:
        for rect in data[kind]:
            crop(image, rect).save(target / f'{kind[:-1]}-{slug(rect["id"])}.png')
            count += 1
    for rect in data.get('agents', []):
        crop(image, rect).save(target / f'agent-{slug(rect["id"])}.png')
        count += 1
    for kind in ['rail', 'modal']:
        if data.get(kind):
            crop(image, data[kind]).save(target / f'{kind}.png')
            count += 1
print(f'Prepared {count} pieces in {pieces.relative_to(root)}')
