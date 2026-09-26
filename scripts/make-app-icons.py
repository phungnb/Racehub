#!/usr/bin/env python3
"""Sinh icon + màn chờ cho app cài (android/, ios/) từ icon thương hiệu trong public/icons.

Chạy lại mỗi khi đổi logo:  python3 scripts/make-app-icons.py [ảnh-nguồn-1024.png]
Nên dùng ảnh nguồn vuông 1024×1024 (App Store yêu cầu icon 1024). Mặc định dùng rh5-maskable-512.png.
"""
import os
import sys
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'public/icons/rh5-maskable-512.png')
MARK = os.path.join(ROOT, 'public/icons/rh5-mark-256.png')
BG = (10, 13, 18)          # --color-bg
RES = os.path.join(ROOT, 'android/app/src/main/res')

icon = Image.open(SRC).convert('RGB')
brand = icon.getpixel((icon.width // 2, 4))   # màu nền xanh của icon — dùng làm nền adaptive icon Android


def save(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)


def sized(img, n):
    return img.resize((n, n), Image.LANCZOS)


# iOS: một icon 1024 không trong suốt (Xcode tự sinh các cỡ khác)
save(sized(icon, 1024), os.path.join(ROOT, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'))

# Android: icon thường, icon tròn, lớp trước của adaptive icon (108dp, phần giữa 72dp là vùng an toàn)
DENS = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
for d, k in DENS.items():
    n = round(48 * k)
    save(sized(icon, n), f'{RES}/mipmap-{d}/ic_launcher.png')
    mask = Image.new('L', (n * 4, n * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, n * 4 - 1, n * 4 - 1), fill=255)
    rnd = sized(icon, n).convert('RGBA')
    rnd.putalpha(mask.resize((n, n), Image.LANCZOS))
    save(rnd, f'{RES}/mipmap-{d}/ic_launcher_round.png')
    f = round(108 * k)
    fg = Image.new('RGB', (f, f), brand)
    inner = f   # icon maskable đã chừa sẵn vùng an toàn → phủ kín lớp 108dp, launcher chỉ hiện phần giữa
    fg.paste(sized(icon, inner), ((f - inner) // 2, (f - inner) // 2))
    save(fg, f'{RES}/mipmap-{d}/ic_launcher_foreground.png')

with open(f'{RES}/values/ic_launcher_background.xml', 'w') as fh:
    fh.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#%02X%02X%02X</color>\n</resources>\n' % brand)

# Màn chờ: nền tối + biểu tượng người chạy ở giữa
mark = Image.open(MARK).convert('RGBA')


def splash(w, h):
    img = Image.new('RGB', (w, h), BG)
    m = round(min(w, h) * 0.28)
    mk = mark.resize((m, m), Image.LANCZOS)
    img.paste(mk, ((w - m) // 2, (h - m) // 2), mk)
    return img


for name in ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']:
    save(splash(2732, 2732), os.path.join(ROOT, 'ios/App/App/Assets.xcassets/Splash.imageset', name))
for folder in os.listdir(RES):
    p = os.path.join(RES, folder, 'splash.png')
    if folder.startswith('drawable') and os.path.exists(p):
        w, h = Image.open(p).size
        save(splash(w, h), p)
print('Đã sinh icon + màn chờ từ', os.path.relpath(SRC, ROOT))
