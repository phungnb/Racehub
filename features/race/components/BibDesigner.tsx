'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, ImagePlus, Move, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Field, Input, Sheet } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { raceErrorMessage, setBibDesign, uploadRaceImage, type Race } from '../api/raceApi'
import {
  ALIGNS, applyPreset, BIB_SIZE, bibPayload, BOX_LABEL, COLOR_LABEL, DEFAULT_FIT, editableBib, FONTS, hitBox, moveBox, panArt, PRESETS, QR_POS,
  resolveBib, TEMPLATES, type BibColors, type BibDesign, type BibFont, type BibLayout, type BibTemplate, type BoxKey, type TextBox,
} from '../model/bib'
import { BIB_FONT_FAMILIES } from './bibFonts'
import { EBib } from './EBib'
import { fmtDate } from './RaceCard'

/** Font xem trước trên nút chọn font */
function previewFamily(f: BibFont) {
  if (f === 'sans') return 'var(--font-be-vietnam)'
  if (f === 'mono') return 'var(--font-jetbrains)'
  return BIB_FONT_FAMILIES[f] ?? 'inherit'
}

/** Ban tổ chức thiết kế e-BIB: ảnh BIB có sẵn làm khung, mẫu, màu, bố cục số / tên, logo, nhà tài trợ, QR — xem trước trực tiếp */
export function BibDesigner({ r, onClose }: { r: Race; onClose: () => void }) {
  const qc = useQueryClient()
  const [d, setD] = useState<BibDesign>(() => editableBib(r.bib_design))
  const palette = resolveBib(d).palette
  const set = (p: Partial<BibDesign>) => setD((x) => ({ ...x, ...p }))
  const [active, setActive] = useState<BoxKey>('number')
  const setBox = (k: BoxKey, p: Partial<TextBox>) => setD((x) => ({ ...x, boxes: { ...x.boxes, [k]: { ...x.boxes[k], ...p } } }))
  const [layout, setLayout] = useState<BibLayout | null>(null)
  const artDim = useImageSize(d.art_url)
  const framed = d.use_art && !!d.art_url
  const [uploading, setUploading] = useState<string | null>(null)
  const upload = async (key: string, file: File | undefined, apply: (url: string) => void) => {
    if (!file) return
    setUploading(key)
    try { apply(await uploadRaceImage(r.id, file)) } catch (e) { toast.error(raceErrorMessage(e)) } finally { setUploading(null) }
  }
  const save = useMutation({
    mutationFn: () => setBibDesign(r.id, bibPayload(d)),
    onSuccess: () => { toast.success('Đã lưu thiết kế BIB — VĐV thấy ngay'); void qc.invalidateQueries({ queryKey: ['race', r.id] }); onClose() },
    onError: (e) => toast.error(raceErrorMessage(e)),
  })
  const defaultOrg = r.club?.name ?? r.organizer?.display_name ?? null
  const sample = { race: r.title, bib: `${r.bib_prefix}-0001`, name: 'Nguyễn Văn An', org: defaultOrg, distanceKm: Number(r.distances[r.distances.length - 1]),
    dates: `${fmtDate(r.start_at)} – ${fmtDate(r.end_at)}`, qrUrl: typeof window === 'undefined' ? null : `${window.location.origin}/races/${r.id}?bib=${r.bib_prefix}-0001` }

  return (
    <Sheet open onClose={onClose} title="Thiết kế BIB" description="VĐV nhận e-BIB theo thiết kế này, tải về để in hoặc chia sẻ."
      footer={<Button block onClick={() => save.mutate()} loading={save.isPending} disabled={!!uploading}>Lưu thiết kế</Button>}>
      <div className="space-y-5">
        <div className="sticky top-0 z-10 -mx-1 bg-surface px-1 pb-2">
          <CanvasEditor layout={layout} active={active}
            onGrab={(x, y) => {
              const k = hitBox(layout, x, y)
              if (k) { setActive(k); return k }
              return framed && artDim ? 'art' : null
            }}
            onDrag={(target, dx, dy) => setD((x) => target === 'art'
              ? (artDim ? { ...x, art_fit: panArt(x.art_fit, dx, dy, artDim.w, artDim.h) } : x)
              : { ...x, boxes: { ...x.boxes, [target]: moveBox(x.boxes[target], dx, dy) } })}>
            <EBib design={d} data={sample} onLayout={setLayout} />
          </CanvasEditor>
          <p className="mt-1 flex items-center justify-center gap-1 text-[11px] text-fg-muted">
            <Move className="size-3" aria-hidden />Chạm vào chữ trên BIB để chọn, kéo để di chuyển{framed ? ' · kéo chỗ trống để căn ảnh khung' : ''}
          </p>
        </div>

        <Section title="Chữ trên BIB" hint="3 khung: Đơn vị tổ chức, Số BIB, Tên VĐV. Chọn một khung để đổi font, cỡ, màu, căn lề và vị trí.">
          <Chips label="Bố cục nhanh" value={null} options={PRESETS} onChange={(p) => set({ boxes: applyPreset(d.boxes, p, d.show_qr ? d.qr_pos : null) })} />
          <div className="grid grid-cols-3 gap-1.5" role="tablist" aria-label="Khung chữ">
            {(Object.keys(BOX_LABEL) as BoxKey[]).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={active === k} onClick={() => setActive(k)}
                className={cn('flex items-center justify-center gap-1 rounded-xl border px-2 py-2 text-xs font-semibold',
                  active === k ? 'border-brand bg-brand/15 text-fg' : 'border-border text-fg-muted', !d.boxes[k].show && 'line-through opacity-60')}>
                {BOX_LABEL[k]}
              </button>
            ))}
          </div>
          <BoxEditor k={active} b={d.boxes[active]} palette={palette} onChange={(p) => setBox(active, p)}
            orgText={d.org_text} defaultOrg={defaultOrg} onOrgText={(v) => set({ org_text: v })} />
        </Section>

        <Section title="Ảnh BIB có sẵn" hint="Đã thiết kế BIB trên Canva / Photoshop? Tải lên (khổ ngang 7:5, ví dụ 1400×1000), tick dùng làm khung rồi căn cho khớp. App sẽ in số BIB, tên, QR lên trên.">
          <ImagePick label="Ảnh BIB" url={d.art_url} busy={uploading === 'art'}
            onPick={(f) => upload('art', f, (u) => set({ art_url: u, use_art: true, art_fit: DEFAULT_FIT }))} onClear={() => set({ art_url: null, use_art: false })} />
          {d.art_url && (
            <>
              <Toggle checked={d.use_art} onChange={(v) => set({ use_art: v })} label="Dùng ảnh này làm khung BIB" />
              {framed && (
                <div className="space-y-3 rounded-xl border border-border p-3">
                  <Slider label="Thu phóng" value={Math.round(d.art_fit.zoom * 100)} min={50} max={300} unit="%" onChange={(v) => set({ art_fit: { ...d.art_fit, zoom: v / 100 } })} />
                  <Slider label="Dịch ngang" value={Math.round(d.art_fit.x * 100)} min={-100} max={100} onChange={(v) => set({ art_fit: { ...d.art_fit, x: v / 100 } })} />
                  <Slider label="Dịch dọc" value={Math.round(d.art_fit.y * 100)} min={-100} max={100} onChange={(v) => set({ art_fit: { ...d.art_fit, y: v / 100 } })} />
                  <Button size="sm" variant="secondary" onClick={() => set({ art_fit: DEFAULT_FIT })}><RotateCcw className="size-4" aria-hidden />Căn lại vừa khung</Button>
                </div>
              )}
            </>
          )}
          <Toggle checked={d.show_header} onChange={(v) => set({ show_header: v })} label="Hiện đầu BIB (logo, tên giải, cự ly)" />
          <Toggle checked={d.show_sponsors} onChange={(v) => set({ show_sponsors: v })} label="Hiện dải nhà tài trợ" />
        </Section>

        <Section title="Mã QR xác thực">
          <Toggle checked={d.show_qr} onChange={(v) => set({ show_qr: v })} label="In mã QR (trọng tài quét để kiểm tra VĐV)" />
          {d.show_qr && <Chips label="Vị trí" value={d.qr_pos} options={QR_POS} onChange={(v) => set({ qr_pos: v })} />}
        </Section>

        <Field label={framed ? 'Mẫu (chỉ dùng khi không có ảnh khung)' : 'Mẫu'}>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(TEMPLATES) as BibTemplate[]).map((t) => (
              <button key={t} type="button" aria-pressed={d.template === t} onClick={() => set({ template: t, colors: {} })}
                className={cn('rounded-xl border p-2.5 text-left', d.template === t ? 'border-brand bg-brand/10' : 'border-border')}>
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  <span className="flex -space-x-1">{(['bg', 'band', 'number'] as const).map((k) => (
                    <span key={k} className="size-3.5 rounded-full border border-black/20" style={{ background: TEMPLATES[t].colors[k] }} />))}</span>
                  {TEMPLATES[t].label}
                </span>
                <span className="block text-[11px] text-fg-muted">{TEMPLATES[t].hint}</span>
              </button>
            ))}
          </div>
        </Field>

        <Field label="Màu sắc">
          <div className="grid grid-cols-5 gap-2">
            {(Object.keys(COLOR_LABEL) as (keyof BibColors)[]).map((k) => (
              <label key={k} className="flex flex-col items-center gap-1 text-[11px] text-fg-muted">
                <input type="color" value={palette[k]} onChange={(e) => set({ colors: { ...d.colors, [k]: e.target.value } })}
                  className="h-10 w-full cursor-pointer rounded-lg border border-border bg-transparent" aria-label={`Màu ${COLOR_LABEL[k]}`} />
                {COLOR_LABEL[k]}
              </label>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <ImagePick label="Logo giải" url={d.logo_url} busy={uploading === 'logo'} onPick={(f) => upload('logo', f, (u) => set({ logo_url: u }))} onClear={() => set({ logo_url: null })} />
          {!framed && <ImagePick label="Ảnh nền mờ" url={d.bg_url} busy={uploading === 'bg'} onPick={(f) => upload('bg', f, (u) => set({ bg_url: u }))} onClear={() => set({ bg_url: null })} />}
        </div>
        {d.bg_url && !framed && (
          <Field label={`Độ đậm ảnh nền: ${Math.round(d.bg_opacity * 100)}%`}>
            <input type="range" min={5} max={100} value={Math.round(d.bg_opacity * 100)} onChange={(e) => set({ bg_opacity: Number(e.target.value) / 100 })}
              className="w-full accent-[var(--color-brand)]" aria-label="Độ đậm ảnh nền" />
          </Field>
        )}

        <Field label="Khẩu hiệu (không bắt buộc)" htmlFor="bib-tag" hint={`${(d.tagline ?? '').length}/40`}>
          <Input id="bib-tag" value={d.tagline ?? ''} maxLength={40} onChange={(e) => set({ tagline: e.target.value })} placeholder="VD: No Beer No Run" />
        </Field>

        <Field label="Nhà tài trợ (tối đa 4)">
          <div className="space-y-2">
            {d.sponsors.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <SponsorLogo url={s.logo_url} busy={uploading === `sp${i}`}
                  onPick={(f) => upload(`sp${i}`, f, (u) => set({ sponsors: d.sponsors.map((x, j) => (j === i ? { ...x, logo_url: u } : x)) }))} />
                <Input value={s.name} maxLength={24} placeholder="Tên nhà tài trợ" aria-label={`Nhà tài trợ ${i + 1}`}
                  onChange={(e) => set({ sponsors: d.sponsors.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                <Button variant="ghost" className="w-10 shrink-0 px-0" aria-label="Bỏ nhà tài trợ" onClick={() => set({ sponsors: d.sponsors.filter((_, j) => j !== i) })}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            ))}
            {d.sponsors.length < 4 && (
              <Button size="sm" variant="secondary" onClick={() => set({ sponsors: [...d.sponsors, { name: '', logo_url: null }] })}><Plus className="size-4" aria-hidden />Thêm nhà tài trợ</Button>
            )}
          </div>
        </Field>

      </div>
    </Sheet>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-surface-2/40 p-3">
      <div>
        <h3 className="text-sm font-bold">{title}</h3>
        {hint && <p className="text-[11px] text-fg-muted">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-3 rounded-xl border border-border p-3 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-5 accent-[var(--color-brand)]" />
      {label}
    </label>
  )
}

function Chips<T extends string>({ label, value, options, onChange }: { label: string; value: T | null; options: Record<T, string>; onChange: (v: T) => void }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-fg-muted">{label}</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {(Object.keys(options) as T[]).map((k) => (
          <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}
            className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold', value === k ? 'border-brand bg-brand/15 text-fg' : 'border-border text-fg-muted')}>
            {options[k]}
          </button>
        ))}
      </div>
    </div>
  )
}

function Slider({ label, value, min, max, unit = '', onChange }: { label: string; value: number; min: number; max: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label className="block space-y-1">
      <span className="flex justify-between text-xs font-medium text-fg-muted"><span>{label}</span><span className="tabular-nums">{value}{unit}</span></span>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--color-brand)]" aria-label={label} />
    </label>
  )
}

/** Trình sửa trên ảnh xem trước: chạm chọn khung chữ, kéo để di chuyển (hoặc kéo ảnh khung). Đổi px màn hình → px BIB. */
function CanvasEditor({ layout, active, onGrab, onDrag, children }: {
  layout: BibLayout | null; active: BoxKey
  onGrab: (x: number, y: number) => BoxKey | 'art' | null
  onDrag: (target: BoxKey | 'art', dx: number, dy: number) => void
  children: ReactNode
}) {
  const drag = useRef<{ target: BoxKey | 'art'; x: number; y: number } | null>(null)
  const sel = layout?.boxes[active]
  const pct = (v: number, of: number) => `${(v / of) * 100}%`
  return (
    <div className="relative touch-none select-none"
      onPointerDown={(e) => {
        const box = e.currentTarget.getBoundingClientRect()
        const k = BIB_SIZE.w / box.width
        const target = onGrab((e.clientX - box.left) * k, (e.clientY - box.top) * k)
        if (!target) return
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { target, x: e.clientX, y: e.clientY }
      }}
      onPointerMove={(e) => {
        if (!drag.current) return
        const k = BIB_SIZE.w / e.currentTarget.clientWidth
        onDrag(drag.current.target, (e.clientX - drag.current.x) * k, (e.clientY - drag.current.y) * k)
        drag.current = { ...drag.current, x: e.clientX, y: e.clientY }
      }}
      onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
      {children}
      {sel && (
        <span aria-hidden className="pointer-events-none absolute rounded-md border-2 border-dashed border-brand shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
          style={{ left: pct(sel.x - 10, BIB_SIZE.w), top: pct(sel.y - 10, BIB_SIZE.h), width: pct(sel.w + 20, BIB_SIZE.w), height: pct(sel.h + 20, BIB_SIZE.h) }} />
      )}
    </div>
  )
}

function BoxEditor({ k, b, palette, onChange, orgText, defaultOrg, onOrgText }: {
  k: BoxKey; b: TextBox; palette: BibColors; onChange: (p: Partial<TextBox>) => void
  orgText: string | null; defaultOrg: string | null; onOrgText: (v: string) => void
}) {
  const sample = k === 'number' ? '0421' : k === 'name' ? 'AN' : 'Aa'
  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{BOX_LABEL[k]}</p>
        <Button size="sm" variant="ghost" onClick={() => onChange({ show: !b.show })}>
          {b.show ? <><Eye className="size-4" aria-hidden />Đang hiện</> : <><EyeOff className="size-4" aria-hidden />Đang ẩn</>}
        </Button>
      </div>
      {k === 'org' && (
        <Field label="Nội dung" htmlFor="bib-org" hint={`${(orgText ?? '').length}/60`}>
          <Input id="bib-org" value={orgText ?? ''} maxLength={60} onChange={(e) => onOrgText(e.target.value)} placeholder={defaultOrg ?? 'VD: BTC Hồ Tây Runners'} />
        </Field>
      )}
      {k === 'name' && <p className="text-[11px] text-fg-muted">Mỗi VĐV thấy tên của mình (in hoa). Xem trước dùng tên mẫu.</p>}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-fg-muted">Font chữ</p>
        <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="Font chữ">
          {(Object.keys(FONTS) as BibFont[]).map((f) => (
            <button key={f} type="button" aria-pressed={b.font === f} onClick={() => onChange({ font: f })} title={FONTS[f].label}
              className={cn('flex flex-col items-center rounded-lg border px-1 py-1.5', b.font === f ? 'border-brand bg-brand/15' : 'border-border')}>
              <span className="text-base leading-none" style={{ fontFamily: previewFamily(f), fontWeight: FONTS[f].weight, fontStyle: b.italic ? 'italic' : 'normal' }}>{sample}</span>
              <span className="mt-1 truncate text-[9px] text-fg-muted">{FONTS[f].label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Pill on={b.italic} onClick={() => onChange({ italic: !b.italic })}><i>Nghiêng</i></Pill>
        <Pill on={b.outline} onClick={() => onChange({ outline: !b.outline })}>Viền rỗng</Pill>
      </div>
      <Chips label="Căn lề" value={b.align} options={ALIGNS} onChange={(v) => onChange({ align: v })} />
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-fg-muted">Màu</p>
        <div className="flex gap-2" role="group" aria-label="Màu chữ">
          {(Object.keys(COLOR_LABEL) as (keyof BibColors)[]).map((c) => (
            <button key={c} type="button" aria-pressed={b.color === c} onClick={() => onChange({ color: c })} title={COLOR_LABEL[c]} aria-label={`Màu ${COLOR_LABEL[c]}`}
              className={cn('size-8 rounded-full border-2', b.color === c ? 'border-brand ring-2 ring-brand/40' : 'border-border')} style={{ background: palette[c] }} />
          ))}
        </div>
      </div>
      <Slider label="Cỡ chữ" value={Math.round(b.size * 100)} min={30} max={250} unit="%" onChange={(v) => onChange({ size: v / 100 })} />
      <Slider label="Ngang" value={Math.round(b.x * 100)} min={0} max={100} unit="%" onChange={(v) => onChange({ x: v / 100 })} />
      <Slider label="Dọc" value={Math.round(b.y * 100)} min={0} max={100} unit="%" onChange={(v) => onChange({ y: v / 100 })} />
    </div>
  )
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold', on ? 'border-brand bg-brand/15 text-fg' : 'border-border text-fg-muted')}>
      {children}
    </button>
  )
}

function useImageSize(url: string | null) {
  const [size, setSize] = useState<{ url: string; w: number; h: number } | null>(null)
  useEffect(() => {
    if (!url) return
    const im = new Image()
    im.onload = () => setSize({ url, w: im.naturalWidth, h: im.naturalHeight })
    im.src = url
  }, [url])
  return size && size.url === url ? size : null
}

function ImagePick({ label, url, busy, onPick, onClear }: { label: string; url: string | null; busy: boolean; onPick: (f: File | undefined) => void; onClear: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium text-fg-muted">{label}</p>
      <div className="relative">
        <button type="button" onClick={() => input.current?.click()} disabled={busy}
          className="grid h-24 w-full place-items-center overflow-hidden rounded-xl border border-dashed border-border bg-surface-2 text-xs text-fg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element -- ảnh vừa tải lên kho race-media */}
          {url ? <img src={url} alt={label} className="h-full w-full object-contain" />
            : <span className="flex flex-col items-center gap-1"><ImagePlus className="size-5" aria-hidden />{busy ? 'Đang tải…' : 'Chọn ảnh'}</span>}
        </button>
        {url && <button type="button" onClick={onClear} aria-label={`Bỏ ${label}`} className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-bg/80"><X className="size-3.5" aria-hidden /></button>}
      </div>
      <input ref={input} type="file" hidden accept="image/*" onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = '' }} />
    </div>
  )
}

function SponsorLogo({ url, busy, onPick }: { url: string | null; busy: boolean; onPick: (f: File | undefined) => void }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <button type="button" onClick={() => input.current?.click()} disabled={busy} aria-label="Logo nhà tài trợ"
        className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg border border-dashed border-border bg-surface-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- ảnh vừa tải lên kho race-media */}
        {url ? <img src={url} alt="" className="h-full w-full object-contain" /> : <ImagePlus className="size-4 text-fg-subtle" aria-hidden />}
      </button>
      <input ref={input} type="file" hidden accept="image/*" onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = '' }} />
    </>
  )
}
