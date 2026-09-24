"""Sinh bộ icon PWA của RaceHub (tia sét xanh trên nền tối) vào public/icons/.
Chạy lại khi đổi màu thương hiệu:  python3 scripts/pwa/make-icons.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

BG = (10, 13, 18, 255)        # --color-bg
BRAND = (182, 255, 59, 255)   # --color-brand
OUT = Path(__file__).resolve().parents[2] / 'public' / 'icons'
SS = 4

# Tia sét (tọa độ trên khung 100×100)
BOLT = [(57, 8), (22, 56), (46, 56), (40, 92), (78, 40), (53, 40), (62, 8)]


def bolt(size: int, scale: float, color, bg=None, glow=True) -> Image.Image:
    n = size * SS
    img = Image.new('RGBA', (n, n), bg or (0, 0, 0, 0))
    pts = [((x - 50) * scale / 100 * n + n / 2, (y - 50) * scale / 100 * n + n / 2) for x, y in BOLT]
    if glow:
        g = Image.new('RGBA', (n, n), (0, 0, 0, 0))
        ImageDraw.Draw(g).polygon(pts, fill=color[:3] + (110,))
        img.alpha_composite(g.filter(ImageFilter.GaussianBlur(n * 0.05)))
    ImageDraw.Draw(img).polygon(pts, fill=color)
    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for s in (192, 512):
        bolt(s, 0.78, BRAND, BG).save(OUT / f'icon-{s}.png', optimize=True)             # "any": nền đầy
        bolt(s, 0.56, BRAND, BG).save(OUT / f'maskable-{s}.png', optimize=True)         # chừa vùng an toàn 80%
    bolt(180, 0.66, BRAND, BG).save(OUT / 'apple-touch-icon.png', optimize=True)
    # Huy hiệu thanh trạng thái Android: một màu trắng trên nền trong suốt
    bolt(96, 0.9, (255, 255, 255, 255), glow=False).save(OUT / 'badge-96.png', optimize=True)
    print('Đã ghi icon vào', OUT)


if __name__ == '__main__':
    main()
