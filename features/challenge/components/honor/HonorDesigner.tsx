'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LayoutGrid } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Sheet } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { DesignCanvas } from '@/shared/design/DesignCanvas'
import { COLOR_KEYS, type Layer } from '@/shared/design/engine'
import { ImagePick, Section, Slider, Toggle } from '@/shared/design/studio/bits'
import { Studio } from '@/shared/design/studio/Studio'
import { useHistory } from '@/shared/design/studio/useHistory'
import { challengeErrorMessage, saveHonor, uploadHonorImage, type HonorState } from '../../api/challengeApi'
import {
  autoHonorCard, autoHonorPoster, drawHonor, HONOR_BINDS, HONOR_COLOR_LABEL, HONOR_FORMATS, HONOR_PHOTO_BINDS, HONOR_TEMPLATES, honorData,
  honorPayload, MAX_HONOR_LAYERS, resolveHonor, type HonorContext, type HonorDesign, type HonorFormat, type HonorMode, type HonorTemplate,
} from '../../model/honor'

/** BTC thiết kế ảnh vinh danh: ảnh nhóm (theo hạng mục) hoặc ảnh cá nhân — xem trước bằng dữ liệu thật của thử thách */
export function HonorDesigner({ challengeId, honor, mode, ctx, onClose }: {
  challengeId: string; honor: HonorState; mode: HonorMode; ctx: HonorContext; onClose: () => void
}) {
  const qc = useQueryClient()
  const maxN = Math.max(1, ...honor.categories.map((c) => c.count))
  const h = useHistory<HonorDesign>(() => {
    const { palette, ...d } = resolveHonor(mode === 'poster' ? honor.design : honor.card_design, mode, maxN)
    void palette
    return d
  })
  const d = h.value
  const set = (p: Partial<HonorDesign>, record = true) => h.update((x) => ({ ...x, ...p }), record)
  const size = HONOR_FORMATS[d.format]
  const palette = { ...HONOR_TEMPLATES[d.template].colors, ...d.colors }
  const [uploading, setUploading] = useState(false)

  // Xem trước bằng hạng mục đầu tiên (dữ liệu thật nếu có, không thì dữ liệu mẫu)
  const cat = honor.categories[0] ?? { key: 'TOP', title: 'Top thành tích', count: 3 }
  const rows = honor.honorees.filter((x) => x.category === cat.key)
  const data = honorData(ctx, cat, rows, mode === 'card' ? rows[0] ?? null : null)

  const save = useMutation({
    mutationFn: () => {
      const other = mode === 'poster' ? honor.card_design : honor.design
      const mine = honorPayload(d)
      const first = !honor.categories.length
      return saveHonor(challengeId, { enabled: first ? true : honor.enabled,
        categories: first ? [{ key: 'TOP', title: 'Top thành tích', count: 3 }] : honor.categories,
        design: mode === 'poster' ? mine : other, card_design: mode === 'card' ? mine : other })
    },
    onSuccess: (r) => { qc.setQueryData(['challenge', challengeId, 'honor'], r); toast.success('Đã lưu thiết kế vinh danh'); onClose() },
    onError: (e) => toast.error(challengeErrorMessage(e)),
  })
  const keepLogo = (ls: Layer[]) => ({ logo: ls.find((l) => l.type === 'image' && l.role === 'logo') ?? null })
  const auto = (format: HonorFormat = d.format, template: HonorTemplate = d.template) => h.update((x) => ({
    ...x, format, template,
    layers: mode === 'poster' ? autoHonorPoster(format, template, maxN, keepLogo(x.layers)) : autoHonorCard(format, template, keepLogo(x.layers)),
  }))
  const setLayers = (fn: (ls: Layer[]) => Layer[], record = true) => h.update((x) => ({ ...x, layers: fn(x.layers) }), record)

  const stylePanel = (
    <div className="space-y-3">
      <Section title="Khổ ảnh" hint="Đổi khổ sẽ dựng lại bố cục (giữ logo đã tải).">
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(HONOR_FORMATS) as HonorFormat[]).map((f) => (
            <button key={f} type="button" aria-pressed={d.format === f} onClick={() => f !== d.format && auto(f)}
              className={cn('rounded-xl border p-2.5 text-left', d.format === f ? 'border-brand bg-brand/10' : 'border-border')}>
              <span className="block text-sm font-semibold">{HONOR_FORMATS[f].label}</span>
              <span className="block text-[11px] text-fg-muted">{HONOR_FORMATS[f].hint}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Nền có sẵn" hint="10 nền vẽ sẵn, đổi màu theo bảng màu. Hoặc tải ảnh nền riêng bên dưới.">
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(HONOR_TEMPLATES) as HonorTemplate[]).map((t) => (
            <button key={t} type="button" aria-pressed={d.template === t} onClick={() => set({ template: t, colors: {} })}
              className={cn('flex items-center gap-2 rounded-xl border p-2.5 text-left text-sm font-semibold', d.template === t ? 'border-brand bg-brand/10' : 'border-border')}>
              <span className="flex -space-x-1">{(['bg', 'band', 'accent'] as const).map((k) => (
                <span key={k} className="size-3.5 rounded-full border border-black/20" style={{ background: HONOR_TEMPLATES[t].colors[k] }} />))}</span>
              {HONOR_TEMPLATES[t].label}
            </button>
          ))}
        </div>
        <Button size="sm" variant="secondary" onClick={() => auto()}><LayoutGrid className="size-4" aria-hidden />Dựng lại bố cục</Button>
        <Toggle checked={d.decor} onChange={(v) => set({ decor: v })} label="Họa tiết của nền (đèn, pháo giấy, đường chạy…)" />
      </Section>
      <Section title="Bảng màu">
        <div className="grid grid-cols-5 gap-2">
          {COLOR_KEYS.map((k) => (
            <label key={k} className="flex flex-col items-center gap-1 text-center text-[11px] text-fg-muted">
              <input type="color" value={palette[k]} onChange={(e) => set({ colors: { ...d.colors, [k]: e.target.value } }, false)}
                className="h-10 w-full cursor-pointer rounded-lg border border-border bg-transparent" aria-label={`Màu ${HONOR_COLOR_LABEL[k]}`} />
              {HONOR_COLOR_LABEL[k]}
            </label>
          ))}
        </div>
      </Section>
      <Section title="Ảnh nền riêng" hint={`Ảnh lễ trao giải, ảnh đường chạy… (${size.w}×${size.h}). Đè lên nền có sẵn.`}>
        <ImagePick label="Ảnh nền" url={d.bg_url} busy={uploading}
          onPick={async (f) => {
            if (!f) return
            setUploading(true)
            try { set({ bg_url: await uploadHonorImage(challengeId, f) }) } catch (e) { toast.error(challengeErrorMessage(e)) } finally { setUploading(false) }
          }} onClear={() => set({ bg_url: null })} />
        {d.bg_url && <Slider label="Độ đậm ảnh nền" value={Math.round(d.bg_opacity * 100)} min={5} max={100} unit="%" onChange={(v) => set({ bg_opacity: v / 100 }, false)} />}
      </Section>
    </div>
  )

  return (
    <Sheet open onClose={onClose} title={mode === 'poster' ? 'Thiết kế ảnh vinh danh nhóm' : 'Thiết kế ảnh vinh danh cá nhân'}
      description={mode === 'poster' ? 'Một mẫu cho mọi hạng mục — tên, ảnh, thành tích tự điền theo từng hạng.' : 'Mỗi người được vinh danh nhận một ảnh riêng theo mẫu này.'}
      className="sm:max-w-5xl sm:max-h-[94dvh]"
      footer={<Button block onClick={() => save.mutate()} loading={save.isPending} disabled={uploading}>Lưu thiết kế</Button>}>
      <Studio size={size} binds={HONOR_BINDS} palette={palette} colorLabels={HONOR_COLOR_LABEL} photoBinds={HONOR_PHOTO_BINDS} maxLayers={MAX_HONOR_LAYERS}
        layers={d.layers} update={setLayers} snapshot={h.snapshot} history={h}
        preview={(onLayout) => (
          <DesignCanvas size={size} label="Xem trước ảnh vinh danh" onLayout={onLayout}
            drawKey={JSON.stringify([d, data])} draw={(c) => drawHonor(c, d, mode, data, { editing: true }, maxN)} />
        )}
        upload={(f) => uploadHonorImage(challengeId, f).catch((e) => { throw new Error(challengeErrorMessage(e)) })}
        qrSuggestions={[{ key: 'race', title: 'QR thử thách', hint: 'Mở trang thử thách để xem bảng xếp hạng', ready: true, layer: { source: 'race', label: 'Xem thử thách' } }]}
        onAuto={() => auto()} stylePanel={stylePanel} />
    </Sheet>
  )
}
