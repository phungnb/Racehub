'use client'

import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ImagePlus, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Field, Input, Sheet } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { raceErrorMessage, setBibDesign, uploadRaceImage, type Race } from '../api/raceApi'
import { bibPayload, resolveBib, TEMPLATES, type BibColors, type BibDesign, type BibTemplate } from '../model/bib'
import { EBib } from './EBib'
import { fmtDate } from './RaceCard'

const COLOR_LABEL: Record<keyof BibColors, string> = { bg: 'Nền', band: 'Dải chính', number: 'Số BIB', text: 'Chữ', accent: 'Điểm nhấn' }

/** Ban tổ chức thiết kế e-BIB: mẫu, màu, logo, ảnh nền, khẩu hiệu, nhà tài trợ, QR — xem trước trực tiếp */
export function BibDesigner({ r, onClose }: { r: Race; onClose: () => void }) {
  const qc = useQueryClient()
  const init = resolveBib(r.bib_design)
  const [d, setD] = useState<BibDesign>({ template: init.template, colors: init.colors, logo_url: init.logo_url, bg_url: init.bg_url,
    bg_opacity: init.bg_opacity, tagline: init.tagline, sponsors: init.sponsors, show_name: init.show_name, show_qr: init.show_qr })
  const palette = resolveBib(d).palette
  const set = (p: Partial<BibDesign>) => setD((x) => ({ ...x, ...p }))
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
  const sample = { race: r.title, bib: `${r.bib_prefix}-0001`, name: 'Nguyễn Văn An', distanceKm: Number(r.distances[r.distances.length - 1]),
    dates: `${fmtDate(r.start_at)} – ${fmtDate(r.end_at)}`, qrUrl: typeof window === 'undefined' ? null : `${window.location.origin}/races/${r.id}?bib=${r.bib_prefix}-0001` }

  return (
    <Sheet open onClose={onClose} title="Thiết kế BIB" description="VĐV nhận e-BIB theo thiết kế này, tải về để in hoặc chia sẻ."
      footer={<Button block onClick={() => save.mutate()} loading={save.isPending} disabled={!!uploading}>Lưu thiết kế</Button>}>
      <div className="space-y-5">
        <div className="sticky top-0 z-10 -mx-1 bg-surface px-1 pb-2"><EBib design={d} data={sample} /></div>

        <Field label="Mẫu">
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
          <ImagePick label="Ảnh nền" url={d.bg_url} busy={uploading === 'bg'} onPick={(f) => upload('bg', f, (u) => set({ bg_url: u }))} onClear={() => set({ bg_url: null })} />
        </div>
        {d.bg_url && (
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

        <div className="space-y-2">
          {([['show_name', 'In tên VĐV dưới số BIB'], ['show_qr', 'Mã QR xác thực (trọng tài quét để kiểm tra VĐV)']] as const).map(([k, label]) => (
            <label key={k} className="flex items-center gap-3 rounded-xl border border-border p-3 text-sm">
              <input type="checkbox" checked={d[k]} onChange={(e) => set({ [k]: e.target.checked } as Partial<BibDesign>)} className="size-5 accent-[var(--color-brand)]" />
              {label}
            </label>
          ))}
        </div>
      </div>
    </Sheet>
  )
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
      <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = '' }} />
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
      <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = '' }} />
    </>
  )
}
