'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LayoutGrid, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Sheet } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { raceErrorMessage, setCertDesign, uploadRaceImage, type Race } from '../api/raceApi'
import {
  autoCert, CERT_BINDS, CERT_COLOR_LABEL, CERT_FORMATS, CERT_TEMPLATES, certPayload, drawCertificate, editableCert, keepCertAssets,
  type CertDesign, type CertFormat, type CertificateData, type CertTemplate,
} from '../model/certificate'
import { COLOR_KEYS, DEFAULT_FIT, panArt, type Layer } from '@/shared/design/engine'
import { DesignCanvas } from '@/shared/design/DesignCanvas'
import { ImagePick, Section, Slider, Toggle, useImageSize } from '@/shared/design/studio/bits'
import { Studio } from '@/shared/design/studio/Studio'
import { useHistory } from '@/shared/design/studio/useHistory'
import { raceLinks, useRaceAssets } from './useRaceAssets'

/** BTC thiết kế giấy chứng nhận hoàn thành: khổ dọc (chia sẻ) / ngang A4 (in), mẫu, chữ ký, logo, QR xác thực — kéo thả như BIB */
export function CertDesigner({ r, onClose }: { r: Race; onClose: () => void }) {
  const qc = useQueryClient()
  const h = useHistory<CertDesign>(() => editableCert(r.cert_design))
  const d = h.value
  const set = (p: Partial<CertDesign>, record = true) => h.update((x) => ({ ...x, ...p }), record)
  const size = CERT_FORMATS[d.format]
  const palette = { ...CERT_TEMPLATES[d.template].colors, ...d.colors }
  const artDim = useImageSize(d.art_url)
  const framed = d.use_art && !!d.art_url
  const assets = useRaceAssets(r)
  const [uploading, setUploading] = useState<string | null>(null)
  const upload = async (key: string, file: File | undefined, apply: (url: string) => void) => {
    if (!file) return
    setUploading(key)
    try { apply(await uploadRaceImage(r.id, file)) } catch (e) { toast.error(raceErrorMessage(e)) } finally { setUploading(null) }
  }
  const done = (msg: string) => { toast.success(msg); void qc.invalidateQueries({ queryKey: ['race', r.id] }); onClose() }
  const save = useMutation({
    mutationFn: () => setCertDesign(r.id, certPayload(d)),
    onSuccess: () => done('Đã lưu mẫu chứng nhận — VĐV hoàn thành nhận theo mẫu này'),
    onError: (e) => toast.error(raceErrorMessage(e)),
  })
  const reset = useMutation({
    mutationFn: () => setCertDesign(r.id, null),
    onSuccess: () => done('Đã về mẫu chứng nhận mặc định'),
    onError: (e) => toast.error(raceErrorMessage(e)),
  })
  const bib = `${r.bib_prefix}-0421`
  const links = raceLinks(r, bib)
  const km = Number(r.distances[r.distances.length - 1])
  const sample: CertificateData = {
    race: r.title, organizer: r.club?.name ?? r.organizer?.display_name ?? 'RaceHub', name: 'Nguyễn Văn An', bib, distanceKm: km,
    timeS: Math.round(km * 330), rank: 12, finishers: 340,
    date: new Date(r.end_at).toLocaleDateString('vi-VN', { day: '2-digit', month: 'long', year: 'numeric' }),
    verifyUrl: links.verify, raceUrl: links.race, clubUrl: links.club,
  }
  const setLayers = (fn: (ls: Layer[]) => Layer[], record = true) => h.update((x) => ({ ...x, layers: fn(x.layers) }), record)
  const auto = (format: CertFormat = d.format, template: CertTemplate = d.template) =>
    h.update((x) => ({ ...x, format, template, layers: autoCert(format, template, keepCertAssets(x.layers)) }))

  const stylePanel = (
    <div className="space-y-3">
      <Section title="Khổ giấy" hint="Đổi khổ sẽ dựng lại bố cục (giữ logo, chữ ký, QR đã thêm).">
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(CERT_FORMATS) as CertFormat[]).map((f) => (
            <button key={f} type="button" aria-pressed={d.format === f} onClick={() => f !== d.format && auto(f)}
              className={cn('rounded-xl border p-2.5 text-left', d.format === f ? 'border-brand bg-brand/10' : 'border-border')}>
              <span className="block text-sm font-semibold">{CERT_FORMATS[f].label}</span>
              <span className="block text-[11px] text-fg-muted">{CERT_FORMATS[f].hint}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Mẫu chứng nhận">
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(CERT_TEMPLATES) as CertTemplate[]).map((t) => (
            <button key={t} type="button" aria-pressed={d.template === t} onClick={() => set({ template: t, colors: {} })}
              className={cn('rounded-xl border p-2.5 text-left', d.template === t ? 'border-brand bg-brand/10' : 'border-border')}>
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <span className="flex -space-x-1">{(['bg', 'band', 'number', 'accent'] as const).map((k) => (
                  <span key={k} className="size-3.5 rounded-full border border-black/20" style={{ background: CERT_TEMPLATES[t].colors[k] }} />))}</span>
                {CERT_TEMPLATES[t].label}
              </span>
              <span className="block text-[11px] text-fg-muted">{CERT_TEMPLATES[t].hint}</span>
            </button>
          ))}
        </div>
        <Button size="sm" variant="secondary" onClick={() => auto()}><LayoutGrid className="size-4" aria-hidden />Dựng lại bố cục theo mẫu {CERT_TEMPLATES[d.template].label}</Button>
      </Section>
      <Section title="Bảng màu">
        <div className="grid grid-cols-5 gap-2">
          {COLOR_KEYS.map((k) => (
            <label key={k} className="flex flex-col items-center gap-1 text-center text-[11px] text-fg-muted">
              <input type="color" value={palette[k]} onChange={(e) => set({ colors: { ...d.colors, [k]: e.target.value } }, false)}
                className="h-10 w-full cursor-pointer rounded-lg border border-border bg-transparent" aria-label={`Màu ${CERT_COLOR_LABEL[k]}`} />
              {CERT_COLOR_LABEL[k]}
            </label>
          ))}
        </div>
        <Toggle checked={d.decor} onChange={(v) => set({ decor: v })} label="Khung viền / họa tiết của mẫu" />
      </Section>
      <Section title="Ảnh nền có sẵn" hint={`Đã có mẫu chứng nhận thiết kế sẵn? Tải lên (${size.w}×${size.h}), app in tên, thành tích, QR lên trên.`}>
        <ImagePick label="Ảnh chứng nhận" url={d.art_url} busy={uploading === 'art'}
          onPick={(f) => upload('art', f, (u) => set({ art_url: u, use_art: true, art_fit: DEFAULT_FIT }))} onClear={() => set({ art_url: null, use_art: false })} />
        {d.art_url && <Toggle checked={d.use_art} onChange={(v) => set({ use_art: v })} label="Dùng ảnh này làm nền" />}
        {framed && <Slider label="Thu phóng" value={Math.round(d.art_fit.zoom * 100)} min={50} max={300} unit="%" onChange={(v) => set({ art_fit: { ...d.art_fit, zoom: v / 100 } }, false)} />}
        {!framed && (
          <>
            <ImagePick label="Ảnh nền mờ" url={d.bg_url} busy={uploading === 'bg'} onPick={(f) => upload('bg', f, (u) => set({ bg_url: u }))} onClear={() => set({ bg_url: null })} />
            {d.bg_url && <Slider label="Độ đậm ảnh nền" value={Math.round(d.bg_opacity * 100)} min={5} max={100} unit="%" onChange={(v) => set({ bg_opacity: v / 100 }, false)} />}
          </>
        )}
      </Section>
      {r.cert_design && (
        <Button variant="ghost" block onClick={() => reset.mutate()} loading={reset.isPending}><RotateCcw className="size-4" aria-hidden />Về mẫu mặc định của RaceHub</Button>
      )}
    </div>
  )

  return (
    <Sheet open onClose={onClose} title="Thiết kế giấy chứng nhận" description="Kéo thả mọi phần tử · VĐV hoàn thành tải chứng nhận theo mẫu này (tên, thành tích tự điền)."
      className="sm:max-w-5xl sm:max-h-[94dvh]"
      footer={<Button block onClick={() => save.mutate()} loading={save.isPending} disabled={!!uploading}>Lưu mẫu chứng nhận</Button>}>
      <Studio size={size} binds={CERT_BINDS} palette={palette} colorLabels={CERT_COLOR_LABEL}
        layers={d.layers} update={setLayers} snapshot={h.snapshot} history={h}
        preview={(onLayout) => (
          <DesignCanvas size={size} label="Xem trước giấy chứng nhận" onLayout={onLayout}
            drawKey={JSON.stringify([d, sample])} draw={(c) => drawCertificate(c, d, sample, { editing: true })} />
        )}
        onPanArt={framed && artDim ? (dx, dy) => h.update((x) => ({ ...x, art_fit: panArt(x.art_fit, dx, dy, artDim.w, artDim.h, size) }), false) : null}
        upload={(f) => uploadRaceImage(r.id, f).catch((e) => { throw new Error(raceErrorMessage(e)) })}
        qrSuggestions={assets.suggestions} feePreset={assets.fee} onAuto={() => auto()} stylePanel={stylePanel} />
    </Sheet>
  )
}
