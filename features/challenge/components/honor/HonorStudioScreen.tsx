'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, ImagePlus, Lock, Save, Trophy, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, EmptyState, ErrorState, Input, PageHeader, Skeleton, SwitchRow, useImageSaver } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { DesignCanvas } from '@/shared/design/DesignCanvas'
import { FileButton } from '@/shared/design/studio/bits'
import { useVictoryAccess, VictoryUpsell } from '@/features/victory'
import { challengeErrorMessage, saveHonor } from '../../api/challengeApi'
import { useChallenge } from '../../hooks/useChallenge'
import {
  autoHonorPoster, drawHonor, HONOR_FORMATS, HONOR_TEMPLATES, honorData, honorPayload,
  type HonorDesign, type HonorFormat, type HonorTemplate, type HonoreeLite,
} from '../../model/honor'
import { honorContext, honorKey, useHonor } from './HonorPanel'

const COUNTS = [1, 3, 5, 10] as const
const SWATCHES = ['#fbbf24', '#d4a017', '#b6ff3b', '#22c55e', '#38bdf8', '#1d4ed8', '#a855f7', '#ec4899', '#ef4444', '#f97316', '#ffffff', '#0f172a']
const LIVE = 'LIVE'

/**
 * Studio "Vinh danh thử thách": thiết kế ảnh tôn vinh cả giải (nhiều người) như Ảnh hành trình / Vinh danh thành viên:
 * chọn nguồn (hạng mục BTC đã công bố hoặc BXH hiện tại) → số người → khổ ảnh → mẫu → màu → ảnh nền → lưu / chia sẻ.
 * BTC lưu được thiết kế thành mẫu ảnh nhóm chính thức của tab Vinh danh.
 */
export function HonorStudioScreen({ id }: { id: string }) {
  const { detail, leaderboard } = useChallenge(id)
  const honor = useHonor(id, !!detail.data)
  const access = useVictoryAccess(id)
  const qc = useQueryClient()
  const saver = useImageSaver()
  const ref = useRef<HTMLCanvasElement | null>(null)

  const h = honor.data
  const published = !!h && h.enabled && h.status === 'PUBLISHED'
  const cats = useMemo(() => (h && (published || h.can_manage) ? h.categories : []), [h, published])
  const [src, setSrc] = useState<string | null>(null)
  const [count, setCount] = useState<(typeof COUNTS)[number]>(3)
  const [format, setFormat] = useState<HonorFormat>('portrait')
  const [template, setTemplate] = useState<HonorTemplate>('podium')
  const [band, setBand] = useState<string | null>(null)
  const [accent, setAccent] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [decor, setDecor] = useState(true)
  const [bg, setBg] = useState<string | null>(null)
  useEffect(() => () => { if (bg) URL.revokeObjectURL(bg) }, [bg])

  const source = src ?? (published && cats.length ? cats[0].key : LIVE)
  const cat = cats.find((c) => c.key === source)
  const n = cat ? Math.max(1, cat.count) : count
  const rows: HonoreeLite[] = useMemo(() => {
    if (cat && h) return h.honorees.filter((x) => x.category === cat.key)
    return (leaderboard.data ?? []).filter((r) => r.score > 0).slice(0, count)
      .map((r) => ({ rank: r.rank, display_name: r.display_name, value: r.score, photo_url: null, avatar_url: r.avatar_url }))
  }, [cat, h, leaderboard.data, count])

  const design: HonorDesign = useMemo(() => ({
    v: 2, format, template, decor, bg_url: bg, bg_opacity: 0.45,
    colors: { ...(band ? { band } : {}), ...(accent ? { accent } : {}) },
    layers: autoHonorPoster(format, template, n),
  }), [format, template, decor, bg, band, accent, n])

  const saveOfficial = useMutation({
    mutationFn: () => {
      if (!h) throw new Error('NOT_FOUND')
      const first = !h.categories.length
      return saveHonor(id, { enabled: first ? true : h.enabled,
        categories: first ? [{ key: 'TOP', title: 'Top thành tích', count: 3 }] : h.categories,
        design: honorPayload({ ...design, bg_url: null }), card_design: h.card_design })
    },
    onSuccess: (r) => { qc.setQueryData(honorKey(id), r); toast.success('Đã đặt làm mẫu ảnh nhóm của tab Vinh danh') },
    onError: (e) => toast.error(challengeErrorMessage(e)),
  })

  if (detail.isError) return <div className="space-y-4"><PageHeader title="Vinh danh thử thách" fallback={routes.challenge(id)} /><ErrorState message={challengeErrorMessage(detail.error)} error={detail.error} onRetry={() => void detail.refetch()} /></div>
  if (!detail.data || honor.isPending) return <div className="space-y-3"><Skeleton className="h-10 w-2/3" /><Skeleton className="mx-auto aspect-[4/5] w-full max-w-sm" /></div>

  const d = detail.data
  const ctx = honorContext(d)
  const catTitle = title.trim() || (cat ? cat.title : 'Top thành tích')
  const data = honorData(ctx, { key: cat?.key ?? 'TOP', title: catTitle }, rows)
  const size = HONOR_FORMATS[format]
  const name = `vinh-danh-${d.challenge.title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)

  return (
    <div className="space-y-4 pb-40 animate-fade-in">
      <PageHeader title="Vinh danh thử thách" subtitle={d.challenge.title} fallback={routes.challenge(id)} />
      {!access.unlocked && <VictoryUpsell compact />}

      {rows.length === 0 ? (
        <EmptyState icon={Trophy} title="Chưa có ai để vinh danh" description="Khi có người có kết quả trong thử thách, bạn sẽ thiết kế được ảnh tôn vinh cả giải tại đây." />
      ) : (
        <div className={cn('mx-auto', size.h > size.w * 1.4 ? 'max-w-xs' : size.h >= size.w ? 'max-w-sm' : '')}>
          <DesignCanvas ref={ref} size={size} label={`Ảnh vinh danh ${catTitle}`} drawKey={JSON.stringify([design, data, n])}
            draw={(c) => drawHonor(c, design, 'poster', data, {}, n)} />
        </div>
      )}

      <Card className="space-y-3">
        <p className="text-sm font-bold">Nguồn vinh danh</p>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {cats.map((c) => <Chip key={c.key} on={source === c.key} onClick={() => setSrc(c.key)}>{c.title}</Chip>)}
          <Chip on={source === LIVE} onClick={() => setSrc(LIVE)}>BXH hiện tại</Chip>
        </div>
        {source === LIVE && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-fg-muted">Số người</span>
            {COUNTS.map((k) => <Chip key={k} on={count === k} onClick={() => setCount(k)}>Top {k}</Chip>)}
          </div>
        )}
        {!published && cats.length === 0 && (
          <p className="text-xs text-fg-muted">Ban tổ chức chưa công bố hạng mục vinh danh — ảnh đang lấy theo bảng xếp hạng hiện tại.</p>
        )}
        <Input value={title} maxLength={40} onChange={(e) => setTitle(e.target.value)} placeholder={`Tiêu đề (mặc định: ${cat ? cat.title : 'Top thành tích'})`} aria-label="Tiêu đề ảnh" />
      </Card>

      <Card className="space-y-3">
        <p className="text-sm font-bold">Khổ ảnh</p>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(HONOR_FORMATS) as HonorFormat[]).map((k) => (
            <button key={k} type="button" aria-pressed={format === k} onClick={() => setFormat(k)}
              className={cn('rounded-xl border p-2.5 text-left', format === k ? 'border-brand bg-brand/10' : 'border-border')}>
              <span className="block text-sm font-semibold">{HONOR_FORMATS[k].label}</span>
              <span className="block text-xs text-fg-muted">{HONOR_FORMATS[k].hint}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card className="space-y-3">
        <p className="text-sm font-bold">Mẫu thiết kế</p>
        <div className="grid grid-cols-5 gap-2">
          {(Object.keys(HONOR_TEMPLATES) as HonorTemplate[]).map((k) => {
            const c = HONOR_TEMPLATES[k].colors
            return (
              <button key={k} type="button" aria-pressed={template === k} onClick={() => { setTemplate(k); setBand(null); setAccent(null) }}
                className={cn('flex flex-col items-center gap-1 rounded-xl border p-1.5', template === k ? 'border-brand ring-2 ring-brand/40' : 'border-border')}>
                <span className="relative block aspect-square w-full overflow-hidden rounded-lg" style={{ background: c.bg }}>
                  <span className="absolute inset-x-2 top-1/3 h-1.5 rounded-full" style={{ background: c.band }} />
                  <span className="absolute left-1/2 top-1/2 size-3 -translate-x-1/2 rounded-full" style={{ background: c.accent }} />
                </span>
                <span className="text-[10px] font-medium leading-tight">{HONOR_TEMPLATES[k].label}</span>
              </button>
            )
          })}
        </div>
        <Swatches label="Màu chính" value={band ?? HONOR_TEMPLATES[template].colors.band} onChange={setBand} />
        <Swatches label="Điểm nhấn" value={accent ?? HONOR_TEMPLATES[template].colors.accent} onChange={setAccent} />
      </Card>

      <Card className="space-y-2">
        <p className="text-sm font-bold">Ảnh nền</p>
        <div className="flex items-center gap-2">
          <FileButton label="Chọn ảnh nền" onPick={(f) => { if (f) setBg(URL.createObjectURL(f)) }}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm font-semibold hover:bg-surface-2">
            <ImagePlus className="size-4" aria-hidden />{bg ? 'Đổi ảnh nền' : 'Ảnh nền từ máy (ảnh nhóm, sân khấu…)'}
          </FileButton>
          {bg && <Button size="sm" variant="ghost" onClick={() => setBg(null)} aria-label="Bỏ ảnh nền"><X className="size-4" aria-hidden /></Button>}
        </div>
        <SwitchRow checked={decor} onChange={setDecor} label="Họa tiết trang trí" description="Tia sáng, pháo giấy… theo mẫu" />
      </Card>

      {h?.can_manage && (
        <Card className="space-y-2">
          <p className="text-sm text-fg-muted">Ban tổ chức: dùng thiết kế này làm mẫu ảnh nhóm chính thức ở tab Vinh danh (mọi người xem / tải được).</p>
          <Button variant="secondary" block loading={saveOfficial.isPending} onClick={() => saveOfficial.mutate()}>
            <Save className="size-4" aria-hidden />Đặt làm mẫu ảnh nhóm của giải
          </Button>
        </Card>
      )}

      <div className="fixed inset-x-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md border-t border-border bg-bg/95 px-3 py-2 backdrop-blur-md">
        {access.unlocked ? (
          <Button block disabled={!rows.length} loading={saver.busy}
            onClick={() => void saver.saveCanvas(ref.current, `${name || 'vinh-danh'}.png`, `Vinh danh ${d.challenge.title}`)}>
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

function Swatches({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-semibold text-fg-muted">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {SWATCHES.map((c) => (
          <button key={c} type="button" aria-label={`${label} ${c}`} aria-pressed={value.toLowerCase() === c} onClick={() => onChange(c)}
            className={cn('size-8 rounded-full border border-border', value.toLowerCase() === c && 'ring-2 ring-brand ring-offset-2 ring-offset-bg')}
            style={{ background: c }} />
        ))}
      </div>
    </div>
  )
}
