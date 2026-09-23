"""Vẽ đồ đội đầu (băng đô, visor, mũ chạy) thành lớp PNG khung chuẩn 900x1350 cho nhân vật 2D.

Hình khối đầu mỗi giới đo từ ảnh nền (HEAD). Món đồ vẽ ở độ phân giải x4 rồi thu nhỏ để mép mịn.
Ánh sáng studio từ trước-trái giống ảnh nền; có bóng đổ mềm lên trán.
  python3 scripts/character/items/headwear.py [mã ...]    # sinh bộ sưu tập (hoặc vài mã) vào public/character/layers/
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

W, H = 900, 1350
SS = 4                                  # siêu lấy mẫu
ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'scripts/character/out/items'

# Hình khối đầu (tọa độ khung): tâm ngang, đường chân tóc giữa trán, nửa bề ngang đầu ở tầm trán, độ cong vòng đầu
HEAD = {
    'male':   dict(cx=474, hairline=128, half=60, curve=0.0048, tilt=0.04),
    'female': dict(cx=447, hairline=168, half=55, curve=0.0050, tilt=0.0),
}


def hexrgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float32)


# Chỉ vẽ trong vùng đầu (nhanh hơn ~20 lần); ngoài vùng là trong suốt
CROP = (300, 0, 660, 360)


def grid():
    x0, y0, x1, y1 = CROP
    ys, xs = np.mgrid[y0 * SS:y1 * SS, x0 * SS:x1 * SS].astype(np.float32)
    return xs / SS, ys / SS


def band_geometry(g, y_mid, thick, extra=2.0):
    """Dải vòng quanh đầu nhìn từ hơi thấp: giữa trán thấp nhất, hai bên cong lên.
    Trả (mask 0..1, u = vị trí ngang -1..1, v = vị trí dọc 0..1 trong dải)."""
    hd = HEAD[g]
    x, y = grid()
    half = hd['half'] + extra
    u = (x - hd['cx']) / half
    # vòng quanh đầu cao hơn tầm mắt → nhìn thành hình vòm: giữa trán cao nhất, hai bên thấp dần
    centre = y_mid + hd['curve'] * (x - hd['cx']) ** 2 + hd['tilt'] * (x - hd['cx'])
    # hai bên quay ra sau đầu → dải mỏng dần theo phối cảnh
    t = thick * (0.55 + 0.45 * np.sqrt(np.clip(1 - u ** 2, 0, 1)))
    v = (y - (centre - t / 2)) / t
    # mép dọc mềm 1px, hai đầu dải bo tròn
    feather = 1.0 / np.maximum(t, 1)
    vin = np.clip(np.minimum(v, 1 - v) / feather + 0.5, 0, 1)
    uin = np.clip((1 - np.abs(u)) / 0.05, 0, 1)
    return vin * uin, u, np.clip(v, 0, 1)


def shade(base_rgb, u, v, strength=1.0, gloss=0.0):
    """Tô khối trụ: sáng ở giữa-trái, tối dần ra hai bên và mép trên/dưới."""
    across = np.sqrt(np.clip(1 - u ** 2, 0, 1))                 # hình trụ
    light = 0.55 + 0.45 * across - 0.12 * u                       # đèn từ trái
    roll = 1 - 0.28 * (np.abs(v - 0.5) * 2) ** 3                  # mép vải cuộn tối hơn
    lum = (light * roll) ** strength
    rgb = base_rgb[None, None, :] * lum[..., None]
    if gloss:
        spec = np.exp(-((u + 0.35) ** 2) / 0.02 - ((v - 0.35) ** 2) / 0.05) * gloss
        rgb = rgb + 255 * spec[..., None]
    return np.clip(rgb, 0, 255)


def fabric(rgb, v, kind, rng):
    """Chất vải: bông xù (terry) hoặc thun gân ngang."""
    h, w = rgb.shape[:2]
    if kind == 'terry':
        n = rng.normal(0, 1, (h // SS // 2 + 1, w // SS // 2 + 1)).astype(np.float32)
        n = np.asarray(Image.fromarray(n).resize((w, h), Image.BICUBIC), np.float32)
        bright = rgb.mean(-1, keepdims=True) / 255                 # vải sáng: nhiễu nhẹ hơn để không lấm tấm
        rgb = rgb * (1 + 0.035 * (1 - 0.7 * bright) * n[..., None])
    else:
        ribs = 0.5 + 0.5 * np.sin(v * np.pi * 10)
        rgb = rgb * (0.94 + 0.06 * ribs[..., None])
    return np.clip(rgb, 0, 255)


def stitch(rgb, v, color, at=(0.1, 0.9), width=0.035):
    for a in at:
        line = np.exp(-((v - a) ** 2) / (width ** 2))
        rgb = rgb * (1 - 0.35 * line[..., None]) + color * 0.35 * line[..., None]
    return rgb


def logo_tick(x, y, cx, cy, size):
    """Logo "tia chớp" RaceHub đơn giản: hai tam giác lệch nhau."""
    px, py = (x - cx) / size, (y - cy) / size
    upper = (py > -1) & (py < 0.1) & (px > -0.2 + py * 0.45) & (px < 0.55 + py * 0.9) & (px + py * -0.6 > -0.05)
    lower = (py > -0.1) & (py < 1) & (px < 0.2 + py * 0.45) & (px > -0.55 + py * 0.9) & (px + py * -0.6 < 0.05)
    return (upper | lower).astype(np.float32)


def finish(rgb, alpha, shadow=None):
    """Ghép bóng đổ + món đồ, thu nhỏ về khung chuẩn → RGBA uint8."""
    out = np.zeros((H * SS, W * SS, 4), np.float32)
    if shadow is not None:
        out[..., 3] = shadow
    out[..., :3] = rgb * alpha[..., None]
    out[..., 3] = alpha + out[..., 3] * (1 - alpha)
    # về màu không nhân alpha
    a = np.maximum(out[..., 3:4], 1e-6)
    out[..., :3] = np.where(out[..., 3:4] > 0, out[..., :3] / a, 0)
    im = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), 'RGBA').resize((W, H), Image.LANCZOS)
    return im


_BASE = {}


def hair_over(g, strength=1.0):
    """Mặt nạ tóc tối của ảnh nền (0..1) trong vùng vẽ: sợi tóc nằm đè lên món đồ (món đồ trong suốt ở đó)."""
    if g not in _BASE:
        _BASE[g] = np.asarray(Image.open(ROOT / f'public/character/{g}/base.webp').convert('RGB'), np.float32)
    x0, y0, x1, y1 = CROP
    b = _BASE[g][y0:y1, x0:x1]
    lum = b[..., 0] * 0.299 + b[..., 1] * 0.587 + b[..., 2] * 0.114
    m = np.clip((95 - lum) / 35, 0, 1) * strength
    im = Image.fromarray((m * 255).astype(np.uint8)).resize(((x1 - x0) * SS, (y1 - y0) * SS), Image.BILINEAR)
    return np.asarray(im, np.float32) / 255


def soft_shadow(mask, dy, blur, opacity):
    sh = Image.fromarray((mask * 255).astype(np.uint8)).transform(
        mask.shape[::-1], Image.AFFINE, (1, 0, 0, 0, 1, -dy * SS)).filter(ImageFilter.GaussianBlur(blur * SS))
    return np.asarray(sh, np.float32) / 255 * opacity


def headband(g, color, style='terry', logo='#ffffff', seed=1, under_hair=True):
    hd = HEAD[g]
    rng = np.random.default_rng(seed)
    thick = 23 if style == 'terry' else 11
    y_mid = hd['hairline'] + (2 if style == 'terry' else 0)
    mask, u, v = band_geometry(g, y_mid, thick, extra=0)
    rgb = shade(hexrgb(color), u, v, gloss=0.0 if style == 'terry' else 0.08)
    rgb = fabric(rgb, v, style, rng)
    if style == 'terry':
        rgb = stitch(rgb, v, hexrgb(color) * 0.6)
    if logo:
        x, y = grid()
        cx = hd['cx'] - 2
        cy = y_mid + hd['curve'] * 4
        lm = logo_tick(x, y, cx, cy, thick * 0.3) * mask
        rgb = rgb * (1 - lm[..., None]) + hexrgb(logo) * (0.75 + 0.25 * np.sqrt(np.clip(1 - u ** 2, 0, 1)))[..., None] * lm[..., None]
    shadow = soft_shadow(mask, 3, 2.5, 0.35)
    if under_hair:                       # tóc mái / tóc hai bên đè lên băng
        hair = hair_over(g)
        mask = mask * (1 - hair)
        shadow = shadow * (1 - hair)
    shadow_rgb = np.zeros_like(rgb)
    alpha = mask
    out = np.zeros(mask.shape + (4,), np.float32)
    # bóng đổ (đen, mờ) nằm dưới món đồ
    a_total = alpha + shadow * (1 - alpha)
    col = (rgb * alpha[..., None] + shadow_rgb * (shadow * (1 - alpha))[..., None]) / np.maximum(a_total, 1e-6)[..., None]
    out[..., :3] = col
    out[..., 3] = a_total * 255
    return to_frame(out)


def to_frame(out):
    x0, y0, x1, y1 = CROP
    part = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), 'RGBA').resize((x1 - x0, y1 - y0), Image.LANCZOS)
    frame = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    frame.paste(part, (x0, y0))
    return frame


def compose(layers):
    """Ghép nhiều lớp (rgb, alpha) theo thứ tự (lớp sau đè lớp trước) → mảng RGBA float, màu không nhân alpha."""
    shape = layers[0][1].shape
    acc = np.zeros(shape + (3,), np.float32)
    a = np.zeros(shape, np.float32)
    for rgb, al in layers:
        rgb = np.broadcast_to(rgb, shape + (3,)) if np.ndim(rgb) == 1 else rgb
        acc = rgb * al[..., None] + acc * (1 - al[..., None])
        a = al + a * (1 - al)
    out = np.zeros(shape + (4,), np.float32)
    out[..., :3] = acc / np.maximum(a, 1e-6)[..., None]
    out[..., 3] = a * 255
    return out


def background(g):
    """Ước lượng nền trơn phía sau đầu: nội suy theo hàng giữa 2 cột nền ở mép vùng vẽ."""
    if g not in _BASE:
        hair_over(g)
    x0, y0, x1, y1 = CROP
    b = _BASE[g][y0:y1, x0:x1]
    left = b[:, 2:12].mean(1)
    right = b[:, -12:-2].mean(1)
    t = np.linspace(0, 1, x1 - x0)[None, :, None]
    bg = left[:, None, :] * (1 - t) + right[:, None, :] * t
    im = Image.fromarray(np.clip(bg, 0, 255).astype(np.uint8)).resize(((x1 - x0) * SS, (y1 - y0) * SS), Image.BILINEAR)
    return np.asarray(im, np.float32)


def band_line(g, y_mid, x):
    hd = HEAD[g]
    return y_mid + hd['curve'] * (x - hd['cx']) ** 2 + hd['tilt'] * (x - hd['cx'])


def brim(g, y_band, depth, half_ratio, color, under):
    """Lưỡi trai nhìn từ dưới lên: thấy mặt dưới (màu under) và mép trước sáng."""
    hd = HEAD[g]
    x, y = grid()
    half = (hd['half'] + 6) * half_ratio
    u = (x - hd['cx']) / half
    top = band_line(g, y_band, x) - 3
    prof = np.clip(1 - u ** 2, 0, 1) ** 0.6
    bottom = top + 4 + depth * prof
    inside = (np.abs(u) < 1) & (y >= top) & (y <= bottom)
    v = np.clip((y - top) / np.maximum(bottom - top, 1e-3), 0, 1)
    soft = np.clip(np.minimum(y - top, bottom - y) * SS / 2 + 0.5, 0, 1) * np.clip((1 - np.abs(u)) / 0.04, 0, 1)
    alpha = inside * soft
    # mặt dưới: tối, sáng dần về mép trước; mép trước là viền màu chính
    under_rgb = hexrgb(under)[None, None, :] * (0.7 + 0.3 * v[..., None]) * (0.85 + 0.15 * np.sqrt(np.clip(1 - u ** 2, 0, 1)))[..., None]
    rim = np.clip((v - 0.72) / 0.12, 0, 1)
    rgb = under_rgb * (1 - rim[..., None]) + shade(hexrgb(color), u, np.full_like(u, 0.5)) * rim[..., None]
    gloss = np.exp(-((u + 0.3) ** 2) / 0.04) * rim
    rgb = rgb + 45 * gloss[..., None]
    # bóng lưỡi trai đổ xuống mặt
    sh_top = bottom
    sh = ((y > sh_top - 2) & (y < sh_top + depth * 0.7 * prof + 3) & (np.abs(u) < 0.9)).astype(np.float32)
    sh = np.asarray(Image.fromarray((sh * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(4 * SS)), np.float32) / 255 * 0.2
    return rgb, alpha, sh


def crown(g, y_band, height, width_extra, color, seam, rng, vents=True, logo=None):
    """Thân mũ chạy dáng thấp, 6 múi, vải mỏng: khối vòm dẹt + đường may + lỗ thoáng."""
    hd = HEAD[g]
    x, y = grid()
    halfw = hd['half'] + width_extra
    base = band_line(g, y_band, x)
    dx = (x - hd['cx']) / halfw
    dy = (base - y) / height                                   # 0 ở vành, 1 ở đỉnh
    p = 2.25                                                   # siêu elip: đỉnh hơi dẹt như mũ chạy
    r = np.abs(dx) ** p + np.clip(dy, 0, None) ** p
    inside = (r <= 1) & (dy >= -0.02)
    edge = np.clip((1 - r) * halfw * SS / 6, 0, 1)
    alpha = inside * edge
    nx = np.clip(dx, -1, 1)
    ny = np.clip(dy, 0, 1)
    nz = np.sqrt(np.clip(1 - nx ** 2 - (ny * 0.8) ** 2, 0, 1))
    lum = 0.42 + 0.5 * nz - 0.14 * nx + 0.12 * ny
    rgb = hexrgb(color)[None, None, :] * lum[..., None]
    # đường may: giữa và hai múi bên, cong theo vòm
    ww = np.sqrt(np.clip(1 - ny ** 2, 0.05, 1))
    for k in (0.0, -0.5, 0.5):
        d = np.abs(nx - k * ww) * halfw
        line = np.exp(-(d ** 2) / 0.5) * (ny > 0.08)
        rgb = rgb * (1 - 0.35 * line[..., None]) + hexrgb(seam) * 0.35 * line[..., None]
    # lỗ thoáng laser hai bên (kiểu AeroBill)
    if vents:
        for side in (-1, 1):
            for i in range(4):
                for j in range(3):
                    cx = hd['cx'] + side * halfw * (0.62 + 0.09 * j)
                    cy = y_band - height * (0.25 + 0.13 * i) + side * 0 + (j * 2)
                    d2 = (x - cx) ** 2 + (y - cy) ** 2
                    dot = np.exp(-d2 / 1.1)
                    rgb = rgb * (1 - 0.3 * dot[..., None])
    # nút đỉnh
    bt = np.exp(-((x - hd['cx']) ** 2 + (y - (base - height * 0.97)) ** 2) / 4)
    rgb = rgb * (1 - 0.3 * bt[..., None])
    # vải: nhiễu rất nhẹ
    n = rng.normal(0, 1, (y.shape[0] // SS // 3 + 1, y.shape[1] // SS // 3 + 1)).astype(np.float32)
    n = np.asarray(Image.fromarray(n).resize(y.shape[::-1], Image.BICUBIC), np.float32)
    rgb = rgb * (1 + 0.008 * n[..., None])
    # viền chân mũ + vùng tối sát vành (ambient occlusion)
    rimline = np.exp(-((y - base) ** 2) / 2.5)
    rgb = rgb * (1 - 0.3 * rimline[..., None])
    ao = np.exp(-np.clip(dy, 0, None) / 0.12)
    rgb = rgb * (1 - 0.18 * ao[..., None])
    # viền sáng ven thân mũ phía trái (đèn studio) + bóng nhẹ trên vòm
    rimlight = np.clip((r - 0.86) / 0.14, 0, 1) * np.clip(-nx + 0.2, 0, 1) * (ny > 0.05)
    rgb = rgb + 70 * rimlight[..., None]
    spec = np.exp(-((nx + 0.32) ** 2) / 0.03 - ((ny - 0.62) ** 2) / 0.05)
    rgb = rgb + 38 * spec[..., None]
    if logo:
        lm = logo_tick(x, y, hd['cx'] - 1, base - height * 0.42, height * 0.14) * alpha
        rgb = rgb * (1 - lm[..., None]) + hexrgb(logo) * lm[..., None]
    return np.clip(rgb, 0, 255), alpha, (dx, dy, inside)


def visor(g, color, under='#2a2f38', logo='#ffffff', seed=2):
    hd = HEAD[g]
    rng = np.random.default_rng(seed)
    y_band = hd['hairline'] - 2
    bmask, u, v = band_geometry(g, y_band, 15)
    brgb = fabric(shade(hexrgb(color), u, v), v, 'thin', rng)
    brgb = stitch(brgb, v, hexrgb(color) * 0.55, at=(0.12, 0.88))
    if logo:
        x, y = grid()
        lm = logo_tick(x, y, hd['cx'] - 2, y_band, 16 * 0.3) * bmask
        brgb = brgb * (1 - lm[..., None]) + hexrgb(logo) * lm[..., None]
    rrgb, ralpha, rsh = brim(g, y_band + 8, 9 if g == 'male' else 8, 0.95, color, under)
    bshadow = soft_shadow(bmask, 2, 2, 0.3)
    black = np.zeros(3, np.float32)
    out = compose([(black, np.maximum(rsh, bshadow)), (brgb, bmask), (rrgb, ralpha)])
    return to_frame(out)


def cap(g, color, under='#2a2f38', seam=None, logo='#ffffff', seed=3):
    hd = HEAD[g]
    rng = np.random.default_rng(seed)
    y_band = hd['hairline'] + 2
    height = 55 if g == 'male' else 50
    extra = 9 if g == 'male' else 7
    crgb, calpha, (dx, dy, inside) = crown(g, y_band, height, extra, color, seam or color, rng, logo=logo)
    # che tóc thò ra ngoài thân mũ (phía trên vành) bằng nền
    x, y = grid()
    above = y < band_line(g, y_band, x) - 1
    outside = above & ~inside
    if g == 'female':                    # giữ đuôi tóc buộc (thò qua lỗ sau mũ)
        outside &= x < hd['cx'] + 12
    bg = background(g)
    x0, y0, x1, y1 = CROP
    base_up = np.asarray(Image.fromarray(_BASE[g][y0:y1, x0:x1].astype(np.uint8)).resize(bg.shape[1::-1], Image.BILINEAR), np.float32)
    differs = np.clip((np.abs(base_up - bg).max(-1) - 6) / 10, 0, 1)      # mọi điểm khác nền: tóc, mép tóc sáng
    cover = (outside * differs).astype(np.float32)
    cover = np.asarray(Image.fromarray((cover * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(13)).filter(ImageFilter.GaussianBlur(1.5 * SS)), np.float32) / 255
    cover *= outside
    rrgb, ralpha, rsh = brim(g, y_band, 13 if g == 'male' else 11, 1.0, color, under)
    cshadow = soft_shadow(calpha, 2, 2.5, 0.28)
    black = np.zeros(3, np.float32)
    out = compose([(bg, cover), (black, np.maximum(rsh, cshadow * (~inside))), (crgb, calpha), (rrgb, ralpha)])
    return to_frame(out)


# Bộ sưu tập (tham khảo dáng: mũ chạy mỏng kiểu Ciele GOCap / Nike AeroBill, visor, băng đô bông kiểu Halo/Nike, băng mảnh kiểu Buff)
# code, tên, mô tả, độ hiếm, giá Xu, cấp mở, hàm vẽ
CATALOG = [
    ('hat_cap_tempo_black', 'Mũ chạy Tempo Đen', 'Mũ vải mỏng, lỗ thoáng hai bên', 'rare', 60, 1, lambda g: cap(g, '#1d2128', under='#3d4a2a', logo='#b6ff3b')),
    ('hat_cap_tempo_white', 'Mũ chạy Tempo Trắng', 'Mũ vải mỏng, lỗ thoáng hai bên', 'rare', 60, 1, lambda g: cap(g, '#eef0f3', under='#8f99a8', logo='#2f6bff')),
    ('hat_cap_tempo_red', 'Mũ chạy Tempo Đỏ', 'Mũ vải mỏng, lỗ thoáng hai bên', 'rare', 60, 1, lambda g: cap(g, '#d4183f', under='#2a2f38', logo='#ffffff')),
    ('hat_cap_tempo_navy', 'Mũ chạy Tempo Xanh Than', 'Mặt dưới lưỡi trai màu cam', 'rare', 60, 1, lambda g: cap(g, '#1e2a4a', under='#e8741a', logo='#ff8a1f')),
    ('hat_cap_neon', 'Mũ chạy Neon', 'Nổi bật cả khi chạy đêm', 'epic', 150, 1, lambda g: cap(g, '#b6ff3b', under='#1d2128', logo='#1d2128')),
    ('hat_cap_legend', 'Mũ Huyền Thoại', 'Chỉ dành cho cấp 5', 'legendary', 0, 5, lambda g: cap(g, '#e9b73a', under='#1d2128', logo='#1d2128')),
    ('hat_visor_sun_white', 'Visor Trắng', 'Thoáng đỉnh đầu cho ngày nắng', 'rare', 50, 1, lambda g: visor(g, '#f4f6f8', under='#c9ced6', logo='#2f6bff')),
    ('hat_visor_sun_black', 'Visor Đen', 'Thoáng đỉnh đầu cho ngày nắng', 'rare', 50, 1, lambda g: visor(g, '#1d2128', under='#3a4150', logo='#b6ff3b')),
    ('hat_visor_sun_pink', 'Visor Hồng', 'Thoáng đỉnh đầu cho ngày nắng', 'rare', 50, 1, lambda g: visor(g, '#ff6b9a', under='#b8456b', logo='#ffffff')),
    ('hat_band_terry_red', 'Băng đô bông Đỏ', 'Thấm mồ hôi, không cay mắt', 'common', 25, 1, lambda g: headband(g, '#e11d48', 'terry', under_hair=g == 'male')),
    ('hat_band_terry_white', 'Băng đô bông Trắng', 'Thấm mồ hôi, không cay mắt', 'common', 25, 1, lambda g: headband(g, '#f4f6f8', 'terry', logo='#e11d48', under_hair=g == 'male')),
    ('hat_band_terry_black', 'Băng đô bông Đen', 'Thấm mồ hôi, không cay mắt', 'common', 25, 1, lambda g: headband(g, '#23272f', 'terry', logo='#b6ff3b', under_hair=g == 'male')),
    ('hat_band_terry_blue', 'Băng đô bông Xanh', 'Thấm mồ hôi, không cay mắt', 'common', 25, 1, lambda g: headband(g, '#2f6bff', 'terry', under_hair=g == 'male')),
    ('hat_band_thin_black', 'Băng đô mảnh Đen', 'Thun co giãn, không trượt', 'common', 15, 1, lambda g: headband(g, '#1d2128', 'thin', logo='#b6ff3b', under_hair=g == 'male')),
    ('hat_band_thin_lime', 'Băng đô mảnh Chanh', 'Thun co giãn, không trượt', 'common', 15, 1, lambda g: headband(g, '#b6ff3b', 'thin', logo='#1d2128', under_hair=g == 'male')),
    ('hat_band_thin_pink', 'Băng đô mảnh Hồng', 'Thun co giãn, không trượt', 'common', 15, 1, lambda g: headband(g, '#ff6b9a', 'thin', logo='#ffffff', under_hair=g == 'male')),
]
LAYERS = ROOT / 'public/character/layers'


def build(only=None):
    LAYERS.mkdir(parents=True, exist_ok=True)
    for code, *_rest, fn in CATALOG:
        if only and code not in only:
            continue
        for g in ('male', 'female'):
            im = fn(g)
            path = LAYERS / f'{code}_{g}.png'
            im.save(path, optimize=True)
            if path.stat().st_size > 120_000:
                im.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(path, optimize=True)
        print(code)


if __name__ == '__main__':
    import sys
    build(set(sys.argv[1:]) or None)
