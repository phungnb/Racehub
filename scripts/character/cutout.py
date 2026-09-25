"""Tách nền ảnh nhân vật → base.webp trong suốt (docs/NHAN_VAT.md mục 4b).

Ảnh gốc có phông xám chuyển màu (mỗi ảnh một kiểu, có ảnh còn hình lấp lánh ✦ ở góc) → ghép vào app bị lộ mảng nền.
Cách làm:
  1. Mô hình phông: mặt cong bậc 2 theo (x, y) cho từng kênh màu, khớp trên dải viền ảnh rồi khớp lại trên mọi điểm "giống phông".
  2. Độ trong suốt = khoảng cách màu tới phông (mềm ở mép tóc), chỉ giữ khối người lớn nhất (bỏ ✦ và nhiễu).
  3. Khử viền phông ở mép (tách màu người khỏi màu phông).
  4. Bóng đổ dưới chân → bóng đen trong suốt (nền nào cũng hợp).
Chạy: pip install pillow numpy scipy && python3 scripts/character/cutout.py [mã…]
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

W, H = 900, 1350
ROOT = Path(__file__).resolve().parents[2]
SOURCES = {
    'male': ('scripts/character/source/runner_male.png', 'public/character/male'),
    'female': ('scripts/character/source/runner_female.png', 'public/character/female'),
    'male_relax': ('scripts/character/source/runner_male_relax.webp', 'public/character/bodies/male_relax'),
    'male_run': ('scripts/character/source/runner_male_run.webp', 'public/character/bodies/male_run'),
    'female_tee': ('scripts/character/source/runner_female_tee.webp', 'public/character/bodies/female_tee'),
    'female_run': ('scripts/character/source/runner_female_run.webp', 'public/character/bodies/female_run'),
}


def design(xs, ys):
    x = xs / W - 0.5
    y = ys / H - 0.5
    return np.stack([np.ones_like(x), x, y, x * x, x * y, y * y, y * y * y, x * x * y], -1)


def fit_bg(img, sel):
    ys, xs = np.nonzero(sel)
    k = max(1, len(xs) // 60000)
    ys, xs = ys[::k], xs[::k]
    A = design(xs.astype(np.float32), ys.astype(np.float32))
    coef = np.linalg.lstsq(A, img[ys, xs], rcond=None)[0]
    gy, gx = np.mgrid[0:H, 0:W].astype(np.float32)
    return design(gx, gy) @ coef


def dst_of(src):
    return next(d for s, d in SOURCES.values() if s == src)


def cutout(src):
    img = np.asarray(Image.open(ROOT / src).convert('RGB').resize((W, H), Image.LANCZOS)).astype(np.float32)
    border = np.zeros((H, W), bool)
    border[:40, :] = border[-25:, :] = border[:, :50] = border[:, -50:] = True
    bg = fit_bg(img, border)
    for _ in range(2):
        d = np.sqrt(((img - bg) ** 2).sum(-1))
        bg = fit_bg(img, d < 14)
    d = np.sqrt(((img - bg) ** 2).sum(-1))
    # Tinh chỉnh cục bộ: phông thật quanh người (sàn, quầng sáng) lệch khỏi mặt cong → nội suy từ các điểm phông lân cận
    # vùng quanh người (kể cả mảng đồ có màu gần phông như giày trắng) không dùng để ước lượng phông
    c0 = d > 30
    l0, n0 = ndimage.label(c0)
    core0 = l0 == (np.argmax(ndimage.sum(c0, l0, range(1, n0 + 1))) + 1)
    keep_out = ndimage.binary_dilation(ndimage.binary_fill_holes(core0), iterations=10)
    for _ in range(2):
        m = ((d < 16) & ~keep_out).astype(np.float32)
        den = ndimage.gaussian_filter(m, 22)
        loc = np.stack([ndimage.gaussian_filter(img[..., c] * m, 22) for c in range(3)], -1) / np.maximum(den, 1e-3)[..., None]
        w = np.clip(den * 4, 0, 1)[..., None]
        bg = loc * w + bg * (1 - w)
        d = np.sqrt(((img - bg) ** 2).sum(-1))

    # Khối người: điểm khác phông rõ, lấy thành phần liên thông lớn nhất, lấp lỗ
    core = d > 30
    lab, n = ndimage.label(core)
    sizes = ndimage.sum(core, lab, range(1, n + 1))
    body = lab == (np.argmax(sizes) + 1)
    # Chỉ lấp lỗ nhỏ (chi tiết trên áo); khe hở giữa tay và thân là phông → giữ trong suốt
    holes = ndimage.binary_fill_holes(body) & ~body
    hl, hn = ndimage.label(holes)
    if hn:
        hs = ndimage.sum(holes, hl, range(1, hn + 1))
        hd = ndimage.mean(d, hl, range(1, hn + 1))
        small = [i + 1 for i in range(hn) if hs[i] < 400 or hd[i] > 24]
        body |= np.isin(hl, small)
    reach = ndimage.binary_dilation(body, iterations=6)          # mép tóc mềm nằm sát khối người

    alpha = np.clip((d - 9) / (32 - 9), 0, 1)
    alpha = np.where(body, 1.0, alpha) * reach
    alpha = ndimage.gaussian_filter(alpha, 0.6) * reach
    alpha[body & ~ndimage.binary_dilation(~body, iterations=2)] = 1.0

    # Bóng đổ: dưới bàn chân, xám (ít màu), tối hơn phông, không thuộc giày / tất → bóng đen trong suốt
    lum = img.mean(-1)
    bgl = bg.mean(-1)
    sat = img.max(-1) - img.min(-1)
    ys = np.arange(H)[:, None] * np.ones((1, W))
    feet_top = np.nonzero(body.any(1))[0].max() - 190
    gear = np.zeros((H, W), bool)
    for m in ('shoes', 'socks'):
        f = ROOT / dst_of(src) / f'{m}.png'
        if f.exists():
            gear |= np.asarray(Image.open(f).convert('L')) > 90
    # Hình giày / tất dựng từ điểm chắc chắn là đồ (có màu, sáng hơn phông hoặc rất tối), lấp kín bên trong
    # → vệt xám bóng đổ trên giày trắng vẫn là giày; sàn lọt vào mặt nạ cũ thì thành bóng
    sure = gear & ((sat >= 18) | (lum >= bgl - 3) | (lum <= bgl - 90))
    gear = ndimage.binary_fill_holes(ndimage.binary_closing(sure, iterations=4)) & gear
    near = ndimage.binary_dilation(body, iterations=45) & ~body
    # Trong phạm vi chiều cao của giày ở cùng cột là thân giày (mảng xám trên giày trắng), không phải bóng sàn
    lab_g, ng = ndimage.label(ndimage.binary_dilation(gear, iterations=3))
    within = np.zeros((H, W), bool)
    for k in range(1, ng + 1):
        gy, gx = np.nonzero(lab_g == k)
        if len(gx) < 200:
            continue
        for x in np.unique(gx):
            yy = gy[gx == x]
            within[yy.min() + 6:yy.max() - 6, x] = True
    is_shadow = ~within & (near | body) & (ys > feet_top) & (sat < 18) & (lum < bgl - 3) & (lum > bgl - 90) & ~gear
    shade = np.clip((bgl - lum) / np.maximum(bgl, 1) * 1.8, 0, 0.5)
    # Vệt sàn sáng (phản chiếu) quanh bàn chân → bỏ
    floor_glow = near & (ys > feet_top) & (sat < 18) & (lum >= bgl - 3) & ~gear

    # Quầng sáng phông lọt giữa các lọn tóc (xám nhạt, ít màu, nửa trên, sát mép khối người) → trong suốt
    inner = ndimage.binary_erosion(body, iterations=12)
    haze = (ys < H * 0.42) & (sat < 16) & (lum > 150) & (d < 60) & ~inner
    alpha = np.where(haze, np.minimum(alpha, np.clip((d - 30) / 30, 0, 1)), alpha)

    # Giày / tất màu gần phông (trắng ngả tím): mọi điểm lọt trong viền chiếc giày là đồ, đặc hoàn toàn
    zone = np.zeros((H, W), bool)
    for m in ('shoes', 'socks'):
        f = ROOT / dst_of(src) / f'{m}.png'
        if f.exists():
            zone |= np.asarray(Image.open(f).convert('L')) > 90
    zone = ndimage.binary_dilation(zone, iterations=12)
    solid_gear = ndimage.binary_fill_holes(ndimage.binary_closing((alpha > 0.85) & zone, iterations=8)) & zone
    alpha = np.where(solid_gear, 1.0, alpha)
    is_shadow &= ~solid_gear

    # Khử viền phông: màu người = (ảnh − (1 − a)·phông) / a
    a = np.clip(alpha, 1e-3, 1)[..., None]
    fg = np.clip((img - (1 - a) * bg) / a, 0, 255)
    out = np.where((alpha > 0.98)[..., None], img, fg)
    out = np.where(is_shadow[..., None], 0, out)
    alpha = np.where(is_shadow, shade, np.where(floor_glow, 0, alpha))
    rgba = np.dstack([out, alpha * 255]).round().clip(0, 255).astype(np.uint8)
    # Mặt nạ đổi màu chỉ nằm trên người (không nhuộm sàn / phông / bóng)
    solid = np.where(is_shadow, 0, alpha)
    for m in ('top', 'bottom', 'socks', 'shoes'):
        f = ROOT / dst_of(src) / f'{m}.png'
        if f.exists():
            mk = np.asarray(Image.open(f).convert('L')).astype(np.float32)
            Image.fromarray((mk * np.clip((solid - 0.35) / 0.4, 0, 1)).round().astype(np.uint8), 'L').save(f, optimize=True)
    return Image.fromarray(rgba, 'RGBA')


codes = sys.argv[1:] or list(SOURCES)
for code in codes:
    src, dst = SOURCES[code]
    im = cutout(src)
    (ROOT / dst).mkdir(parents=True, exist_ok=True)
    im.save(ROOT / dst / 'base.webp', quality=90, alpha_quality=100, method=6)
    a = np.asarray(im)[..., 3]
    print(code, 'opaque', f'{(a > 250).mean():.3f}', 'soft', f'{((a > 5) & (a < 250)).mean():.4f}')
