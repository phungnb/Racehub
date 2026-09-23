"""Ghép lớp lên ảnh nền và cắt vùng đầu để soát (tối đa 4 lớp một hàng)."""
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
BOX = {'male': (360, 20, 600, 260), 'female': (340, 70, 600, 330)}


def sheet(files, out, size=400):
    tiles = []
    for f in files:
        g = 'female' if 'female' in Path(f).name else 'male'
        base = Image.open(ROOT / f'public/character/{g}/base.webp').convert('RGBA')
        base.alpha_composite(Image.open(f).convert('RGBA'))
        tiles.append(base.crop(BOX[g]).resize((size, size), Image.LANCZOS))
    s = Image.new('RGB', (size * len(tiles), size))
    for i, t in enumerate(tiles):
        s.paste(t, (i * size, 0))
    s.save(out)


if __name__ == '__main__':
    sheet(sys.argv[2:], sys.argv[1])
