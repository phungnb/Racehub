"""Sinh bộ icon app RaceHub vào public/icons/ (+ app/favicon.ico).

Biểu tượng: chữ R nghiêng về phía trước (tốc độ) + 3 vệt chạy kết thúc bằng "nút mạch"
(kết nối cộng đồng / công nghệ) — giữ ý tưởng logo gốc nhưng tối giản để rõ nét ở cỡ 29–60 px.
Màu theo app: xanh chuối #b6ff3b trên nền tối.

Chạy lại khi đổi thiết kế:  python3 scripts/pwa/make-icons.py
"""
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public' / 'icons'
BRAND = (182, 255, 59)
BRAND_HI = (214, 255, 140)
BG_TOP = (24, 31, 43)
BG_BOTTOM = (8, 11, 16)
N = 2048          # vẽ ở độ phân giải cao rồi thu nhỏ (khử răng cưa)
U = N / 1000      # đơn vị thiết kế: khung 1000 × 1000


def mark_mask() -> Image.Image:
    """Mặt nạ trắng/đen của biểu tượng (chưa nghiêng), khung 1000 đơn vị."""
    m = Image.new('L', (N, N), 0)
    d = ImageDraw.Draw(m)
    s = lambda *v: [x * U for x in v]
    # Chữ R: thân + vòng + chân
    d.rectangle(s(440, 250, 555, 760), fill=255)
    d.rounded_rectangle(s(440, 250, 735, 548), radius=148 * U, fill=255)
    d.rounded_rectangle(s(555, 345, 645, 452), radius=46 * U, fill=0)
    d.polygon(s(575, 505, 690, 505, 785, 760, 668, 760), fill=255)
    # 3 vệt tốc độ + nút mạch ở đầu
    for y, x0 in ((360, 205), (505, 150), (650, 235)):
        h = 46
        d.rounded_rectangle(s(x0, y - h / 2, 405, y + h / 2), radius=h / 2 * U, fill=255)
        r = 34
        d.ellipse(s(x0 - 2 * r + 12, y - r, x0 + 12, y + r), fill=255)
        ri = 14
        cx = x0 - r + 12
        d.ellipse(s(cx - ri, y - ri, cx + ri, y + ri), fill=0)
    return m


def italic(mask: Image.Image, k: float = 0.2) -> Image.Image:
    """Nghiêng về trước: đỉnh lệch phải. Sau đó căn giữa theo khung."""
    c = N / 2
    sk = mask.transform((N, N), Image.AFFINE, (1, k, -k * c, 0, 1, 0), resample=Image.BICUBIC)
    x0, y0, x1, y1 = sk.getbbox()
    out = Image.new('L', (N, N), 0)
    out.paste(sk.crop((x0, y0, x1, y1)), (int((N - (x1 - x0)) / 2), int((N - (y1 - y0)) / 2)))
    return out


def scaled(mask: Image.Image, scale: float) -> Image.Image:
    """Thu biểu tượng về `scale` × khung (căn giữa) — chừa lề an toàn."""
    x0, y0, x1, y1 = mask.getbbox()
    crop = mask.crop((x0, y0, x1, y1))
    w, h = crop.size
    f = scale * N / max(w, h)
    crop = crop.resize((int(w * f), int(h * f)), Image.LANCZOS)
    out = Image.new('L', (N, N), 0)
    out.paste(crop, ((N - crop.width) // 2, (N - crop.height) // 2))
    return out


def background() -> Image.Image:
    bg = Image.new('RGB', (N, N))
    d = ImageDraw.Draw(bg)
    for y in range(N):
        t = y / (N - 1)
        d.line([(0, y), (N, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOTTOM)))
    return bg


def render(mask: Image.Image, bg: bool = True, glow: bool = True, mono: tuple | None = None) -> Image.Image:
    canvas = background().convert('RGBA') if bg else Image.new('RGBA', (N, N), (0, 0, 0, 0))
    if glow:
        g = Image.new('RGBA', (N, N), BRAND + (0,))
        g.putalpha(mask.filter(ImageFilter.GaussianBlur(N * 0.035)).point(lambda v: int(v * 0.55)))
        canvas.alpha_composite(g)
    if mono:
        fill = Image.new('RGBA', (N, N), mono + (255,))
    else:
        # Chuyển màu nhẹ từ trên xuống cho khối chữ có chiều sâu
        fill = Image.new('RGBA', (N, N))
        fd = ImageDraw.Draw(fill)
        for y in range(N):
            t = min(1, max(0, (y / N - 0.25) / 0.5))
            fd.line([(0, y), (N, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(BRAND_HI, BRAND)) + (255,))
    fill.putalpha(ImageChops.multiply(fill.getchannel('A'), mask))
    canvas.alpha_composite(fill)
    return canvas


def save(img: Image.Image, size: int, name: str, rgb: bool = True):
    out = img.resize((size, size), Image.LANCZOS)
    (out.convert('RGB') if rgb else out).save(OUT / name, optimize=True)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    base = italic(mark_mask())
    full = render(scaled(base, 0.66))          # "any": iOS/Android tự bo góc
    safe = render(scaled(base, 0.52))          # maskable: nằm trọn trong vùng an toàn 80%
    for s in (192, 512):
        save(full, s, f'icon-{s}.png')
        save(safe, s, f'maskable-{s}.png')
    save(render(scaled(base, 0.6)), 180, 'apple-touch-icon.png')
    # Huy hiệu thanh trạng thái Android: một màu trắng, nền trong suốt
    save(render(scaled(base, 0.9), bg=False, glow=False, mono=(255, 255, 255)), 96, 'badge-96.png', rgb=False)
    # Biểu tượng trong suốt để đặt trong giao diện (thanh trên, màn chào)
    save(render(scaled(base, 0.96), bg=False, glow=False), 256, 'mark-256.png', rgb=False)
    # favicon.ico (16/32/48)
    fav = render(scaled(base, 0.78)).convert('RGB')
    fav.resize((48, 48), Image.LANCZOS).save(ROOT / 'app' / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
    print('Đã ghi icon vào', OUT)


if __name__ == '__main__':
    main()
