"""Công cụ làm vật phẩm LAYER cho nhân vật 2D (docs/vat-pham/HUONG_DAN.md, ADR-017).

Bốn lệnh:

  prepare  Xuất ảnh nhân vật PNG 1024x1536 (đúng tỉ lệ khung) để đính kèm khi nhờ AI vẽ thêm món đồ.
             python3 scripts/character/make-layer.py prepare

  extract  Tách món đồ từ ảnh AI đã vẽ thêm lên nhân vật (ChatGPT, Gemini...):
           tự đưa về khung 900x1350, tự căn lệch/co giãn nhỏ, cân lại màu, so với ảnh nền
           rồi giữ đúng phần mới vẽ → PNG trong suốt cùng khung.
             python3 scripts/character/make-layer.py extract --gender male --slot hat --code hat_cap_red --input ai.png

  check    Kiểm tra file PNG do họa sĩ vẽ tay (đúng khung, có nền trong suốt, dung lượng) và xuất ảnh xem thử.
             python3 scripts/character/make-layer.py check --gender female --input hat_cap_red_female.png

  sql      In câu SQL thêm vật phẩm cho các lớp đã có trong public/character/layers/.
             python3 scripts/character/make-layer.py sql --code hat_cap_red --name "Mũ lưỡi trai Đỏ" --slot hat --rarity rare --price 50

Kết quả:
  public/character/layers/<code>_<gender>.png     lớp vật phẩm (đưa lên shop)
  scripts/character/out/<code>_<gender>_preview.png   ảnh xem thử: ảnh AI | nhân vật mặc đồ | lớp tách ra
Cần: pip install pillow numpy
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

FRAME_W, FRAME_H = 900, 1350
ROOT = Path(__file__).resolve().parents[2]
LAYER_DIR = ROOT / 'public/character/layers'
OUT_DIR = ROOT / 'scripts/character/out'
SLOTS = ['top', 'bottom', 'socks', 'shoes', 'accessory', 'watch', 'hair', 'glasses', 'hat', 'effect']
RARITIES = ['common', 'rare', 'epic', 'legendary']
# Vùng mặc định để tìm món đồ (tỉ lệ x0, y0, x1, y1 của khung). Nới bằng --region nếu món đồ to hơn.
REGIONS = {
    'hat': (0, 0, 1, 0.30), 'hair': (0, 0, 1, 0.36), 'glasses': (0.2, 0.08, 0.8, 0.28),
    'watch': (0, 0.28, 1, 0.62), 'accessory': (0, 0.14, 1, 0.75), 'top': (0, 0.15, 1, 0.52),
    'bottom': (0, 0.35, 1, 0.7), 'socks': (0, 0.74, 1, 0.93), 'shoes': (0, 0.78, 1, 1), 'effect': (0, 0, 1, 1),
}


def fail(msg):
    print(f'LỖI: {msg}')
    sys.exit(1)


def load_base(gender):
    p = ROOT / f'public/character/{gender}/base.webp'
    if not p.exists():
        fail(f'không thấy ảnh nền {p}')
    return np.asarray(Image.open(p).convert('RGB'), dtype=np.float32)


def to_frame(im):
    """Đưa ảnh bất kỳ về 900x1350: cùng tỉ lệ 2:3 thì co giãn; khác tỉ lệ thì cắt giữa cho đúng 2:3."""
    w, h = im.size
    notes = []
    ratio = w / h
    if abs(ratio - FRAME_W / FRAME_H) > 0.01:
        if ratio > FRAME_W / FRAME_H:
            nw = round(h * FRAME_W / FRAME_H)
            im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
        else:
            nh = round(w * FRAME_H / FRAME_W)
            im = im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
        notes.append(f'ảnh {w}x{h} không đúng tỉ lệ 2:3, đã cắt giữa — nên yêu cầu AI xuất 1024x1536')
    if im.size != (FRAME_W, FRAME_H):
        im = im.resize((FRAME_W, FRAME_H), Image.LANCZOS)
    return im, notes


def transform(img, s, dx, dy):
    """Co giãn quanh tâm theo s rồi dịch (dx, dy) — trả về mảng cùng kích thước."""
    h, w = img.shape[:2]
    pil = Image.fromarray(img.astype(np.uint8))
    # affine ngược: điểm đích (x, y) lấy từ nguồn ((x - cx - dx)/s + cx, ...)
    cx, cy = w / 2, h / 2
    a = 1 / s
    coeffs = (a, 0, cx - (cx + dx) * a, 0, a, cy - (cy + dy) * a)
    return np.asarray(pil.transform((w, h), Image.AFFINE, coeffs, resample=Image.BILINEAR, fillcolor=None), dtype=np.float32)


def gray(a):
    return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114


def region_mask(slot, region_arg, W, H):
    r = [float(v) for v in region_arg.split(',')] if region_arg else REGIONS[slot]
    if max(r) > 1.0001:           # nhập theo pixel khung
        x0, y0, x1, y1 = [int(v) for v in r]
    else:
        x0, y0, x1, y1 = int(r[0] * W), int(r[1] * H), int(r[2] * W), int(r[3] * H)
    m = np.zeros((H, W), bool)
    m[y0:y1, x0:x1] = True
    return m, (x0, y0, x1, y1)


def transform_gray(g, s, dx, dy):
    """Như transform nhưng cho ảnh xám, trả kèm mặt nạ điểm hợp lệ (phần mép lộ ra sau khi dịch là không hợp lệ)."""
    h, w = g.shape
    la = Image.merge('LA', (Image.fromarray(g.astype(np.uint8)), Image.new('L', (w, h), 255)))
    cx, cy = w / 2, h / 2
    a = 1 / s
    t = la.transform((w, h), Image.AFFINE, (a, 0, cx - (cx + dx) * a, 0, a, cy - (cy + dy) * a), resample=Image.BILINEAR)
    arr = np.asarray(t, dtype=np.float32)
    return arr[..., 0], arr[..., 1] > 250


def align(ai, base, outside):
    """Tìm co giãn + dịch nhỏ để ảnh AI khớp ảnh nền, so trên phần NGOÀI vùng món đồ.
    Chuẩn hóa độ sáng/độ tương phản trước khi so (AI hay đổi sáng nhẹ). Tìm thô → mịn theo 4 mức phân giải."""
    levels = ((8, np.arange(0.95, 1.0501, 0.01), 5), (4, 0.005, 2), (2, 0.0025, 1), (1, 0.001, 1))
    best = (1.0, 0.0, 0.0)
    residual = 0.0
    g_ai, g_base = gray(ai), gray(base)
    for factor, scales, radius in levels:
        h, w = FRAME_H // factor, FRAME_W // factor
        small = lambda g: np.asarray(Image.fromarray(g.astype(np.uint8)).resize((w, h), Image.BILINEAR), dtype=np.float32)
        b, src = small(g_base), small(g_ai)
        o = np.asarray(Image.fromarray(outside.astype(np.uint8) * 255).resize((w, h), Image.NEAREST)) > 0
        s0, dx0, dy0 = best
        cand = scales if isinstance(scales, np.ndarray) else [s0 - scales, s0, s0 + scales]
        top = (1e9, best)
        for sc in cand:
            for ddy in range(-radius, radius + 1):
                for ddx in range(-radius, radius + 1):
                    dx, dy = dx0 / factor + ddx, dy0 / factor + ddy
                    t, valid = transform_gray(src, sc, dx, dy)
                    m = o & valid
                    x, y = t[m], b[m]
                    # so sau khi chuẩn hóa: bỏ khác biệt độ sáng/tương phản toàn ảnh
                    err = np.abs((x - x.mean()) / (x.std() + 1e-6) - (y - y.mean()) / (y.std() + 1e-6)).mean()
                    if err < top[0]:
                        top = (err, (sc, dx * factor, dy * factor))
        best = top[1]
        residual = top[0]
    return best, residual * 100


def match_colors(ai, base, outside):
    """Cân màu từng kênh (a*x + b) theo phần ngoài vùng món đồ — AI hay làm ảnh sáng/tối hơn một chút."""
    out = ai.copy()
    for c in range(3):
        x, y = ai[..., c][outside].astype(np.float64), base[..., c][outside].astype(np.float64)
        a = np.cov(x, y)[0, 1] / max(x.var(), 1e-6)
        b = y.mean() - a * x.mean()
        out[..., c] = np.clip(ai[..., c] * a + b, 0, 255)
    return out


def remove_small(mask, min_area):
    """Bỏ các đốm nhỏ hơn min_area pixel (không cần scipy)."""
    im = Image.fromarray((mask * 255).astype(np.uint8))
    arr = np.asarray(im).copy()
    keep = np.zeros_like(arr, dtype=bool)
    ys, xs = np.nonzero(arr == 255)
    visited = np.zeros_like(arr, dtype=bool)
    for y, x in zip(ys, xs):
        if visited[y, x]:
            continue
        tmp = Image.fromarray(arr).copy()          # PIL 12: ảnh tạo từ numpy là chỉ đọc
        ImageDraw.floodfill(tmp, (int(x), int(y)), 128)
        comp = np.asarray(tmp) == 128
        visited |= comp
        if comp.sum() >= min_area:
            keep |= comp
    return keep


def fill_holes(mask):
    """Lấp lỗ bên trong món đồ (vd. mũ đen trên tóc đen nên chỗ đó không khác ảnh nền)."""
    h, w = mask.shape
    pad = np.zeros((h + 2, w + 2), np.uint8)
    pad[1:-1, 1:-1] = mask * 255
    im = Image.fromarray(pad).copy()
    ImageDraw.floodfill(im, (0, 0), 128)
    outside = np.asarray(im)[1:-1, 1:-1] == 128
    return ~outside


def checker(w, h, size=24):
    y, x = np.mgrid[0:h, 0:w]
    c = ((x // size + y // size) % 2) * 40 + 200
    return np.stack([c, c, c], -1).astype(np.float32)


def composite(base, layer_rgba):
    a = layer_rgba[..., 3:4] / 255
    return base * (1 - a) + layer_rgba[..., :3] * a


def save_layer(rgba, path):
    im = Image.fromarray(rgba.astype(np.uint8), 'RGBA')
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, optimize=True)
    if path.stat().st_size > 300_000:          # nén bảng màu nếu nặng
        im.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(path, optimize=True)
    return path.stat().st_size


def save_preview(panels, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    tiles = [Image.fromarray(np.clip(p, 0, 255).astype(np.uint8)).resize((450, 675), Image.LANCZOS) for p in panels]
    sheet = Image.new('RGB', (450 * len(tiles) + 10 * (len(tiles) - 1), 675), (20, 24, 32))
    for i, t in enumerate(tiles):
        sheet.paste(t, (i * 460, 0))
    sheet.save(path)


def cmd_extract(a):
    if a.slot not in SLOTS:
        fail(f'--slot phải là một trong {SLOTS}')
    base = load_base(a.gender)
    src = Image.open(a.input).convert('RGB')
    im, notes = to_frame(src)
    ai = np.asarray(im, dtype=np.float32)
    region, box = region_mask(a.slot, a.region, FRAME_W, FRAME_H)
    outside = ~region
    if a.slot == 'effect':                     # hiệu ứng phủ cả khung: căn theo cả ảnh
        outside = np.ones_like(region)

    (s, dx, dy), residual = align(ai, base, outside)
    ai_al = transform(ai, s, dx, dy)
    valid = transform_gray(np.full(ai.shape[:2], 255.0), s, dx, dy)[1]      # phần ảnh AI phủ tới sau khi dịch
    ai_al = match_colors(ai_al, base, outside & valid)

    dist = np.sqrt(((ai_al - base) ** 2).sum(-1))
    m = (dist > a.threshold) & region & valid
    im_m = Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.MedianFilter(5))
    im_m = im_m.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5))          # khép kẽ hở
    m = np.asarray(im_m) > 127
    m = remove_small(m, a.min_area)
    m = fill_holes(m) & region
    alpha = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(a.feather)), dtype=np.float32)
    rgba = np.dstack([ai_al, alpha])
    rgba[alpha == 0, :3] = 0

    out = LAYER_DIR / f'{a.code}_{a.gender}.png'
    size = save_layer(rgba, out)
    preview = OUT_DIR / f'{a.code}_{a.gender}_preview.png'
    save_preview([ai_al, composite(base, rgba), composite(checker(FRAME_W, FRAME_H), rgba)], preview)

    cover = m.sum() / max(region.sum(), 1)
    ys, xs = np.nonzero(m)
    bbox = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())] if len(xs) else None
    warn = list(notes)
    if residual > 25:
        warn.append(f'ảnh AI lệch dáng nhiều so với ảnh nền (sai số {residual:.1f}) — AI đã vẽ lại người; tạo lại với prompt "giữ nguyên"')
    if bbox is None:
        warn.append('không tìm thấy món đồ — giảm --threshold hoặc nới --region')
    elif cover > 0.35 and a.slot != 'effect':
        warn.append(f'phần tách ra chiếm {cover:.0%} vùng — có thể AI đổi cả ảnh; tăng --threshold hoặc thu nhỏ --region')
    if bbox and (bbox[0] <= box[0] + 1 or bbox[1] <= box[1] + 1 or bbox[2] >= box[2] - 2 or bbox[3] >= box[3] - 2) and a.slot != 'effect':
        warn.append('món đồ chạm mép vùng tìm kiếm — có thể bị cắt; nới --region')
    if size > 300_000:
        warn.append(f'file {size // 1000} KB > 300 KB')
    report = {
        'layer': str(out.relative_to(ROOT)), 'preview': str(preview.relative_to(ROOT)),
        'align': {'scale': round(s, 3), 'dx': round(dx, 1), 'dy': round(dy, 1), 'residual': round(float(residual), 1)},
        'bbox': bbox, 'coverage_of_region': round(float(cover), 3), 'kb': round(size / 1000, 1), 'warnings': warn,
        'ok': not any(w.startswith(('ảnh AI lệch', 'không tìm thấy')) for w in warn),
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))


def cmd_prepare(a):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for g in ('male', 'female'):
        base = Image.fromarray(load_base(g).astype(np.uint8)).resize((1024, 1536), Image.LANCZOS)
        out = OUT_DIR / f'nhan_vat_{g}_1024x1536.png'
        base.save(out)
        print(out.relative_to(ROOT))


def cmd_check(a):
    base = load_base(a.gender)
    im = Image.open(a.input)
    errors, warn = [], []
    if im.size != (FRAME_W, FRAME_H):
        errors.append(f'kích thước {im.size[0]}x{im.size[1]}, phải đúng {FRAME_W}x{FRAME_H} (không cắt sát khi xuất)')
    if im.mode not in ('RGBA', 'LA', 'P') or 'A' not in im.convert('RGBA').getbands():
        errors.append('không có kênh trong suốt')
    rgba = np.asarray(im.convert('RGBA').resize((FRAME_W, FRAME_H)), dtype=np.float32)
    a_ch = rgba[..., 3]
    opaque = (a_ch > 8).mean()
    if opaque > 0.6:
        errors.append(f'{opaque:.0%} khung bị phủ kín — nền phải trong suốt, chỉ giữ món đồ')
    if opaque == 0:
        errors.append('file trống')
    corners = [a_ch[0, 0], a_ch[0, -1], a_ch[-1, 0], a_ch[-1, -1]]
    if max(corners) > 0 and a.slot != 'effect':
        warn.append('góc ảnh không trong suốt — kiểm tra đã ẩn layer ảnh nền khi xuất chưa')
    kb = Path(a.input).stat().st_size / 1000
    if kb > 300:
        warn.append(f'file {kb:.0f} KB > 300 KB — nén bằng pngquant / Squoosh')
    name = Path(a.input).stem
    preview = OUT_DIR / f'{name}_check.png'
    save_preview([composite(base, rgba), composite(checker(FRAME_W, FRAME_H), rgba)], preview)
    print(json.dumps({'ok': not errors, 'errors': errors, 'warnings': warn, 'coverage': round(float(opaque), 3), 'kb': round(kb, 1),
                      'preview': str(preview.relative_to(ROOT))}, ensure_ascii=False, indent=2))
    if errors:
        sys.exit(1)


def cmd_sql(a):
    if a.slot not in SLOTS or a.rarity not in RARITIES:
        fail('slot hoặc rarity không hợp lệ')
    urls = {g: f'/character/layers/{a.code}_{g}.png' for g in ('male', 'female') if (LAYER_DIR / f'{a.code}_{g}.png').exists()}
    if not urls:
        fail(f'chưa có file lớp nào cho {a.code} trong {LAYER_DIR.relative_to(ROOT)}')
    q = lambda s: "'" + s.replace("'", "''") + "'"
    desc = q(a.description) if a.description else 'null'
    print(f"""insert into public.avatar_items (code, name, description, category, rarity, asset_url, render_kind, layer_urls, price_xu, unlock_level, sort)
values ({q(a.code)}, {q(a.name)}, {desc}, {q(a.slot)}, {q(a.rarity)}, 'layer', 'LAYER', {q(json.dumps(urls))}::jsonb, {a.price}, {a.level}, {a.sort})
on conflict (code) where code is not null do update set name = excluded.name, description = excluded.description,
  category = excluded.category, rarity = excluded.rarity, render_kind = 'LAYER', layer_urls = excluded.layer_urls,
  price_xu = excluded.price_xu, unlock_level = excluded.unlock_level, is_active = true;""")
    if len(urls) == 1:
        print(f'-- Chỉ có bản {next(iter(urls))}: giới còn lại sẽ dùng chung bản này.')


def main():
    p = argparse.ArgumentParser(description='Làm vật phẩm lớp ảnh cho nhân vật 2D RaceHub')
    sub = p.add_subparsers(dest='cmd', required=True)
    sub.add_parser('prepare', help='xuất ảnh nhân vật PNG 1024x1536 để gửi cho AI')
    e = sub.add_parser('extract', help='tách món đồ từ ảnh AI đã vẽ thêm lên nhân vật')
    e.add_argument('--gender', choices=['male', 'female'], required=True)
    e.add_argument('--slot', required=True, help=' | '.join(SLOTS))
    e.add_argument('--code', required=True, help='mã vật phẩm, vd. hat_cap_red')
    e.add_argument('--input', required=True, help='ảnh AI trả về (PNG/JPG/WEBP)')
    e.add_argument('--region', help='vùng tìm món đồ: x0,y0,x1,y1 theo tỉ lệ (0..1) hoặc pixel khung 900x1350')
    e.add_argument('--threshold', type=float, default=34, help='độ khác màu tối thiểu để tính là món đồ (mặc định 34)')
    e.add_argument('--min-area', type=int, default=120, help='bỏ đốm nhỏ hơn số pixel này')
    e.add_argument('--feather', type=float, default=1.2, help='làm mềm mép (px)')
    c = sub.add_parser('check', help='kiểm tra PNG họa sĩ vẽ tay')
    c.add_argument('--gender', choices=['male', 'female'], required=True)
    c.add_argument('--input', required=True)
    c.add_argument('--slot', default='hat')
    s = sub.add_parser('sql', help='in câu SQL thêm vật phẩm')
    s.add_argument('--code', required=True)
    s.add_argument('--name', required=True)
    s.add_argument('--slot', required=True)
    s.add_argument('--rarity', default='common')
    s.add_argument('--price', type=float, default=0)
    s.add_argument('--level', type=int, default=1)
    s.add_argument('--sort', type=int, default=100)
    s.add_argument('--description')
    a = p.parse_args()
    {'prepare': cmd_prepare, 'extract': cmd_extract, 'check': cmd_check, 'sql': cmd_sql}[a.cmd](a)


if __name__ == '__main__':
    main()
