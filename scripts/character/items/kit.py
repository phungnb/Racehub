"""Vẽ bộ đồ CLB (áo, quần, tất có họa tiết) thành lớp PNG khung chuẩn 900x1350 cho nhân vật 2D.

Khác với đổi màu (TINT) chỉ tô một màu, script này tô HỌA TIẾT (mảng màu chéo, chấm bi, chữ, logo) vào đúng
mặt nạ vùng áo / quần / tất của ảnh nền, rồi nhân với độ sáng của ảnh nền (đã làm mịn) để giữ nếp vải và bóng đổ.
Vì vẽ trên chính mặt nạ nên lớp khớp 100% với nhân vật, không cần AI.

  python3 scripts/character/items/kit.py [mã ...]      # sinh bộ sưu tập (hoặc vài mã) vào public/character/layers/
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 900, 1350
ROOT = Path(__file__).resolve().parents[3]
LAYERS = ROOT / 'public/character/layers'
FONT = '/usr/share/fonts/truetype/liberation/LiberationSans-BoldItalic.ttf'


def hexrgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float32)


_CACHE = {}


def fill_holes(mask):
    """Lấp lỗ bên trong vùng (vệt in, logo của đồ gốc không nằm trong mặt nạ) — loang từ góc ảnh."""
    im = Image.fromarray(((mask > 0.5) * 255).astype(np.uint8)).copy()      # copy: ảnh từ numpy là chỉ đọc
    ImageDraw.floodfill(im, (0, 0), 128)
    a = np.asarray(im)
    return np.maximum(mask, (a == 0).astype(np.float32))


def sock_mask(base, mask, shoes):
    """Mặt nạ tất dựng lại theo hình học (mặt nạ gốc chỉ bắt được vài mảng sáng).
    Mỗi chân: tất là ống nằm giữa mép da (trên) và mép giày (dưới). Đường bao chân lấy từ độ chênh so với nền xám
    của từng hàng; mỗi hàng lấp kín từ mép trái tới mép phải của chân."""
    bg = np.median(np.concatenate([base[:, 10:160], base[:, 740:890]], 1), axis=1)[:, None, :]
    fg = np.abs(base - bg).max(-1) > 10
    skin = (base[..., 0] - base[..., 2]) > 14
    shoe = np.asarray(Image.fromarray(((shoes > 0.3) * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3)), np.float32) > 127
    has = shoe.any(0)
    shoe_top = np.where(has, shoe.argmax(0), H)
    out = np.zeros((H, W), np.float32)
    ys, xs = np.where(mask > 0.5)
    mid = (xs.min() + xs.max()) / 2
    for side in (xs < mid, xs >= mid):                       # từng chân
        lx, rx = xs[side].min() - 30, xs[side].max() + 30
        ty, by = ys[side].min() - 45, ys[side].max() + 10
        top = None
        for y in range(ty, by):                              # mép trên của tất: hàng đầu tiên phần lớn không phải da
            row = fg[y, lx:rx] & (np.arange(lx, rx) < W)
            if row.sum() >= 8 and (~skin[y, lx:rx][row]).mean() > 0.75:
                top = y
                break
        if top is None:
            continue
        span = None
        for y in range(top, by + 40):
            cols = np.where(fg[y, lx:rx] & ~shoe[y, lx:rx] & (y < shoe_top[lx:rx]) & ~skin[y, lx:rx])[0]
            if len(cols) < 3:
                continue
            l, r = lx + cols.min(), lx + cols.max()
            if span is None:
                span = (l, r)
                stop = int(np.median(shoe_top[l:r + 1][has[l:r + 1]])) + 16 if has[l:r + 1].any() else by + 40
            if y >= stop:
                break
            # ống tất không phình ra: giới hạn quanh bề ngang ở cổ tất (bỏ sàn / bóng cạnh giày)
            l, r = max(l, span[0] - 6), min(r, span[1] + 6)
            if r - l >= 3:
                out[y, l:r + 1] = 1
    im = Image.fromarray((out * 255).astype(np.uint8)).filter(ImageFilter.MedianFilter(7))
    m = np.asarray(im, np.float32) / 255 * ~shoe
    return np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8)), np.float32) / 255


def load(g, part):
    key = (g, part)
    if key not in _CACHE:
        base = np.asarray(Image.open(ROOT / f'public/character/{g}/base.webp').convert('RGB'), np.float32)
        mask = np.asarray(Image.open(ROOT / f'public/character/{g}/{part}.png').convert('L'), np.float32) / 255
        if part == 'socks':
            shoes = np.asarray(Image.open(ROOT / f'public/character/{g}/shoes.png').convert('L'), np.float32) / 255
            mask = sock_mask(base, mask, shoes)
        else:
            mask = fill_holes(mask)
        _CACHE[key] = (base, mask)
    return _CACHE[key]


def shading(base, mask, blur=5):
    """Độ sáng tương đối của vải (giữ nếp gấp, bóng đổ; làm mịn để mất họa tiết in của áo gốc)."""
    lum = base[..., 0] * 0.299 + base[..., 1] * 0.587 + base[..., 2] * 0.114
    weight = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur)), np.float32) / 255
    lum_m = np.asarray(Image.fromarray(np.clip(lum * mask, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur)), np.float32)
    smooth = lum_m / np.maximum(weight, 1e-3)
    ref = np.percentile(lum[mask > 0.5], 70)
    return np.clip(smooth / max(ref, 1), 0.45, 1.25)


def bbox(mask):
    ys, xs = np.where(mask > 0.5)
    return xs.min(), ys.min(), xs.max(), ys.max()


def grid(mask):
    x0, y0, x1, y1 = bbox(mask)
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    return (xs - x0) / (x1 - x0), (ys - y0) / (y1 - y0), (x0, y0, x1, y1)


def halftone(xs, ys, pitch, radius):
    """Chấm bi: lưới xen kẽ, bán kính (px) theo từng điểm → mặt nạ 0..1."""
    row = np.floor(ys / pitch)
    ox = (row % 2) * pitch / 2
    cx = (np.floor((xs - ox) / pitch) + 0.5) * pitch + ox
    cy = (row + 0.5) * pitch
    d = np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2)
    return np.clip(radius - d + 0.5, 0, 1)


def text_layer(text, size, angle, center, fill='#ffc21a', stroke='#123a9c', stroke_w=3):
    """Chữ nghiêng (xoay theo đường chéo áo) → ảnh RGBA khung chuẩn."""
    font = ImageFont.truetype(FONT, size)
    tmp = Image.new('RGBA', (size * len(text) + 40, size + 40), (0, 0, 0, 0))
    ImageDraw.Draw(tmp).text((20, 10), text, font=font, fill=fill, stroke_width=stroke_w, stroke_fill=stroke)
    tmp = tmp.crop(tmp.getbbox()).rotate(angle, resample=Image.BICUBIC, expand=True)
    frame = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    frame.paste(tmp, (int(center[0] - tmp.width / 2), int(center[1] - tmp.height / 2)), tmp)
    return np.asarray(frame, np.float32)


def badge(center, r, ring='#123a9c', face='#ffc21a', mark='#ff7a1a'):
    """Logo tròn giản lược của CLB (vòng xanh, nền vàng, 3 vằn hổ cam) → RGBA khung chuẩn."""
    S = 4
    im = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx, cy, R = center[0] * S, center[1] * S, r * S
    d.ellipse((cx - R, cy - R, cx + R, cy + R), fill=ring)
    d.ellipse((cx - R * 0.78, cy - R * 0.78, cx + R * 0.78, cy + R * 0.78), fill=face)
    for k in (-0.38, 0, 0.38):             # vằn hổ
        d.polygon([(cx + k * R - R * 0.12, cy - R * 0.55), (cx + k * R + R * 0.12, cy - R * 0.55), (cx + k * R, cy + R * 0.1)], fill=mark)
    d.ellipse((cx - R * 0.22, cy + R * 0.12, cx + R * 0.22, cy + R * 0.5), fill=ring)   # mũi / miệng
    return np.asarray(im.resize((W, H), Image.LANCZOS), np.float32)


def over(rgb, layer):
    a = layer[..., 3:4] / 255
    return rgb * (1 - a) + layer[..., :3] * a


def finish(rgb, mask, base, blur=5):
    rgb = np.clip(rgb * shading(base, mask, blur)[..., None], 0, 255)
    out = np.zeros((H, W, 4), np.uint8)
    out[..., :3] = rgb.astype(np.uint8)
    out[..., 3] = (np.clip(mask, 0, 1) * 255).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


BLUE, SKY, NAVY = hexrgb('#1f4fd8'), hexrgb('#3aa0ff'), hexrgb('#123a9c')
YELLOW, ORANGE = hexrgb('#ffc21a'), hexrgb('#ff8a1f')


def nbnr_top(g):
    base, mask = load(g, 'top')
    s, t, (x0, y0, x1, y1) = grid(mask)
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    # Đường chéo từ vai trái (người xem) xuống hông phải: trên xanh dương, dưới vàng → cam
    edge = 0.30 + 0.55 * s
    d = t - edge
    rgb = np.broadcast_to(BLUE, (H, W, 3)).copy()
    # dải xanh sáng song song phía trên đường chéo
    sky = np.clip(1 - np.abs(d + 0.17) / 0.05, 0, 1)
    rgb = rgb * (1 - sky[..., None]) + SKY * sky[..., None]
    low = np.clip(d / 0.01, 0, 1)
    grad = np.clip((t - edge) / 0.7, 0, 1)[..., None]
    rgb = rgb * (1 - low[..., None]) + (YELLOW * (1 - grad) + ORANGE * grad) * low[..., None]
    # viền cam dọc đường chéo
    stripe = np.clip(1 - np.abs(d - 0.035) / 0.022, 0, 1)
    rgb = rgb * (1 - stripe[..., None]) + ORANGE * stripe[..., None]
    # chấm bi cam trong mảng vàng, to dần xuống dưới
    pitch = (x1 - x0) / 22
    dots = halftone(xs, ys, pitch, pitch * (0.12 + 0.3 * np.clip(d / 0.5, 0, 1))) * (d > 0.07)
    rgb = rgb * (1 - 0.45 * dots[..., None]) + ORANGE * 0.45 * dots[..., None]
    # chữ NBNR chạy dọc đường chéo (trong mảng xanh), logo tròn ngực phải
    ang = -np.degrees(np.arctan2(0.55 * (y1 - y0), (x1 - x0)))
    # nam khoanh tay che giữa áo → chữ đặt cao trên ngực trái
    size = int((x1 - x0) * (0.19 if g == 'male' else 0.22))
    tx = x0 + (x1 - x0) * (0.36 if g == 'male' else 0.47)
    ty = y0 + (y1 - y0) * (0.2 if g == 'male' else 0.36)
    rgb = over(rgb, text_layer('NBNR', size, ang, (tx, ty), stroke_w=max(2, size // 14)))
    bx = x0 + (x1 - x0) * (0.7 if g == 'male' else 0.66)
    by = y0 + (y1 - y0) * (0.13 if g == 'male' else 0.26)
    rgb = over(rgb, badge((bx, by), (x1 - x0) * (0.045 if g == 'male' else 0.075), ring='#ffffff', face='#ffc21a'))
    return finish(rgb, mask, base, blur=6)


def nbnr_bottom(g):
    base, mask = load(g, 'bottom')
    s, t, (x0, y0, x1, y1) = grid(mask)
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    rgb = np.broadcast_to(BLUE, (H, W, 3)).copy()
    # mảng vàng chéo ở ống quần trái (người xem nhìn thấy bên phải) + viền cam, chấm bi
    d = s - (0.72 + 0.35 * (1 - t))
    low = np.clip(d / 0.01, 0, 1)
    rgb = rgb * (1 - low[..., None]) + YELLOW * low[..., None]
    stripe = np.clip(1 - np.abs(d + 0.03) / 0.018, 0, 1)
    rgb = rgb * (1 - stripe[..., None]) + ORANGE * stripe[..., None]
    pitch = (x1 - x0) / 20
    dots = halftone(xs, ys, pitch, pitch * 0.28) * (d > 0.04)
    rgb = rgb * (1 - 0.4 * dots[..., None]) + ORANGE * 0.4 * dots[..., None]
    # cạp quần xanh đậm
    band = np.clip((0.1 - t) / 0.02, 0, 1)
    rgb = rgb * (1 - band[..., None]) + NAVY * band[..., None]
    # logo hổ ở ống quần phải (người xem thấy bên trái)
    rgb = over(rgb, badge((x0 + (x1 - x0) * 0.2, y0 + (y1 - y0) * 0.72), (x1 - x0) * 0.055))
    return finish(rgb, mask, base, blur=4)


def nbnr_socks(g):
    """Tất đôi lệch màu như mẫu: chiếc bên trái (người xem) vàng, bên phải xanh; chấm bi màu đối lập, cổ tất cam."""
    base, mask = load(g, 'socks')
    s, t, (x0, y0, x1, y1) = grid(mask)
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    left = s < 0.5
    body = np.where(left[..., None], YELLOW, BLUE)
    dotc = np.where(left[..., None], BLUE, YELLOW)
    rgb = body.copy()
    pitch = 7.0
    dots = halftone(xs, ys, pitch, 1.3 + 1.2 * np.clip(1 - t, 0, 1))
    rgb = rgb * (1 - 0.8 * dots[..., None]) + dotc * 0.8 * dots[..., None]
    cuff = np.clip((0.13 - t) / 0.03, 0, 1)
    rgb = rgb * (1 - cuff[..., None]) + np.where(left[..., None], ORANGE, NAVY) * cuff[..., None]
    return finish(rgb, mask, base, blur=2)


# code, tên, mô tả, ô, độ hiếm, giá Xu, cấp mở, hàm vẽ
CATALOG = [
    ('top_nbnr_club', 'Áo CLB NBNR', 'No Beer No Run — xanh dương / vàng, chữ NBNR chéo ngực', 'top', 'epic', 150, 1, nbnr_top),
    ('bottom_nbnr_club', 'Quần CLB NBNR', 'Quần xanh dương, mảng vàng chấm bi, logo hổ', 'bottom', 'rare', 80, 1, nbnr_bottom),
    ('socks_nbnr_pair', 'Tất đôi NBNR', 'Một chiếc vàng một chiếc xanh, chấm bi', 'socks', 'rare', 40, 1, nbnr_socks),
]


def build(only=None):
    LAYERS.mkdir(parents=True, exist_ok=True)
    for code, *_rest, fn in CATALOG:
        if only and code not in only:
            continue
        for g in ('male', 'female'):
            im = fn(g)
            path = LAYERS / f'{code}_{g}.png'
            im.save(path, optimize=True)
            if path.stat().st_size > 250_000:
                im.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(path, optimize=True)
        print(code)


if __name__ == '__main__':
    import sys
    build(set(sys.argv[1:]) or None)
