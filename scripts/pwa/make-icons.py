"""Sinh bộ icon app RaceHub vào public/icons/ (+ app/favicon.ico).

Biểu tượng: người chạy sải bước (kiểu pictogram thể thao, nét dày) + 3 vệt tốc độ kết thúc bằng
"nút mạch" (kết nối cộng đồng / công nghệ) — ý tưởng logo gốc, tối giản để rõ nét ở cỡ 29–60 px.
Màu theo app: xanh chuối #b6ff3b trên nền tối.

Chạy lại khi đổi thiết kế:  python3 scripts/pwa/make-icons.py
"""
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public' / 'icons'
# Đổi tiền tố mỗi khi đổi thiết kế: điện thoại/trình duyệt nhớ icon theo đường dẫn, trùng tên sẽ không cập nhật.
# Nhớ sửa cùng tiền tố trong shared/config/brand.ts và public/sw.js.
V = 'rh3'
BRAND = (182, 255, 59)
BRAND_HI = (214, 255, 140)
BG_TOP = (24, 31, 43)
BG_BOTTOM = (8, 11, 16)
N = 2048          # vẽ ở độ phân giải cao rồi thu nhỏ (khử răng cưa)
U = N / 1000      # đơn vị thiết kế: khung 1000 × 1000


def limb(d: ImageDraw.ImageDraw, pts: list[tuple[float, float]], w: float):
    """Chi (tay/chân/thân) = các đoạn thẳng dày, đầu tròn — kiểu biểu tượng thể thao (pictogram)."""
    P = [(x * U, y * U) for x, y in pts]
    r = w * U / 2
    d.line(P, fill=255, width=int(w * U), joint='curve')
    for x, y in P:
        d.ellipse((x - r, y - r, x + r, y + r), fill=255)


def mark_mask() -> Image.Image:
    """Mặt nạ trắng/đen của biểu tượng: người chạy sải bước lớn + 3 vệt tốc độ có nút mạch (khung 1000 đơn vị)."""
    m = Image.new('L', (N, N), 0)
    d = ImageDraw.Draw(m)
    s = lambda *v: [x * U for x in v]
    # Đầu
    d.ellipse(s(640, 92, 770, 222), fill=255)
    # Thân nghiêng về trước
    limb(d, [(604, 318), (520, 548)], 124)
    # Tay trước (co, vung lên) — tay sau (vung ra sau)
    limb(d, [(600, 345), (706, 440), (808, 378)], 72)
    limb(d, [(588, 352), (468, 410), (404, 512)], 72)
    # Chân trước (gối nâng cao, cẳng chân gập xuống) — chân sau (đạp duỗi ra sau)
    limb(d, [(528, 545), (690, 610), (650, 790)], 92)
    limb(d, [(650, 790), (716, 800)], 64)
    limb(d, [(508, 560), (426, 704), (252, 758)], 90)
    # 3 vệt tốc độ + nút mạch (ý tưởng "kết nối" của logo gốc)
    for y, x0, x1 in ((330, 165, 330), (470, 110, 300), (610, 190, 350)):
        h = 40
        d.rounded_rectangle(s(x0, y - h / 2, x1, y + h / 2), radius=h / 2 * U, fill=255)
        r = 32
        d.ellipse(s(x0 - 2 * r + 12, y - r, x0 + 12, y + r), fill=255)
        ri = 13
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
    base = italic(mark_mask(), k=0.08)
    full = render(scaled(base, 0.78))          # "any": iOS/Android tự bo góc
    safe = render(scaled(base, 0.6))          # maskable: nằm trọn trong vùng an toàn 80%
    for s in (192, 512):
        save(full, s, f'{V}-icon-{s}.png')
        save(safe, s, f'{V}-maskable-{s}.png')
    save(render(scaled(base, 0.74)), 180, f'{V}-apple-180.png')
    # Huy hiệu thanh trạng thái Android: một màu trắng, nền trong suốt
    save(render(scaled(base, 0.9), bg=False, glow=False, mono=(255, 255, 255)), 96, f'{V}-badge-96.png', rgb=False)
    # Biểu tượng trong suốt để đặt trong giao diện (thanh trên, màn chào)
    save(render(scaled(base, 0.96), bg=False, glow=False), 256, f'{V}-mark-256.png', rgb=False)
    # favicon.ico (16/32/48)
    # Phải là RGBA: trình dựng của Next.js (Turbopack) không đọc được .ico chứa PNG RGB
    fav = render(scaled(base, 0.78)).convert('RGBA')
    fav.resize((48, 48), Image.LANCZOS).save(ROOT / 'app' / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
    print('Đã ghi icon vào', OUT)


if __name__ == '__main__':
    main()
