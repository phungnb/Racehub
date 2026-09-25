"""Sinh tài nguyên cho các nhân vật / tư thế bổ sung (bộ sưu tập nhân vật, docs/NHAN_VAT.md mục 4b).

Ảnh gốc: scripts/character/source/runner_<code>.webp (áo xanh, quần đen, tất trắng — như bộ gốc).
Kết quả: public/character/bodies/<code>/base.webp + top.png bottom.png socks.png shoes.png (khung chuẩn 900 x 1350).

Cách tách: bỏ nền (nền xám chuyển màu: nội suy theo mép trái/phải từng hàng) → áo = màu xanh trong khoảng chiều cao áo,
quần = vùng tối lớn nhất (+ viền xanh của quần), tất / giày = đa giác vẽ tay quanh từng bàn chân (tất đè lên giày).
Chạy: pip install pillow numpy scipy && python3 scripts/character/segment_bodies.py [code…]
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

FRAME_W, FRAME_H = 900, 1350
ROOT = Path(__file__).resolve().parents[2]

# Tọa độ theo khung chuẩn. top_y / bottom_y: khoảng chiều cao áo / quần. socks / shoes: đa giác từng chân.
BODIES = {
    'male_relax': {
        'top_y': (230, 626), 'bottom_y': (570, 795),
        'socks': [[(205, 1100), (295, 1100), (292, 1182), (205, 1186)], [(435, 1100), (508, 1100), (506, 1176), (435, 1180)]],
        'shoes': [[(150, 1176), (310, 1172), (310, 1325), (150, 1325)], [(395, 1170), (600, 1170), (600, 1300), (395, 1300)]],
    },
    'male_run': {
        'top_y': (200, 598), 'bottom_y': (570, 775),
        'socks': [[(248, 900), (312, 905), (305, 985), (282, 992), (262, 968), (246, 930)],
                  [(485, 1098), (566, 1098), (562, 1168), (542, 1196), (505, 1202), (492, 1160)]],
        'shoes': [[(165, 905), (285, 905), (290, 1112), (165, 1112)], [(495, 1150), (690, 1150), (690, 1305), (495, 1305)]],
    },
    'female_tee': {
        'top_y': (240, 496), 'bottom_y': (505, 730),
        'socks': [[(232, 1100), (305, 1100), (302, 1180), (232, 1186)], [(482, 1100), (553, 1100), (550, 1186), (482, 1190)]],
        'shoes': [[(140, 1172), (320, 1172), (320, 1310), (140, 1310)], [(405, 1178), (570, 1178), (570, 1315), (405, 1315)]],
    },
    'female_run': {
        'top_y': (255, 506), 'bottom_y': (505, 730),
        'socks': [[(232, 822), (304, 822), (302, 880), (272, 892), (250, 884), (236, 860)],
                  [(500, 1098), (572, 1098), (574, 1180), (556, 1192), (525, 1202), (508, 1182)]],
        'shoes': [[(155, 780), (285, 780), (285, 980), (155, 980)], [(500, 1160), (690, 1160), (690, 1310), (500, 1310)]],
    },
}


def hsv(a):
    a = a.astype(np.float32) / 255
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a.max(-1), a.min(-1)
    d = mx - mn + 1e-6
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    s = np.where(mx > 0, d / (mx + 1e-6), 0)
    return h, s, mx


def poly(points_list, W, H):
    im = Image.new('L', (W, H), 0)
    for pts in points_list:
        ImageDraw.Draw(im).polygon(pts, fill=255)
    return np.array(im) > 0


def largest(mask, keep=1):
    lab, n = ndimage.label(mask)
    if n == 0:
        return mask
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    idx = np.argsort(sizes)[::-1][:keep] + 1
    return np.isin(lab, idx)


def foreground(a):
    """Nền xám chuyển màu: màu nền mỗi hàng nội suy giữa mép trái và mép phải; khác nền rõ rệt = người"""
    H, W = a.shape[:2]
    f = a.astype(np.float32)
    left = f[:, 5:40].mean(1)
    right = f[:, W - 40:W - 5].mean(1)
    t = np.linspace(0, 1, W)[None, :, None]
    bg = left[:, None, :] * (1 - t) + right[:, None, :] * t
    return np.sqrt(((f - bg) ** 2).sum(-1)) > 26


def regions(cfg, a):
    H, W = a.shape[:2]
    h, s, v = hsv(a)
    yy = np.arange(H)[:, None] * np.ones((1, W))
    fg = foreground(a)
    skin = (h > 4) & (h < 45) & (s > 0.14) & (v > 0.3)
    blue = (h > 195) & (h < 262) & (s > 0.25) & (v > 0.18)
    y0, y1 = cfg['top_y']
    top = largest(blue & fg & (yy >= y0) & (yy < y1), 2)
    # lấp lỗ nhỏ trong áo (chữ / logo in sẵn) để đổi màu liền mảng
    top = ndimage.binary_closing(top, iterations=2) & fg & ~skin
    top = ndimage.binary_fill_holes(top) & ~skin
    b0, b1 = cfg['bottom_y']
    dark = (v < 0.4) & (s < 0.5) & fg & (yy >= b0) & (yy < b1) & ~top
    # quần có thể tách làm vài mảng (vạt, lót): giữ các mảng lớn
    lab, n = ndimage.label(dark)
    sizes = ndimage.sum(dark, lab, range(1, n + 1)) if n else []
    bottom = np.isin(lab, [i + 1 for i, z in enumerate(sizes) if z > max(sizes) * 0.02]) if n else dark
    ys, xs = np.nonzero(bottom)
    box = np.zeros_like(bottom)
    box[ys.min():ys.max() + 1, max(0, xs.min() - 6):xs.max() + 7] = True
    bottom = bottom | (blue & box & fg & ~top & (yy >= b0))
    bottom = ndimage.binary_fill_holes(ndimage.binary_closing(bottom, iterations=2)) & fg & ~skin & ~top
    socks = poly(cfg['socks'], W, H) & fg & ~skin
    # bóng đổ trên sàn: xám nhạt ít bão hòa → không phải giày
    shadow = (s < 0.16) & (v > 0.4) & (v < 0.84)
    shoes = poly(cfg['shoes'], W, H) & fg & ~skin & ~socks & ~shadow
    shoes = ndimage.binary_fill_holes(ndimage.binary_closing(shoes, iterations=3)) & poly(cfg['shoes'], W, H) & ~socks & ~skin
    shoes = largest(shoes, 2)
    return {'top': top, 'bottom': bottom, 'socks': socks, 'shoes': shoes}


def save_mask(mask, path):
    im = Image.fromarray((mask * 255).astype(np.uint8), 'L')
    im = im.filter(ImageFilter.MedianFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    im.save(path, optimize=True)


codes = sys.argv[1:] or list(BODIES)
for code in codes:
    src = Image.open(ROOT / f'scripts/character/source/runner_{code}.webp').convert('RGB')
    im = src.resize((FRAME_W, FRAME_H), Image.LANCZOS)
    out = ROOT / 'public/character/bodies' / code
    out.mkdir(parents=True, exist_ok=True)
    im.save(out / 'base.webp', quality=86, method=6)
    for name, m in regions(BODIES[code], np.array(im)).items():
        save_mask(m.astype(np.float32), out / f'{name}.png')
        ys, xs = np.nonzero(m)
        print(code, name, f'{m.mean():.4f}', 'box', xs.min(), ys.min(), xs.max(), ys.max())
