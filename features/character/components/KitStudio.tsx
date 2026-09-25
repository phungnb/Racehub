'use client'

import { useEffect, useRef, useState } from 'react'
import { Ban, Check, ImageUp, Palette, Pipette, Shirt, Sparkles, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, SegmentedControl, SwitchRow } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { PATTERNS, type Gender, type ItemPattern, type PatternKind, type TintSlot } from '../model/catalog'
import { drawPattern } from '../model/patterns'
import {
  applyScheme, extractPalette, KIT_SCHEMES, kitItems, pickPrimarySecondary,
  type KitDesign, type KitPart, type KitPartSlot,
} from '../model/kit'
import { loadImage, PaperDoll } from './PaperDoll'
import { PrintFields } from './PrintFields'

type Tab = 'colors' | 'parts' | 'print'
type PartSlot = 'top' | KitPartSlot
const GENDERS: { value: Gender; label: string }[] = [{ value: 'male', label: 'Nam' }, { value: 'female', label: 'Nữ' }]
const PART_LABEL: Record<PartSlot, string> = { top: 'Áo', bottom: 'Quần', socks: 'Tất', shoes: 'Giày' }
const BASICS = ['#ffffff', '#111827', '#1e3a8a', '#6b7280']

/** Hút màu từ ảnh (áo đấu thật, logo): thu nhỏ rồi k-means */
async function paletteFrom(src: string): Promise<string[]> {
  const img = await loadImage(src)
  const S = 72
  const k = Math.min(S / img.naturalWidth, S / img.naturalHeight)
  const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, w, h)
  return extractPalette(ctx.getImageData(0, 0, w, h).data, w, h, 7)
}

/** Ô xem nhanh họa tiết (màu nền + màu họa tiết) */
function PatternThumb({ slot, kind, base, color }: { slot: TintSlot; kind: PatternKind | null; base: string; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const w = 44, h = slot === 'socks' ? 56 : 52
    cv.width = w * 2
    cv.height = h * 2
    const c = cv.getContext('2d')!
    c.scale(2, 2)
    c.fillStyle = base
    c.fillRect(0, 0, w, h)
    if (!kind) return
    const off = document.createElement('canvas')
    off.width = w
    off.height = h
    const o = off.getContext('2d')!
    drawPattern(o, slot, kind, w, h, 'female')
    o.globalCompositeOperation = 'source-in'
    o.fillStyle = color
    o.fillRect(0, 0, w, h)
    c.drawImage(off, 0, 0)
  }, [slot, kind, base, color])
  return <canvas ref={ref} className="h-13 w-11 rounded-lg" aria-hidden />
}

function Swatches({ colors, value, onPick, label }: { colors: string[]; value?: string; onPick: (c: string) => void; label: string }) {
  const uniq = [...new Set(colors.map((c) => c.toLowerCase()))]
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      {uniq.map((c) => (
        <button key={c} type="button" onClick={() => onPick(c)} aria-label={`Màu ${c}`} aria-pressed={value?.toLowerCase() === c}
          className={cn('grid size-9 place-items-center rounded-full border-2 transition-transform', value?.toLowerCase() === c ? 'scale-110 border-fg' : 'border-border')}
          style={{ background: c }}>
          {value?.toLowerCase() === c && <Check className="size-4 mix-blend-difference text-white" aria-hidden />}
        </button>
      ))}
      <label className="grid size-9 cursor-pointer place-items-center rounded-full border-2 border-dashed border-border text-fg-muted" title="Chọn màu bất kỳ">
        <Pipette className="size-4" aria-hidden />
        <input type="color" className="sr-only" value={value ?? '#888888'} onChange={(e) => onPick(e.target.value)} aria-label={`${label}: màu bất kỳ`} />
      </label>
    </div>
  )
}

/**
 * Kit Studio: thiết kế cả bộ đồng phục cho nhân vật 2D (áo + quần + tất + giày).
 * 1) Màu CLB: tải ảnh áo đấu thật / logo → hút màu → phối màu một chạm.
 * 2) Từng món: màu + họa tiết theo nếp vải, bật / tắt món trong bộ.
 * 3) In áo: logo, tên CLB, dòng phụ, tên runner.
 */
export function KitStudio({ value, onChange, upload, clubLogoUrl, personalName, onUploading }: {
  value: KitDesign
  onChange: (k: KitDesign) => void
  /** Tải logo in áo lên kho, trả URL công khai */
  upload: (file: File) => Promise<string>
  /** Logo CLB hiện có (hồ sơ CLB) — hút màu + dùng làm logo in */
  clubLogoUrl?: string | null
  personalName?: string | null
  onUploading?: (busy: boolean) => void
}) {
  const [tab, setTab] = useState<Tab>('colors')
  const [gender, setGender] = useState<Gender>('male')
  const [source, setSource] = useState<string | null>(null)
  const [palette, setPalette] = useState<string[]>([])
  const [primary, setPrimary] = useState(value.top)
  const [secondary, setSecondary] = useState(value.print.pattern?.color ?? '#ffffff')
  const [target, setTarget] = useState<'primary' | 'secondary'>('primary')
  const [part, setPart] = useState<PartSlot>('top')
  const [busy, setBusy] = useState(false)
  const blobs = useRef<string[]>([])
  useEffect(() => () => { for (const u of blobs.current) URL.revokeObjectURL(u) }, [])

  const readColors = async (src: string) => {
    setBusy(true)
    try {
      const pal = await paletteFrom(src)
      if (!pal.length) { toast.error('Không tìm được màu trong ảnh này.'); return }
      setSource(src)
      setPalette(pal)
      const [p, s] = pickPrimarySecondary(pal)
      setPrimary(p)
      setSecondary(s)
      onChange(applyScheme(value, KIT_SCHEMES[0], p, s))
      toast.success('Đã lấy màu CLB', { description: 'Đã phối thử kiểu Cổ điển — chọn kiểu khác hoặc chỉnh từng món.' })
    } catch {
      toast.error('Không đọc được ảnh. Thử ảnh PNG / JPG khác.')
    } finally {
      setBusy(false)
    }
  }
  const pickFile = (f: File | undefined) => {
    if (!f) return
    const u = URL.createObjectURL(f)
    blobs.current.push(u)
    void readColors(u)
  }
  /** Dùng logo CLB làm logo in: tải bản sao vào kho đồng phục (đúng quyền kho) */
  const attachClubLogo = async () => {
    if (!clubLogoUrl) return
    onUploading?.(true)
    try {
      const blob = await (await fetch(clubLogoUrl)).blob()
      const type = blob.type === 'image/webp' || blob.type === 'image/jpeg' ? blob.type : 'image/png'
      const url = await upload(new File([blob], `logo.${type.split('/')[1]}`, { type }))
      onChange({ ...value, print: { ...value.print, logo_url: url } })
      toast.success('Đã gắn logo CLB lên ngực áo')
    } catch {
      toast.error('Không lấy được logo CLB. Hãy tải ảnh logo lên.')
    } finally {
      onUploading?.(false)
    }
  }

  const setPartValue = (slot: KitPartSlot, p: KitPart | null) => onChange({ ...value, [slot]: p })
  const colorOf = (slot: PartSlot) => (slot === 'top' ? value.top : value[slot]?.color)
  const patternOf = (slot: PartSlot): ItemPattern | null => (slot === 'top' ? value.print.pattern ?? null : value[slot]?.pattern ?? null)
  const setColor = (slot: PartSlot, c: string) => {
    if (slot === 'top') onChange({ ...value, top: c })
    else setPartValue(slot, { color: c, pattern: value[slot]?.pattern ?? null })
  }
  const setPattern = (slot: PartSlot, p: ItemPattern | null) => {
    if (slot === 'top') onChange({ ...value, print: { ...value.print, pattern: p } })
    else if (value[slot]) setPartValue(slot, { ...value[slot]!, pattern: p })
  }
  const choices = [primary, secondary, ...palette, ...BASICS]
  const patterns = PATTERNS[part as TintSlot] ?? []
  const pat = patternOf(part)
  const partOn = part === 'top' || !!value[part]

  return (
    <div className="space-y-4">
      {/* Xem thử */}
      <div className="relative h-[26rem] overflow-hidden rounded-2xl border border-border bg-[#c4c4ce]">
        <PaperDoll gender={gender} items={kitItems(value)} personalName={personalName ?? 'Runner'} className="size-full" label="Xem thử bộ đồng phục" />
        <SegmentedControl value={gender} onChange={setGender} options={GENDERS} className="absolute right-2 top-2 w-28 bg-bg/85" />
        <div className="absolute bottom-2 left-2 flex gap-1 rounded-full bg-bg/85 p-1 backdrop-blur">
          {(['top', 'bottom', 'socks', 'shoes'] as PartSlot[]).map((s) => (
            <span key={s} title={PART_LABEL[s]} className={cn('size-5 rounded-full border border-border', !colorOf(s) && 'opacity-30')}
              style={{ background: colorOf(s) ?? 'transparent' }} />
          ))}
        </div>
      </div>

      <SegmentedControl value={tab} onChange={setTab} options={[
        { value: 'colors', label: 'Màu CLB' }, { value: 'parts', label: 'Từng món' }, { value: 'print', label: 'In áo' },
      ]} />

      {tab === 'colors' && (
        <div className="space-y-4">
          <div className="space-y-3 rounded-2xl border border-border p-3">
            <p className="flex items-center gap-2 text-sm font-semibold"><Pipette className="size-4 text-brand" aria-hidden />Lấy màu từ đồng phục thật</p>
            <p className="text-xs text-fg-muted">Tải ảnh áo đấu CLB đang mặc (chụp thẳng, nền trơn càng tốt) hoặc logo — hệ thống tự hút màu chủ đạo và phối lên cả bộ.</p>
            <div className="flex flex-wrap gap-2">
              <label className={cn('inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-xl bg-brand px-3 text-sm font-semibold text-brand-fg', busy && 'opacity-60')}>
                <ImageUp className="size-4" aria-hidden />{busy ? 'Đang đọc màu…' : 'Tải ảnh áo / logo'}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={busy}
                  onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = '' }} />
              </label>
              {clubLogoUrl && (
                <Button variant="secondary" size="sm" className="h-10" onClick={() => void readColors(clubLogoUrl)} disabled={busy}>
                  <Palette className="size-4" aria-hidden />Màu từ logo CLB
                </Button>
              )}
            </div>
            {source && palette.length > 0 && (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- ảnh người dùng vừa chọn (blob:) */}
                <img src={source} alt="Ảnh lấy màu" className="size-14 shrink-0 rounded-xl border border-border object-contain" />
                <div className="flex flex-wrap gap-1.5">
                  {palette.map((c) => (
                    <button key={c} type="button" onClick={() => (target === 'primary' ? setPrimary(c) : setSecondary(c))} aria-label={`Chọn ${c}`}
                      className="size-8 rounded-lg border border-border" style={{ background: c }} />
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              {([['primary', 'Màu chính', primary, setPrimary], ['secondary', 'Màu phụ', secondary, setSecondary]] as const).map(([k, label, c, set]) => (
                <div key={k} role="button" tabIndex={0} onClick={() => setTarget(k)} onKeyDown={(e) => e.key === 'Enter' && setTarget(k)}
                  className={cn('flex items-center gap-2 rounded-xl border p-2 text-left', target === k ? 'border-brand bg-brand/10' : 'border-border')}>
                  <label className="size-9 shrink-0 cursor-pointer rounded-lg border border-border" style={{ background: c }}>
                    <input type="color" className="sr-only" value={c} onChange={(e) => set(e.target.value)} aria-label={label} />
                  </label>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold">{label}</span>
                    <span className="block font-mono text-[11px] text-fg-muted">{c}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-semibold"><Wand2 className="size-4 text-brand" aria-hidden />Phối màu một chạm</p>
            <div className="grid grid-cols-2 gap-2">
              {KIT_SCHEMES.map((s) => {
                const r = s.apply(primary, secondary)
                return (
                  <button key={s.key} type="button" onClick={() => onChange(applyScheme(value, s, primary, secondary))}
                    className="rounded-xl border border-border p-2 text-left hover:border-brand">
                    <span className="flex h-8 overflow-hidden rounded-lg">
                      <span className="flex-[3]" style={{ background: r.top }} />
                      <span className="flex-[2]" style={{ background: r.bottom?.color }} />
                      <span className="flex-1" style={{ background: r.socks?.color }} />
                      <span className="flex-1" style={{ background: r.shoes?.color }} />
                    </span>
                    <span className="mt-1 block text-xs font-semibold">{s.label}</span>
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-fg-muted">Phối xong vẫn chỉnh được từng món ở thẻ <b>Từng món</b>.</p>
          </div>
        </div>
      )}

      {tab === 'parts' && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-1.5" role="tablist" aria-label="Món trong bộ">
            {(['top', 'bottom', 'socks', 'shoes'] as PartSlot[]).map((s) => (
              <button key={s} type="button" role="tab" aria-selected={part === s} onClick={() => setPart(s)}
                className={cn('flex flex-col items-center gap-1 rounded-xl border py-2 text-xs font-semibold',
                  part === s ? 'border-brand bg-brand/10 text-fg' : 'border-border text-fg-muted')}>
                <span className={cn('size-5 rounded-full border border-border', !colorOf(s) && 'opacity-30')} style={{ background: colorOf(s) ?? 'transparent' }} />
                {PART_LABEL[s]}
              </button>
            ))}
          </div>

          {part !== 'top' && (
            <SwitchRow checked={partOn} onChange={(on) => setPartValue(part, on ? { color: part === 'socks' ? '#f8fafc' : '#111827', pattern: null } : null)}
              label={`Có ${PART_LABEL[part].toLowerCase()} trong bộ`} description="Tắt: thành viên giữ nguyên món đang mặc" />
          )}

          {partOn && (
            <>
              <div className="space-y-2">
                <p className="text-sm font-semibold">Màu {PART_LABEL[part].toLowerCase()}</p>
                <Swatches colors={choices} value={colorOf(part)} onPick={(c) => setColor(part, c)} label={`Màu ${PART_LABEL[part]}`} />
              </div>
              {patterns.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Họa tiết</p>
                  <div className="grid grid-cols-5 gap-2">
                    <button type="button" onClick={() => setPattern(part, null)} aria-pressed={!pat}
                      className={cn('flex flex-col items-center gap-1 rounded-xl border p-1.5 text-[11px] font-semibold', !pat ? 'border-brand bg-brand/10' : 'border-border text-fg-muted')}>
                      <span className="grid h-13 w-11 place-items-center rounded-lg" style={{ background: colorOf(part) }}><Ban className="size-4 mix-blend-difference text-white" aria-hidden /></span>
                      Trơn
                    </button>
                    {patterns.map((p) => (
                      <button key={p.kind} type="button" aria-pressed={pat?.kind === p.kind}
                        onClick={() => setPattern(part, { kind: p.kind, color: pat?.color ?? (secondary.toLowerCase() !== colorOf(part)?.toLowerCase() ? secondary : primary) })}
                        className={cn('flex flex-col items-center gap-1 rounded-xl border p-1.5 text-[11px] font-semibold', pat?.kind === p.kind ? 'border-brand bg-brand/10' : 'border-border text-fg-muted')}>
                        <PatternThumb slot={part as TintSlot} kind={p.kind} base={colorOf(part) ?? '#888888'} color={pat?.color ?? secondary} />
                        <span className="truncate">{p.label}</span>
                      </button>
                    ))}
                  </div>
                  {pat && (
                    <div className="space-y-2 pt-1">
                      <p className="text-xs font-semibold text-fg-muted">Màu họa tiết</p>
                      <Swatches colors={choices} value={pat.color} onPick={(c) => setPattern(part, { ...pat, color: c })} label="Màu họa tiết" />
                    </div>
                  )}
                </div>
              )}
              {part === 'shoes' && <p className="text-xs text-fg-muted">Giày chỉ đổi màu thân giày (đế và logo giữ nguyên).</p>}
            </>
          )}
        </div>
      )}

      {tab === 'print' && (
        <div className="space-y-3">
          {clubLogoUrl && (
            <Button variant="secondary" block onClick={() => void attachClubLogo()}><Sparkles className="size-4" aria-hidden />Dùng logo CLB làm logo ngực</Button>
          )}
          <PrintFields value={value.print} onChange={(p) => onChange({ ...value, print: { ...p, pattern: value.print.pattern ?? null } })} upload={upload} onUploading={onUploading} />
          <p className="flex items-start gap-1.5 text-xs text-fg-muted"><Shirt className="mt-0.5 size-3.5 shrink-0" aria-hidden />Chữ và logo in trên áo; họa tiết chỉnh ở thẻ Từng món.</p>
        </div>
      )}
    </div>
  )
}
