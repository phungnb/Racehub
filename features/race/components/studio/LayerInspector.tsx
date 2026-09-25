'use client'

// Bảng chỉnh một lớp đang chọn: chữ (nguồn, font, cỡ, màu, hiệu ứng), ảnh, QR, hình + thao tác chung (xoay, mờ, thứ tự, khóa, xóa)
import { ArrowDownToLine, ArrowUpToLine, ChevronDown, ChevronUp, Copy, Eye, EyeOff, ImagePlus, Lock, Trash2, Unlock } from 'lucide-react'
import { Button, Input } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import {
  ALIGNS, FONT_GROUPS, FONTS, IMAGE_ROLES, QR_SOURCES, SHAPES, TEXT_FX,
  type Binds, type FontGroup, type FontKey, type Layer, type Palette, type QrLayer, type Size,
} from '../../model/design'
import { FONT_FAMILIES } from '../designFonts'
import { Chips, FileButton, PaintPicker, Pill, Slider } from './bits'

export function previewFamily(f: FontKey) {
  if (f === 'sans') return 'var(--font-be-vietnam)'
  if (f === 'mono') return 'var(--font-jetbrains)'
  return FONT_FAMILIES[f as keyof typeof FONT_FAMILIES] ?? 'inherit'
}

/** Chọn font theo nhóm: mỗi ô hiển thị chữ mẫu bằng chính font đó */
export function FontPicker({ value, italic, sample, onChange }: { value: FontKey; italic: boolean; sample: string; onChange: (f: FontKey) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-fg-muted">Font chữ <span className="text-fg-subtle">· {FONTS[value].label}</span></p>
      {(Object.keys(FONT_GROUPS) as FontGroup[]).map((g) => (
        <div key={g} className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">{FONT_GROUPS[g]}</p>
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label={FONT_GROUPS[g]}>
            {(Object.keys(FONTS) as FontKey[]).filter((f) => FONTS[f].group === g).map((f) => (
              <button key={f} type="button" aria-pressed={value === f} onClick={() => onChange(f)} title={FONTS[f].label}
                className={cn('flex w-20 shrink-0 flex-col items-center rounded-lg border px-1 py-1.5', value === f ? 'border-brand bg-brand/15' : 'border-border')}>
                <span className="max-w-full truncate text-lg leading-tight" style={{ fontFamily: previewFamily(f), fontWeight: FONTS[f].weight, fontStyle: italic ? 'italic' : 'normal' }}>{sample}</span>
                <span className="mt-0.5 max-w-full truncate text-[9px] text-fg-muted">{FONTS[f].label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export interface InspectorProps {
  layer: Layer
  size: Size
  binds: Binds
  palette: Palette
  colorLabels: Record<string, string>
  busy: boolean
  onChange: (patch: Partial<Layer>, record?: boolean) => void
  onUpload: (file: File | undefined, apply: (url: string, aspect: number) => void) => void
  onAction: (a: 'delete' | 'duplicate' | 'up' | 'down' | 'top' | 'bottom') => void
  /** QR phí tham gia đã lưu (ảnh / mã VietQR) để điền nhanh */
  feePreset?: Partial<QrLayer> | null
}

export function LayerInspector({ layer: l, size, binds, palette, colorLabels, busy, onChange, onUpload, onAction, feePreset }: InspectorProps) {
  const set = (p: Partial<Layer>) => onChange(p)
  return (
    <div className="space-y-4">
      {l.type === 'text' && (
        <>
          <div className="space-y-1.5">
            <label htmlFor="ly-bind" className="text-xs font-medium text-fg-muted">Nội dung</label>
            <select id="ly-bind" value={l.bind} onChange={(e) => set({ bind: e.target.value })}
              className="h-11 w-full rounded-xl border border-border bg-surface-2 px-3 text-sm">
              <option value="custom">Chữ tự nhập</option>
              {Object.entries(binds).map(([k, b]) => <option key={k} value={k}>{b.label} (mỗi VĐV một giá trị)</option>)}
            </select>
            {l.bind === 'custom'
              ? <Input value={l.text} maxLength={120} onChange={(e) => set({ text: e.target.value })} placeholder="VD: No Beer No Run" aria-label="Chữ" />
              : <p className="text-[11px] text-fg-muted">Tự điền theo từng VĐV. Xem trước: “{binds[l.bind]?.sample}”.</p>}
          </div>
          <FontPicker value={l.font} italic={l.italic} sample={l.bind === 'number' ? '0421' : 'Aă'} onChange={(font) => set({ font })} />
          <div className="flex flex-wrap gap-1.5">
            <Pill on={l.italic} onClick={() => set({ italic: !l.italic })}><i>Nghiêng</i></Pill>
            <Pill on={l.upper} onClick={() => set({ upper: !l.upper })}>IN HOA</Pill>
          </div>
          <Slider label="Cỡ chữ" value={l.size} min={10} max={600} unit="px" onChange={(size) => set({ size })} />
          <Slider label="Bề ngang tối đa (chữ dài tự co)" value={Math.round(l.w * 100)} min={5} max={120} unit="%" onChange={(v) => set({ w: v / 100 })} />
          <Slider label="Giãn chữ" value={Math.round(l.spacing * 100)} min={-10} max={100} onChange={(v) => set({ spacing: v / 100 })} />
          <Chips label="Căn lề" value={l.align} options={ALIGNS} onChange={(align) => set({ align })} />
          <PaintPicker label="Màu chữ" value={l.color} palette={palette} labels={colorLabels} onChange={(color) => set({ color })} />
          <Chips label="Hiệu ứng · nền chữ" value={l.fx} options={TEXT_FX} onChange={(fx) => set({ fx })} />
          {l.fx !== 'none' && l.fx !== 'outline' && (
            <PaintPicker label={l.fx === 'marker' ? 'Màu bút bôi' : ['box', 'pill', 'slant'].includes(l.fx) ? 'Màu nền chữ' : 'Màu hiệu ứng'}
              value={l.fx_color} palette={palette} labels={colorLabels} onChange={(fx_color) => set({ fx_color })} />
          )}
        </>
      )}

      {l.type === 'image' && (
        <>
          <Chips label="Loại" value={l.role} options={IMAGE_ROLES} onChange={(role) => set({ role })} />
          <div className="flex items-center gap-3">
            <FileButton disabled={busy} label="Đổi ảnh" onPick={(f) => onUpload(f, (src, a) => set({ src, h: (l.w * size.w) / a / size.h }))}
              className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-dashed border-border bg-surface-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- ảnh vừa tải lên kho race-media */}
              {l.src ? <img src={l.src} alt="" className="h-full w-full object-contain" /> : <ImagePlus className="size-5 text-fg-subtle" aria-hidden />}
            </FileButton>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-xs text-fg-muted">{busy ? 'Đang tải ảnh…' : l.src ? 'Chạm ảnh để đổi. PNG nền trong suốt đẹp nhất.' : 'Chạm để tải ảnh lên (PNG nền trong suốt đẹp nhất).'}</p>
              {l.src && <Button size="sm" variant="ghost" onClick={() => set({ src: null })}>Bỏ ảnh</Button>}
            </div>
          </div>
          {l.role === 'sponsor' && (
            <Input value={l.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} placeholder="Tên nhà tài trợ (hiện khi chưa có logo)" aria-label="Tên nhà tài trợ" />
          )}
          <Slider label="Rộng" value={Math.round(l.w * 100)} min={2} max={120} unit="%" onChange={(v) => set({ w: v / 100 })} />
          <Slider label="Cao" value={Math.round(l.h * 100)} min={2} max={120} unit="%" onChange={(v) => set({ h: v / 100 })} />
        </>
      )}

      {l.type === 'qr' && (
        <>
          <Chips label="Nguồn mã QR" value={l.source} options={QR_SOURCES}
            onChange={(source) => set(source === 'fee' && feePreset ? { source, ...feePreset } : { source })} />
          <p className="text-[11px] text-fg-muted">
            {l.source === 'verify' ? 'Mỗi VĐV một mã riêng — trọng tài / bạn bè quét để kiểm tra BIB là thật.'
              : l.source === 'race' ? 'Mở trang giải để đăng ký / xem kết quả.'
              : l.source === 'club' ? 'Mở trang đơn vị tổ chức (CLB).'
              : l.source === 'fee' ? (feePreset ? 'Lấy từ QR nhận tiền / tài khoản ngân hàng đã lưu trong Quỹ CLB.' : 'Chưa lưu QR nhận tiền trong Quỹ CLB — tải ảnh QR ngân hàng lên bên dưới.')
              : l.source === 'link' ? 'Ví dụ: nhóm Zalo, fanpage, form đăng ký.'
              : 'Ảnh QR có sẵn (QR ngân hàng, QR Zalo…).'}
          </p>
          {l.source === 'link' && (
            <Input value={l.url} maxLength={400} onChange={(e) => set({ url: e.target.value })} placeholder="https://…" aria-label="Đường link của mã QR" inputMode="url" />
          )}
          {(l.source === 'image' || l.source === 'fee') && (
            <FileButton disabled={busy} onPick={(f) => onUpload(f, (src) => set({ src, url: '' }))}
              className="flex w-full items-center gap-3 rounded-xl border border-dashed border-border bg-surface-2 p-2 text-left text-sm">
              <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element -- ảnh QR đã lưu */}
                {l.src ? <img src={l.src} alt="" className="h-full w-full object-contain" /> : <ImagePlus className="size-5 text-fg-subtle" aria-hidden />}
              </span>
              {busy ? 'Đang tải…' : l.src ? 'Đổi ảnh QR' : l.url ? 'Đang dùng mã VietQR tự tạo — chạm để thay bằng ảnh' : 'Tải ảnh QR lên'}
            </FileButton>
          )}
          <Input value={l.label} maxLength={40} onChange={(e) => set({ label: e.target.value })} placeholder="Chú thích dưới mã (VD: Quét để đóng phí)" aria-label="Chú thích QR" />
          <div className="flex flex-wrap gap-1.5">
            <Pill on={l.card} onClick={() => set({ card: !l.card })}>Khung trắng (dễ quét trên nền tối)</Pill>
          </div>
          <Slider label="Cỡ mã" value={Math.round(l.w * 100)} min={5} max={60} unit="%" onChange={(v) => set({ w: v / 100 })} />
        </>
      )}

      {l.type === 'shape' && (
        <>
          <Chips label="Hình" value={l.shape} options={SHAPES} onChange={(shape) => set({ shape })} />
          <PaintPicker label="Màu" value={l.fill} palette={palette} labels={colorLabels} onChange={(fill) => set({ fill })} />
          <Slider label="Rộng" value={Math.round(l.w * 100)} min={1} max={150} unit="%" onChange={(v) => set({ w: v / 100 })} />
          {l.shape !== 'line' && <Slider label="Cao" value={Math.round(l.h * 100)} min={1} max={150} unit="%" onChange={(v) => set({ h: v / 100 })} />}
        </>
      )}

      <div className="space-y-3 border-t border-border pt-3">
        <Slider label="Xoay" value={Math.round(l.rot)} min={-180} max={180} unit="°" onChange={(rot) => set({ rot })} />
        <Slider label="Độ đậm" value={Math.round(l.opacity * 100)} min={5} max={100} unit="%" onChange={(v) => set({ opacity: v / 100 })} />
        <div className="grid grid-cols-4 gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => onAction('top')} aria-label="Lên trên cùng" title="Lên trên cùng"><ArrowUpToLine className="size-4" aria-hidden /></Button>
          <Button size="sm" variant="secondary" onClick={() => onAction('up')} aria-label="Lên một lớp" title="Lên một lớp"><ChevronUp className="size-4" aria-hidden /></Button>
          <Button size="sm" variant="secondary" onClick={() => onAction('down')} aria-label="Xuống một lớp" title="Xuống một lớp"><ChevronDown className="size-4" aria-hidden /></Button>
          <Button size="sm" variant="secondary" onClick={() => onAction('bottom')} aria-label="Xuống dưới cùng" title="Xuống dưới cùng"><ArrowDownToLine className="size-4" aria-hidden /></Button>
          <Button size="sm" variant="secondary" onClick={() => set({ hidden: !l.hidden })} title={l.hidden ? 'Hiện' : 'Ẩn'}>
            {l.hidden ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => set({ locked: !l.locked })} title={l.locked ? 'Mở khóa' : 'Khóa vị trí'}>
            {l.locked ? <Lock className="size-4" aria-hidden /> : <Unlock className="size-4" aria-hidden />}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onAction('duplicate')} title="Nhân bản"><Copy className="size-4" aria-hidden /></Button>
          <Button size="sm" variant="danger" onClick={() => onAction('delete')} title="Xóa"><Trash2 className="size-4" aria-hidden /></Button>
        </div>
      </div>
    </div>
  )
}
