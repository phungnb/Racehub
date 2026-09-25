'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ImagePlus, LayoutGrid, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Input, Sheet } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { raceErrorMessage, setBibDesign, uploadRaceImage, type Race } from '../api/raceApi'
import {
  arrangeSponsors, autoBib, BIB_BINDS, BIB_SIZE, bibPayload, COLOR_LABEL, editableBib, keepAssets, TEMPLATES,
  type BibData, type BibDesign, type BibTemplate,
} from '../model/bib'
import { COLOR_KEYS, DEFAULT_FIT, imageLayer, panArt, type ImageLayer, type Layer } from '../model/design'
import { EBib } from './EBib'
import { fmtDate } from './RaceCard'
import { FileButton, ImagePick, Section, Slider, Toggle, useImageSize, imageAspect } from './studio/bits'
import { Studio } from './studio/Studio'
import { useHistory } from './studio/useHistory'
import { raceLinks, useRaceAssets } from './studio/useRaceAssets'

/** Ban tổ chức thiết kế e-BIB: mọi phần tử kéo thả được, bố cục tự động theo mẫu, ảnh BIB có sẵn, QR tùy chọn, logo tài trợ */
export function BibDesigner({ r, onClose }: { r: Race; onClose: () => void }) {
  const qc = useQueryClient()
  const h = useHistory<BibDesign>(() => editableBib(r.bib_design))
  const d = h.value
  const set = (p: Partial<BibDesign>, record = true) => h.update((x) => ({ ...x, ...p }), record)
  const palette = { ...TEMPLATES[d.template].colors, ...d.colors }
  const artDim = useImageSize(d.art_url)
  const framed = d.use_art && !!d.art_url
  const assets = useRaceAssets(r)
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
  const bib = `${r.bib_prefix}-0421`
  const sample: BibData = {
    race: r.title, bib, name: 'Nguyễn Văn An', org: r.club?.name ?? r.organizer?.display_name ?? null,
    distanceKm: Number(r.distances[r.distances.length - 1]), dates: `${fmtDate(r.start_at)} – ${fmtDate(r.end_at)}`, qr: raceLinks(r, bib),
  }
  const sponsors = d.layers.filter((l): l is ImageLayer => l.type === 'image' && l.role === 'sponsor')
  const setLayers = (fn: (ls: Layer[]) => Layer[], record = true) => h.update((x) => ({ ...x, layers: fn(x.layers) }), record)
  const auto = (template: BibTemplate = d.template) => h.update((x) => {
    const keep = keepAssets(x.layers)
    const strip = x.strip || keep.sponsors.length > 0
    const tagline = x.layers.find((l) => l.type === 'text' && l.bind === 'custom' && l.text.trim())
    return { ...x, template, strip, layers: autoBib(template, keep, { strip, tagline: tagline?.type === 'text' ? tagline.text : null }) }
  })

  const stylePanel = (
    <div className="space-y-3">
      <Section title="Mẫu BIB" hint="Chọn mẫu đổi nền + bảng màu. Bấm “Dựng lại bố cục” để xếp chữ, QR, logo theo chuẩn của mẫu.">
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(TEMPLATES) as BibTemplate[]).map((t) => (
            <button key={t} type="button" aria-pressed={d.template === t} onClick={() => set({ template: t, colors: {} })}
              className={cn('rounded-xl border p-2.5 text-left', d.template === t ? 'border-brand bg-brand/10' : 'border-border')}>
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <span className="flex -space-x-1">{(['bg', 'band', 'number', 'accent'] as const).map((k) => (
                  <span key={k} className="size-3.5 rounded-full border border-black/20" style={{ background: TEMPLATES[t].colors[k] }} />))}</span>
                {TEMPLATES[t].label}
              </span>
              <span className="block text-[11px] text-fg-muted">{TEMPLATES[t].hint}</span>
            </button>
          ))}
        </div>
        <Button size="sm" variant="secondary" onClick={() => auto()}><LayoutGrid className="size-4" aria-hidden />Dựng lại bố cục theo mẫu {TEMPLATES[d.template].label}</Button>
      </Section>
      <Section title="Bảng màu" hint="Mọi chữ / hình dùng màu trong bảng sẽ đổi theo.">
        <div className="grid grid-cols-5 gap-2">
          {COLOR_KEYS.map((k) => (
            <label key={k} className="flex flex-col items-center gap-1 text-[11px] text-fg-muted">
              <input type="color" value={palette[k]} onChange={(e) => set({ colors: { ...d.colors, [k]: e.target.value } }, false)}
                className="h-10 w-full cursor-pointer rounded-lg border border-border bg-transparent" aria-label={`Màu ${COLOR_LABEL[k]}`} />
              {COLOR_LABEL[k]}
            </label>
          ))}
        </div>
        <div className="grid gap-2">
          <Toggle checked={d.decor} onChange={(v) => set({ decor: v })} label="Dải màu trang trí của mẫu" />
          <Toggle checked={d.strip} onChange={(v) => set({ strip: v })} label="Dải nền nhà tài trợ phía dưới" />
          <Toggle checked={d.pins} onChange={(v) => set({ pins: v })} label="Lỗ ghim 4 góc (như BIB giấy)" />
        </div>
      </Section>
      <Section title="Ảnh BIB có sẵn" hint="Đã thiết kế trên Canva / Photoshop? Tải lên (khổ ngang 7:5, ví dụ 1400×1000) làm nền, app in số BIB, tên, QR lên trên.">
        <ImagePick label="Ảnh BIB" url={d.art_url} busy={uploading === 'art'}
          onPick={(f) => upload('art', f, (u) => set({ art_url: u, use_art: true, art_fit: DEFAULT_FIT }))} onClear={() => set({ art_url: null, use_art: false })} />
        {d.art_url && <Toggle checked={d.use_art} onChange={(v) => set({ use_art: v })} label="Dùng ảnh này làm nền BIB" />}
        {framed && (
          <div className="space-y-3 rounded-xl border border-border p-3">
            <Slider label="Thu phóng" value={Math.round(d.art_fit.zoom * 100)} min={50} max={300} unit="%" onChange={(v) => set({ art_fit: { ...d.art_fit, zoom: v / 100 } }, false)} />
            <Button size="sm" variant="secondary" onClick={() => set({ art_fit: DEFAULT_FIT })}><RotateCcw className="size-4" aria-hidden />Căn lại vừa khung</Button>
            <p className="text-[11px] text-fg-muted">Kéo chỗ trống trên bản xem trước để dịch ảnh.</p>
          </div>
        )}
      </Section>
      {!framed && (
        <Section title="Ảnh nền mờ" hint="Ảnh phong cảnh / tuyến chạy phủ mờ phía sau.">
          <ImagePick label="Ảnh nền" url={d.bg_url} busy={uploading === 'bg'} onPick={(f) => upload('bg', f, (u) => set({ bg_url: u }))} onClear={() => set({ bg_url: null })} />
          {d.bg_url && <Slider label="Độ đậm ảnh nền" value={Math.round(d.bg_opacity * 100)} min={5} max={100} unit="%" onChange={(v) => set({ bg_opacity: v / 100 }, false)} />}
        </Section>
      )}
    </div>
  )

  const sponsorPanel = (
    <Section title={`Nhà tài trợ (${sponsors.length})`} hint="Mỗi logo là một phần tử — kéo tới đâu cũng được. “Xếp đều” đưa tất cả vào dải dưới."
      action={sponsors.length > 1 ? <Button size="sm" variant="secondary" onClick={() => h.update((x) => ({ ...x, strip: true, layers: arrangeSponsors(x.layers, x.template === 'split' ? 0.34 : 0.06) }))}>Xếp đều</Button> : undefined}>
      <div className="space-y-2">
        {sponsors.map((s) => (
          <div key={s.id} className="flex items-center gap-2">
            <FileButton disabled={uploading === s.id} label="Logo nhà tài trợ"
              onPick={(f) => upload(s.id, f, (u) => void imageAspect(u).then((a) => setLayers((ls) => ls.map((l) => (l.id === s.id && l.type === 'image' ? { ...l, src: u, w: Math.min(0.24, (l.h * BIB_SIZE.h * a) / BIB_SIZE.w) } : l)))))}
              className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg border border-dashed border-border bg-surface-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- ảnh vừa tải lên kho race-media */}
              {s.src ? <img src={s.src} alt="" className="h-full w-full object-contain" /> : <ImagePlus className="size-4 text-fg-subtle" aria-hidden />}
            </FileButton>
            <Input value={s.name} maxLength={40} placeholder="Tên nhà tài trợ" aria-label="Tên nhà tài trợ"
              onChange={(e) => setLayers((ls) => ls.map((l) => (l.id === s.id ? { ...l, name: e.target.value } : l)))} />
            <Button variant="ghost" className="w-10 shrink-0 px-0" aria-label="Bỏ nhà tài trợ" onClick={() => setLayers((ls) => ls.filter((l) => l.id !== s.id))}>
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>
        ))}
        {sponsors.length < 10 && (
          <Button size="sm" variant="secondary" onClick={() => h.update((x) => ({ ...x, strip: true,
            layers: arrangeSponsors([...x.layers, imageLayer({ x: 0.5, y: 0.925, role: 'sponsor', w: 0.16, h: 0.09 })], x.template === 'split' ? 0.34 : 0.06) }))}>
            <Plus className="size-4" aria-hidden />Thêm nhà tài trợ
          </Button>
        )}
      </div>
    </Section>
  )

  return (
    <Sheet open onClose={onClose} title="Thiết kế BIB" description="Kéo thả mọi phần tử · VĐV nhận e-BIB theo thiết kế này, tải về để in hoặc chia sẻ."
      className="sm:max-w-5xl sm:max-h-[94dvh]"
      footer={<Button block onClick={() => save.mutate()} loading={save.isPending} disabled={!!uploading}>Lưu thiết kế</Button>}>
      <Studio size={BIB_SIZE} binds={BIB_BINDS} palette={palette} colorLabels={COLOR_LABEL}
        layers={d.layers} update={setLayers} snapshot={h.snapshot} history={h}
        preview={(onLayout) => <EBib design={d} data={sample} editing onLayout={onLayout} />}
        onPanArt={framed && artDim ? (dx, dy) => h.update((x) => ({ ...x, art_fit: panArt(x.art_fit, dx, dy, artDim.w, artDim.h, BIB_SIZE) }), false) : null}
        upload={(f) => uploadRaceImage(r.id, f).catch((e) => { throw new Error(raceErrorMessage(e)) })} qrSuggestions={assets.suggestions} feePreset={assets.fee}
        onAuto={() => auto()} stylePanel={stylePanel} extraPanel={sponsorPanel} />
    </Sheet>
  )
}
