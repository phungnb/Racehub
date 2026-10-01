'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, LayoutGrid, Lock, Save, Trophy } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, EmptyState, ErrorState, Input, PageHeader, Skeleton, useImageSaver, ScrollRow } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { DesignCanvas } from '@/shared/design/DesignCanvas'
import { COLOR_KEYS, photoLayer, type Layer } from '@/shared/design/engine'
import { ImagePick, Section, Slider, Toggle } from '@/shared/design/studio/bits'
import { Studio } from '@/shared/design/studio/Studio'
import { useHistory } from '@/shared/design/studio/useHistory'
import { useVictoryAccess, VictoryUpsell } from '@/features/victory'
import { challengeErrorMessage, saveHonor, uploadHonorImage, type ChallengeDetail, type HonorState, type LeaderboardEntry } from '../../api/challengeApi'
import { useChallenge } from '../../hooks/useChallenge'
import {
  autoHonorPoster, drawHonor, HONOR_BINDS, HONOR_COLOR_LABEL, HONOR_FORMATS, HONOR_PHOTO_BINDS, HONOR_TEMPLATES, honorData, honorPayload,
  MAX_HONOR_LAYERS, resolveHonor, type HonorDesign, type HonorFormat, type HonorTemplate, type HonoreeLite,
} from '../../model/honor'
import { honorContext, honorKey, useHonor } from './HonorPanel'

const COUNTS = [1, 3, 5, 10] as const
const LIVE = 'LIVE'
const BRAND_LOGO = '/icons/rh5-mark-256.png'

/**
 * Studio "Vinh danh thử thách": thiết kế ảnh tôn vinh cả giải như Ảnh hành trình / Vinh danh thành viên.
 * Mọi cụm (QR, tiêu đề, tên + thành tích, ảnh runner, logo) kéo / phóng / xoay được; logo mặc định = logo CLB (hoặc RaceHub),
 * đổi ảnh và khung (tròn, chữ nhật…); ảnh nền đổi được. BTC lưu được thành mẫu ảnh nhóm chính thức của tab Vinh danh.
 */
export function HonorStudioScreen({ id }: { id: string }) {
  const { detail, leaderboard } = useChallenge(id)
  const honor = useHonor(id, !!detail.data)
  if (detail.isError) {
    return <div className="space-y-4"><PageHeader title="Vinh danh thử thách" fallback={routes.challenge(id)} /><ErrorState message={challengeErrorMessage(detail.error)} error={detail.error} onRetry={() => void detail.refetch()} /></div>
  }
  if (!detail.data || honor.isPending || leaderboard.isPending) {
    return <div className="space-y-3"><Skeleton className="h-10 w-2/3" /><Skeleton className="mx-auto aspect-[4/5] w-full max-w-sm" /></div>
  }
  return <Editor d={detail.data} h={honor.data ?? null} board={leaderboard.data ?? []} />
}

/** Logo mặc định: khung ảnh (đổi ảnh / hình khung được) thay cho ô logo trống của bố cục tự động */
function withLogo(layers: Layer[], logo: string, ratio: number): Layer[] {
  return layers.map((l) => (l.type === 'image' && l.role === 'logo' && !l.src
    ? photoLayer({ x: l.x, y: l.y, w: 0.13, h: 0.13 * ratio, bind: 'custom', src: logo, shape: 'circle', border: 4, border_color: 'accent', shadow: false })
    : l))
}

function Editor({ d, h, board }: { d: ChallengeDetail; h: HonorState | null; board: LeaderboardEntry[] }) {
  const id = d.challenge.id
  const qc = useQueryClient()
  const access = useVictoryAccess(id)
  const saver = useImageSaver()
  const logo = d.club?.avatar_url || BRAND_LOGO

  const published = !!h && h.enabled && h.status === 'PUBLISHED'
  const cats = h && (published || h.can_manage) ? h.categories : []
  const [src, setSrc] = useState<string>(published && cats.length ? cats[0].key : LIVE)
  const [count, setCount] = useState<(typeof COUNTS)[number]>(3)
  const [title, setTitle] = useState('')
  const cat = cats.find((c) => c.key === src)
  const n = cat ? Math.max(1, cat.count) : count

  const hist = useHistory<HonorDesign>(() => {
    const { palette, ...x } = resolveHonor(h?.design, 'poster', n)
    void palette
    const size = HONOR_FORMATS[x.format]
    return { ...x, layers: withLogo(x.layers, logo, size.w / size.h) }
  })
  const design = hist.value
  const size = HONOR_FORMATS[design.format]
  const palette = { ...HONOR_TEMPLATES[design.template].colors, ...design.colors }
  const set = (p: Partial<HonorDesign>, record = true) => hist.update((x) => ({ ...x, ...p }), record)
  const setLayers = (fn: (ls: Layer[]) => Layer[], record = true) => hist.update((x) => ({ ...x, layers: fn(x.layers) }), record)
  const auto = (format: HonorFormat = design.format, template: HonorTemplate = design.template, people = n) => hist.update((x) => {
    const s = HONOR_FORMATS[format]
    const keep = x.layers.find((l) => (l.type === 'photo' && l.bind === 'custom') || (l.type === 'image' && l.role === 'logo')) ?? null
    const fresh = withLogo(autoHonorPoster(format, template, people), logo, s.w / s.h)
    // Giữ logo người dùng đã đổi (ảnh + hình khung), chỉ đặt lại vị trí theo bố cục mới
    const slot = fresh.find((l) => l.type === 'photo' && l.bind === 'custom')
    return { ...x, format, template, layers: keep && slot ? fresh.map((l) => (l === slot ? { ...keep, x: slot.x, y: slot.y } as Layer : l)) : fresh }
  })
  const [uploading, setUploading] = useState(false)
  // Ảnh tải lên: BTC / người tham gia lưu vào kho vinh danh; không được thì dùng ảnh tạm trên máy (chỉ để xuất ảnh)
  const upload = (f: File) => uploadHonorImage(id, f).catch(() => URL.createObjectURL(f))

  const rows: HonoreeLite[] = useMemo(() => {
    if (cat && h) return h.honorees.filter((x) => x.category === cat.key)
    return board.filter((r) => r.score > 0).slice(0, count)
      .map((r) => ({ rank: r.rank, display_name: r.display_name, value: r.score, photo_url: null, avatar_url: r.avatar_url }))
  }, [cat, h, board, count])
  const ctx = honorContext(d)
  const catTitle = title.trim() || (cat ? cat.title : 'Top thành tích')
  const data = honorData(ctx, { key: cat?.key ?? 'TOP', title: catTitle }, rows)
  const name = `vinh-danh-${d.challenge.title}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)

  const exportImage = async () => {
    const c = document.createElement('canvas')
    await drawHonor(c, design, 'poster', data, {}, n)
    await saver.saveCanvas(c, `${name || 'vinh-danh'}.png`, `Vinh danh ${d.challenge.title}`)
  }

  const saveOfficial = useMutation({
    mutationFn: () => {
      if (!h) throw new Error('NOT_FOUND')
      const first = !h.categories.length
      const clean = (s: string | null) => (s && s.startsWith('blob:') ? null : s)
      const layers = design.layers.map((l) => ('src' in l ? { ...l, src: clean(l.src) } : l)) as Layer[]
      return saveHonor(id, { enabled: first ? true : h.enabled,
        categories: first ? [{ key: 'TOP', title: 'Top thành tích', count: 3 }] : h.categories,
        design: honorPayload({ ...design, bg_url: clean(design.bg_url), layers }), card_design: h.card_design })
    },
    onSuccess: (r) => { qc.setQueryData(honorKey(id), r); toast.success('Đã đặt làm mẫu ảnh nhóm của tab Vinh danh thử thách') },
    onError: (e) => toast.error(challengeErrorMessage(e)),
  })

  const stylePanel = (
    <div className="space-y-3">
      <Section title="Khổ ảnh" hint="Đổi khổ sẽ dựng lại bố cục (giữ logo đã đổi).">
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(HONOR_FORMATS) as HonorFormat[]).map((f) => (
            <button key={f} type="button" aria-pressed={design.format === f} onClick={() => f !== design.format && auto(f)}
              className={cn('rounded-xl border p-2.5 text-left', design.format === f ? 'border-brand bg-brand/10' : 'border-border')}>
              <span className="block text-sm font-semibold">{HONOR_FORMATS[f].label}</span>
              <span className="block text-[11px] text-fg-muted">{HONOR_FORMATS[f].hint}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Mẫu nền" hint="10 nền vẽ sẵn, đổi màu theo bảng màu.">
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(HONOR_TEMPLATES) as HonorTemplate[]).map((t) => (
            <button key={t} type="button" aria-pressed={design.template === t} onClick={() => set({ template: t, colors: {} })}
              className={cn('flex items-center gap-2 rounded-xl border p-2.5 text-left text-sm font-semibold', design.template === t ? 'border-brand bg-brand/10' : 'border-border')}>
              <span className="flex -space-x-1">{(['bg', 'band', 'accent'] as const).map((k) => (
                <span key={k} className="size-3.5 rounded-full border border-black/20" style={{ background: HONOR_TEMPLATES[t].colors[k] }} />))}</span>
              {HONOR_TEMPLATES[t].label}
            </button>
          ))}
        </div>
        <Button size="sm" variant="secondary" onClick={() => auto()}><LayoutGrid className="size-4" aria-hidden />Dựng lại bố cục</Button>
        <Toggle checked={design.decor} onChange={(v) => set({ decor: v })} label="Họa tiết của nền (đèn, pháo giấy, đường chạy…)" />
      </Section>
      <Section title="Bảng màu">
        <div className="grid grid-cols-5 gap-2">
          {COLOR_KEYS.map((k) => (
            <label key={k} className="flex flex-col items-center gap-1 text-center text-[11px] text-fg-muted">
              <input type="color" value={palette[k]} onChange={(e) => set({ colors: { ...design.colors, [k]: e.target.value } }, false)}
                className="h-10 w-full cursor-pointer rounded-lg border border-border bg-transparent" aria-label={`Màu ${HONOR_COLOR_LABEL[k]}`} />
              {HONOR_COLOR_LABEL[k]}
            </label>
          ))}
        </div>
      </Section>
      <Section title="Ảnh nền" hint={`Ảnh lễ trao giải, ảnh nhóm, đường chạy… (${size.w}×${size.h}). Đè lên nền có sẵn.`}>
        <ImagePick label="Ảnh nền" url={design.bg_url} busy={uploading}
          onPick={async (f) => {
            if (!f) return
            setUploading(true)
            try { set({ bg_url: await upload(f) }) } finally { setUploading(false) }
          }} onClear={() => set({ bg_url: null })} />
        {design.bg_url && <Slider label="Độ đậm ảnh nền" value={Math.round(design.bg_opacity * 100)} min={5} max={100} unit="%" onChange={(v) => set({ bg_opacity: v / 100 }, false)} />}
      </Section>
    </div>
  )

  return (
    <div className="space-y-4 pb-40 animate-fade-in">
      <PageHeader title="Vinh danh thử thách" subtitle={d.challenge.title} fallback={routes.challenge(id)} />
      {!access.unlocked && <VictoryUpsell compact />}

      <Card className="space-y-3">
        <p className="text-sm font-bold">Nguồn vinh danh</p>
        <ScrollRow className="-mx-1" innerClassName="gap-1.5 px-1 pb-1">
          {cats.map((c) => <Chip key={c.key} on={src === c.key} onClick={() => { setSrc(c.key); auto(undefined, undefined, Math.max(1, c.count)) }}>{c.title}</Chip>)}
          <Chip on={src === LIVE} onClick={() => { setSrc(LIVE); auto(undefined, undefined, count) }}>BXH hiện tại</Chip>
        </ScrollRow>
        {src === LIVE && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-fg-muted">Số người</span>
            {COUNTS.map((k) => <Chip key={k} on={count === k} onClick={() => { setCount(k); auto(undefined, undefined, k) }}>Top {k}</Chip>)}
          </div>
        )}
        {!published && cats.length === 0 && <p className="text-xs text-fg-muted">Ban tổ chức chưa công bố hạng mục — ảnh đang lấy theo bảng xếp hạng hiện tại.</p>}
        <Input value={title} maxLength={40} onChange={(e) => setTitle(e.target.value)} placeholder={`Tiêu đề (mặc định: ${cat ? cat.title : 'Top thành tích'})`} aria-label="Tiêu đề ảnh" />
      </Card>

      {rows.length === 0 ? (
        <EmptyState icon={Trophy} title="Chưa có ai để vinh danh" description="Khi có người có kết quả trong thử thách, bạn sẽ thiết kế được ảnh tôn vinh cả giải tại đây." />
      ) : (
        <>
          <p className="text-xs text-fg-muted">Chạm một cụm trên ảnh (QR, tiêu đề, tên, ảnh runner, logo) để <b>kéo, phóng to, xoay</b>; chạm logo để đổi ảnh và hình khung (tròn, chữ nhật…).</p>
          {/* Khung xem trước dính dưới thanh trên cùng khi cuộn bảng chỉnh */}
          <div className="rounded-2xl bg-surface p-2" style={{ '--studio-top': 'var(--topbar-h)' } as React.CSSProperties}>
            <Studio size={size} binds={HONOR_BINDS} palette={palette} colorLabels={HONOR_COLOR_LABEL} photoBinds={HONOR_PHOTO_BINDS} maxLayers={MAX_HONOR_LAYERS}
              layers={design.layers} update={setLayers} snapshot={hist.snapshot} history={hist}
              preview={(onLayout) => (
                <DesignCanvas size={size} label="Xem trước ảnh vinh danh" onLayout={onLayout}
                  drawKey={JSON.stringify([design, data, n])} draw={(c) => drawHonor(c, design, 'poster', data, { editing: true }, n)} />
              )}
              upload={upload}
              qrSuggestions={[{ key: 'race', title: 'QR thử thách', hint: 'Mở trang thử thách để xem bảng xếp hạng', ready: true, layer: { source: 'race', label: 'Xem thử thách' } }]}
              onAuto={() => auto()} stylePanel={stylePanel} />
          </div>
        </>
      )}

      {h?.can_manage && rows.length > 0 && (
        <Card className="space-y-2">
          <p className="text-sm text-fg-muted">Ban tổ chức: dùng thiết kế này làm mẫu ảnh nhóm chính thức ở tab Vinh danh thử thách (mọi người xem / tải được).</p>
          <Button variant="secondary" block loading={saveOfficial.isPending} disabled={uploading} onClick={() => saveOfficial.mutate()}>
            <Save className="size-4" aria-hidden />Đặt làm mẫu ảnh nhóm của giải
          </Button>
        </Card>
      )}

      <div className="fixed inset-x-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md border-t border-border bg-bg/95 px-3 py-2 backdrop-blur-md">
        {access.unlocked ? (
          <Button block disabled={!rows.length || uploading} loading={saver.busy} onClick={() => void exportImage()}>
            <Download className="size-4" aria-hidden />Lưu / chia sẻ ảnh vinh danh
          </Button>
        ) : (
          <Link href={routes.plans} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-coin text-sm font-bold text-black">
            <Lock className="size-4" aria-hidden />Nâng cấp để lưu ảnh
          </Link>
        )}
      </div>
      {saver.sheet}
    </div>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cn('shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold', on ? 'border-brand bg-brand text-brand-fg' : 'border-border text-fg-muted')}>
      {children}
    </button>
  )
}
