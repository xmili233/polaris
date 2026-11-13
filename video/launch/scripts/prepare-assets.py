from pathlib import Path
from PIL import Image, ImageDraw
import json

root = Path(__file__).resolve().parents[1]
folder = root / 'public/capture'
layout = json.loads((folder / 'layout.json').read_text())
(root / 'src/layout.json').write_text(json.dumps(layout, indent=2) + '\n')
board = Image.open(folder / 'board.png').convert('RGB')
scale_x, scale_y = board.width / 1320, board.height / 820

def pixels(bounds):
    return tuple(round(value * (scale_x if index % 2 == 0 else scale_y))
                 for index, value in enumerate(bounds))

blank = board.copy()
draw = ImageDraw.Draw(blank)
for x in [116, 428, 740]:
    draw.rectangle(pixels((x, 160, x+272, 780)), fill='#F6F7F9')
for key, r in layout.items():
    bounds = pixels((r['x'], r['y'], r['x']+r['w'], r['y']+r['h']))
    board.crop(bounds).save(folder / f'card-{key}.png')
shell = blank.copy()
draw = ImageDraw.Draw(shell)
for i, x in enumerate([104, 416, 728]):
    bounds = pixels((x, 96, x+296, 796))
    blank.crop(bounds).save(folder / f'lane-{i}.png')
    draw.rectangle(bounds, fill='white')
blank.save(folder / 'board-blank.png')
shell.save(folder / 'shell.png')
for stage in ['first', 'second']:
    for state in ['open', 'selected']:
        output = stage + '-modal' + ('-selected' if state == 'selected' else '') + '.png'
        Image.open(folder / f'{stage}-{state}.png').crop(pixels((220,120,1100,700))).save(folder / output)
