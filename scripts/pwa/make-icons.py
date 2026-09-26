"""Sinh bộ icon app RaceHub vào public/icons/ (+ app/favicon.ico) từ logo gốc.

Nguồn: scripts/pwa/logo-source.webp (logo RaceHub: người chạy mạch điện trong vòng tròn, nền xanh).
Người chạy tô xanh neon (màu thương hiệu) có quầng sáng. Chỉ lấy phần biểu tượng (bỏ chữ RACEHUB và khẩu hiệu vì quá nhỏ ở cỡ icon), tách khỏi nền, phóng to
chiếm gần hết ô icon rồi đặt lên nền xanh đậm có quầng sáng — để nổi bật trên màn hình điện thoại.

Chạy lại khi đổi thiết kế:  python3 scripts/pwa/make-icons.py
"""
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public' / 'icons'
# Đổi tiền tố mỗi khi đổi thiết kế: điện thoại/trình duyệt nhớ icon theo đường dẫn, trùng tên sẽ không cập nhật.
# Nhớ sửa cùng tiền tố trong shared/config/brand.ts và public/sw.js.
V = 'rh5'
SOURCE = Path(__file__).with_name('logo-source.webp')
EMBLEM_BOX = (620, 560, 1300, 1240)   # vùng biểu tượng trong ảnh nguồn 2000 × 2000
WHITE = (255, 255, 255)
NEON = (182, 255, 59)       # xanh neon = --color-brand của app (#b6ff3b): người chạy phát sáng
NEON_GLOW = (120, 255, 90)
BG_TOP = (16, 116, 224)      # xanh của logo gốc, đậm và bão hòa hơn
BG_BOTTOM = (6, 34, 96)
GLOW = (40, 210, 200)        # quầng xanh ngọc giữa biểu tượng như logo gốc
N = 2048          # vẽ ở độ phân giải cao rồi thu nhỏ (khử răng cưa)


def mark_mask() -> Image.Image:
    """Mặt nạ biểu tượng: nét trắng của logo gốc tách khỏi nền xanh (độ trắng → độ phủ)."""
    src = Image.open(SOURCE).convert('RGB').crop(EMBLEM_BOX)
    r, g, b = src.split()
    lo = ImageChops.darker(ImageChops.darker(r, g), b)          # kênh nhỏ nhất: nền xanh thấp, nét trắng cao
    m = lo.point(lambda v: max(0, min(255, int((v - 70) * 255 / 140))))
    m = m.crop(m.point(lambda v: 255 if v > 76 else 0).getbbox())
    # Phóng lên khung N rồi làm sắc mép (đường cong độ phủ dốc hơn) để nét không bị nhòe khi thu nhỏ
    f = N / max(m.size)
    m = m.resize((int(m.width * f), int(m.height * f)), Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.2))
    m = m.point(lambda v: max(0, min(255, int((v - 60) * 255 / 120))))
    out = Image.new('L', (N, N), 0)
    out.paste(m, ((N - m.width) // 2, (N - m.height) // 2))
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
    glow = Image.new('L', (N, N), 0)
    ImageDraw.Draw(glow).ellipse((N * 0.22, N * 0.22, N * 0.78, N * 0.78), fill=150)
    bg.paste(Image.new('RGB', (N, N), GLOW), mask=glow.filter(ImageFilter.GaussianBlur(N * 0.12)))
    return bg


def render(mask: Image.Image, bg: bool = True, glow: bool = True, color: tuple = NEON) -> Image.Image:
    canvas = background().convert('RGBA') if bg else Image.new('RGBA', (N, N), (0, 0, 0, 0))
    if glow:
        # Bóng tối nhẹ phía dưới + quầng sáng quanh nét → biểu tượng tách hẳn khỏi nền
        sh = Image.new('RGBA', (N, N), (0, 10, 40, 0))
        sh.putalpha(mask.filter(ImageFilter.GaussianBlur(N * 0.012)).point(lambda v: int(v * 0.6)))
        canvas.alpha_composite(sh, (0, int(N * 0.008)))
        # Quầng neon hai lớp: rộng mờ + sát nét sáng → hiệu ứng đèn neon
        for blur, k in ((0.045, 0.55), (0.012, 0.7)):
            g = Image.new('RGBA', (N, N), NEON_GLOW + (0,))
            g.putalpha(mask.filter(ImageFilter.GaussianBlur(N * blur)).point(lambda v, k=k: int(v * k)))
            canvas.alpha_composite(g)
    fill = Image.new('RGBA', (N, N), color + (255,))
    fill.putalpha(mask)
    canvas.alpha_composite(fill)
    return canvas


def save(img: Image.Image, size: int, name: str, rgb: bool = True):
    out = img.resize((size, size), Image.LANCZOS)
    (out.convert('RGB') if rgb else out).save(OUT / name, optimize=True)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    base = mark_mask()
    full = render(scaled(base, 0.82))          # "any": iOS/Android tự bo góc
    safe = render(scaled(base, 0.64))          # maskable: nằm trọn trong vùng an toàn 80%
    for s in (192, 512):
        save(full, s, f'{V}-icon-{s}.png')
        save(safe, s, f'{V}-maskable-{s}.png')
    save(render(scaled(base, 0.8)), 180, f'{V}-apple-180.png')
    # Huy hiệu thanh trạng thái Android: bắt buộc một màu trắng (hệ điều hành tự tô), nền trong suốt
    save(render(scaled(base, 0.9), bg=False, glow=False, color=WHITE), 96, f'{V}-badge-96.png', rgb=False)
    # Biểu tượng trong suốt để đặt trong giao diện (thanh trên, màn chào)
    save(render(scaled(base, 0.96), bg=False, glow=False), 256, f'{V}-mark-256.png', rgb=False)
    # favicon.ico (16/32/48)
    # Phải là RGBA: trình dựng của Next.js (Turbopack) không đọc được .ico chứa PNG RGB
    fav = render(scaled(base, 0.9)).convert('RGBA')
    fav.resize((48, 48), Image.LANCZOS).save(ROOT / 'app' / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
    print('Đã ghi icon vào', OUT)


if __name__ == '__main__':
    main()
