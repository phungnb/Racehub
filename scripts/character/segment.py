"""Sinh tài nguyên nhân vật 2D (ADR-017, docs/NHAN_VAT.md).

Từ ảnh gốc public/avatars/runner_<giới tính>.png tạo ra, trong public/character/<giới tính>/:
  base.webp                      ảnh nhân vật đúng KHUNG CHUẨN (FRAME_W x FRAME_H)
  top.png bottom.png socks.png shoes.png
                                 mặt nạ xám cùng khung: trắng = vùng được đổi màu, đen = giữ nguyên

Chạy lại khi thay ảnh gốc:  pip install pillow numpy && python3 scripts/character/segment.py
Ngưỡng màu dưới đây chỉ đúng cho bộ ảnh hiện tại (áo/giày xanh cho nam, san hô cho nữ, quần tối, tất trắng).
Ảnh gốc mới nên kèm sẵn mặt nạ vẽ tay từ họa sĩ; khi đó chỉ cần đặt file vào thư mục, không cần script này.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

FRAME_W, FRAME_H = 900, 1350
ROOT = Path(__file__).resolve().parents[2]


def hsv(a):
    a = a.astype(np.float32) / 255
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx = a.max(-1)
    mn = a.min(-1)
    d = mx - mn + 1e-6
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    s = np.where(mx > 0, d / (mx + 1e-6), 0)
    return h, s, mx


def save_mask(mask, path):
    im = Image.fromarray((mask * 255).astype(np.uint8), 'L')
    im = im.filter(ImageFilter.MedianFilter(5)).filter(ImageFilter.GaussianBlur(1.4))
    im.save(path, optimize=True)


# Đường viền áo nữ vẽ tay (tọa độ trong khung chuẩn): kẹp vùng đổi màu để không lem ra tay/vai
FEMALE_TOP_OUTLINE = [(320 + x / 3, 300 + y / 3) for x, y in [
    (300, 72), (260, 100), (215, 135), (160, 190), (115, 260), (95, 330), (98, 390), (118, 450), (140, 510), (150, 575),
    (165, 600), (320, 608), (480, 612), (492, 560), (520, 470), (545, 400), (530, 330), (505, 240), (490, 160), (495, 110),
    (520, 62), (470, 60), (440, 80), (420, 140), (390, 185), (340, 210), (280, 212), (245, 195), (230, 160), (245, 110)]]


def polygon(points, W, H):
    im = Image.new('L', (W, H), 0)
    ImageDraw.Draw(im).polygon(points, fill=255)
    return np.array(im) > 0


def regions(gender, a):
    H, W = a.shape[:2]
    h, s, v = hsv(a)
    y = np.arange(H)[:, None] / H * np.ones((1, W))
    x = np.arange(W)[None, :] / W * np.ones((H, 1))
    if gender == 'male':
        blue = (h > 200) & (h < 250) & (s > 0.35)
        top = blue & (y < 0.47)
        shoes = blue & (y > 0.8)
        bottom = (v < 0.42) & (s < 0.35) & (y > 0.4) & (y < 0.64)
        socks = (v > 0.86) & (s < 0.12) & (y > 0.78) & (y < 0.9)
    else:
        coral = ((h < 25) | (h > 345)) & (s > 0.35) & (v > 0.55)
        # Trong đường viền áo: bỏ da (cam nhạt), nền xám và tóc; giữ cả logo/viền khác màu của áo
        skin = (h > 11) & (h < 45) & (s > 0.12)
        top = polygon(FEMALE_TOP_OUTLINE, W, H) & ~skin & ~((s < 0.1) & (v > 0.6)) & (v >= 0.3)
        shoes = coral & (y > 0.84)
        bottom = (v < 0.4) & (s < 0.4) & (y > 0.37) & (y < 0.56)
        socks = (v > 0.86) & (s < 0.12) & (y > 0.8) & (y < 0.9)
    socks &= (x > 0.2) & (x < 0.8)
    return {'top': top, 'bottom': bottom, 'socks': socks, 'shoes': shoes}


for gender in ('male', 'female'):
    src = Image.open(ROOT / f'public/avatars/runner_{gender}.png').convert('RGB')
    im = src.resize((FRAME_W, FRAME_H), Image.LANCZOS)
    out = ROOT / 'public/character' / gender
    out.mkdir(parents=True, exist_ok=True)
    im.save(out / 'base.webp', quality=86, method=6)
    for name, m in regions(gender, np.array(im)).items():
        save_mask(m.astype(np.float32), out / f'{name}.png')
        print(gender, name, f'{m.mean():.4f}')
