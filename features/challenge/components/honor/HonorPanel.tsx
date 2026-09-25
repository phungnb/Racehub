'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Crown, Download, EyeOff, Eye, Megaphone, Palette, Settings2, Trophy, Undo2, UserSquare2 } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Card, ConfirmSheet, EmptyState, ErrorState, Skeleton, useImageSaver } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { useMyProfile } from '@/features/auth'
import { DesignCanvas } from '@/shared/design/DesignCanvas'
import { FileButton } from '@/shared/design/studio/bits'
import {
  challengeErrorMessage, getHonor, publishHonor, setHonorPref, unpublishHonor, uploadHonorImage,
  type ChallengeDetail, type Honoree, type HonorState, type LeaderboardEntry,
} from '../../api/challengeApi'
import { drawHonor, HONOR_FORMATS, honorData, honorValue, resolveHonor, type HonorContext, type HonorMode } from '../../model/honor'
import { HonorDesigner } from './HonorDesigner'
import { HonorSetup } from './HonorSetup'

export const honorKey = (id: string) => ['challenge', id, 'honor'] as const
export function useHonor(id: string, enabled = true) {
  return useQuery({ queryKey: honorKey(id), queryFn: () => getHonor(id), enabled, retry: false })
}

const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })

export function honorContext(d: ChallengeDetail): HonorContext {
  const c = d.challenge
  return {
    challenge: c.title, org: d.club?.name ?? d.creator?.display_name ?? 'RaceHub',
    date: new Date(c.end_date).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    objective: c.objective, challengeUrl: typeof window === 'undefined' ? null : `${window.location.origin}/challenges/${c.id}`,
  }
}

/** Tab Vinh danh: ảnh nhóm theo hạng mục, danh sách, ảnh cá nhân; BTC thiết lập / thiết kế / công bố */
export function HonorPanel({ d, participants }: { d: ChallengeDetail; participants: LeaderboardEntry[] }) {
  const id = d.challenge.id
  const q = useHonor(id)
  const [cat, setCat] = useState<string | null>(null)
  if (q.isPending) return <Skeleton className="h-96" />
  if (q.isError) return <ErrorState message={challengeErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
  const h = q.data
  const ctx = honorContext(d)
  const cats = h.categories.length ? h.categories : h.can_manage ? [{ key: 'TOP' as const, title: 'Top thành tích', count: 3 }] : []
  const active = cats.find((c) => c.key === cat) ?? cats[0]
  const rows = active ? h.honorees.filter((x) => x.category === active.key) : []
  const mine = h.honorees.filter((x) => x.is_me)

  if (!h.can_manage && (!h.enabled || h.status !== 'PUBLISHED')) {
    return <EmptyState icon={Trophy} title="Chưa có vinh danh" description="Ban tổ chức sẽ công bố vinh danh sau khi thử thách kết thúc." />
  }
  return (
    <section className="space-y-4">
      {h.can_manage && <ManageBar h={h} d={d} participants={participants} ctx={ctx} />}

      {mine.length > 0 && h.status === 'PUBLISHED' && <MyHonor h={h} d={d} ctx={ctx} mine={mine} />}

      {cats.length > 1 && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {cats.map((c) => (
            <button key={c.key} type="button" aria-pressed={active?.key === c.key} onClick={() => setCat(c.key)}
              className={cn('shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold', active?.key === c.key ? 'border-brand bg-brand text-brand-fg' : 'border-border text-fg-muted')}>
              {c.title}
            </button>
          ))}
        </div>
      )}
      {active && (
        <>
          <HonorImage h={h} mode="poster" ctx={ctx} cat={active} rows={rows} name={`vinh-danh-${active.key.toLowerCase()}`} />
          <ol className="space-y-1.5">
            {rows.map((r) => <HonoreeRow key={`${r.category}-${r.rank}`} r={r} h={h} challengeId={id} objective={d.challenge.objective} cat={active.key} />)}
            {!rows.length && <li className="rounded-xl border border-dashed border-border p-3 text-sm text-fg-muted">Chưa có ai đạt hạng mục này.</li>}
          </ol>
        </>
      )}
    </section>
  )
}

function HonorImage({ h, mode, ctx, cat, rows, me, name }: {
  h: HonorState; mode: HonorMode; ctx: HonorContext; cat: { key: string; title: string; count: number }; rows: Honoree[]; me?: Honoree | null; name: string
}) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const design = mode === 'poster' ? h.design : h.card_design
  const n = Math.max(1, ...h.categories.map((c) => c.count), cat.count)
  const size = HONOR_FORMATS[resolveHonor(design, mode, n).format]
  const data = honorData(ctx, cat, rows, me)
  const saver = useImageSaver()
  return (
    <div className="space-y-2">
      <div className={cn('mx-auto', size.h > size.w * 1.4 ? 'max-w-xs' : size.h >= size.w ? 'max-w-md' : '')}>
        <DesignCanvas ref={ref} size={size} label={`Ảnh vinh danh ${cat.title}`} drawKey={JSON.stringify([design, data, n])}
          draw={(c) => drawHonor(c, design, mode, data, {}, n)} />
      </div>
      <Button block variant="secondary" loading={saver.busy} onClick={() => void saver.saveCanvas(ref.current, `${name}.png`, `Vinh danh ${ctx.challenge}`)}>
        <Download className="size-4" aria-hidden />Lưu ảnh {mode === 'card' ? 'của tôi' : 'vinh danh'}</Button>
      {saver.sheet}
    </div>
  )
}

function ManageBar({ h, d, participants, ctx }: { h: HonorState; d: ChallengeDetail; participants: LeaderboardEntry[]; ctx: HonorContext }) {
  const qc = useQueryClient()
  const id = d.challenge.id
  const [sheet, setSheet] = useState<'setup' | 'poster' | 'card' | 'publish' | 'unpublish' | null>(null)
  const done = (r: HonorState, msg: string) => { qc.setQueryData(honorKey(id), r); toast.success(msg); setSheet(null) }
  const publish = useMutation({ mutationFn: () => publishHonor(id), onSuccess: (r) => done(r, 'Đã công bố vinh danh — người được vinh danh nhận thông báo'),
    onError: (e) => toast.error(challengeErrorMessage(e)) })
  const unpublish = useMutation({ mutationFn: () => unpublishHonor(id), onSuccess: (r) => done(r, 'Đã chuyển vinh danh về bản nháp'),
    onError: (e) => toast.error(challengeErrorMessage(e)) })
  const [now] = useState(() => Date.now())
  const reviewDone = now >= Date.parse(h.review_until)

  if (!h.allowed) {
    return (
      <Card className="space-y-2 border-coin/40 bg-coin/5">
        <p className="flex items-center gap-2 font-semibold"><Crown className="size-4 text-coin" aria-hidden />Vinh danh là tính năng CLB Pro / VIP</p>
        <p className="text-sm text-fg-muted">
          Thiết kế ảnh vinh danh chuyên nghiệp (khung ảnh runner, 10 nền, 40 font), tự tính Top thành tích / chạy đều / bứt phá / được tiếp sức,
          công bố và gửi thông báo cho người được vinh danh. Nâng cấp CLB lên Pro hoặc gói VIP của bạn để dùng.
        </p>
        <Link href={routes.plan}><Button size="sm">Xem gói Pro / VIP</Button></Link>
      </Card>
    )
  }
  return (
    <Card className="space-y-3 border-xp/40">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('rounded-full px-2.5 py-1 text-xs font-bold', h.status === 'PUBLISHED' ? 'bg-brand text-brand-fg' : 'bg-warning/15 text-warning')}>
          {h.status === 'PUBLISHED' ? 'Đã công bố' : 'Bản nháp — chỉ BTC thấy'}
        </span>
        {!h.enabled && <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-fg-muted">Đang tắt</span>}
      </div>
      <p className="text-xs text-fg-muted">
        {h.status === 'PUBLISHED'
          ? `Công bố lúc ${h.published_at ? fmtDateTime(h.published_at) : ''}. Công bố lại để cập nhật theo kết quả mới nhất (không gửi thông báo trùng).`
          : !h.ended ? `Danh sách đang tạm tính theo tiến độ hiện tại. Công bố được từ ${fmtDateTime(h.review_until)} (24 giờ sau khi kết thúc, để duyệt bài / khiếu nại).`
          : reviewDone ? 'Đã qua thời gian khiếu nại — có thể chốt và công bố.' : `Đang trong thời gian khiếu nại — công bố được từ ${fmtDateTime(h.review_until)}.`}
      </p>
      <div className="grid grid-cols-3 gap-2">
        <Button size="sm" variant="secondary" onClick={() => setSheet('setup')}><Settings2 className="size-4" aria-hidden />Hạng mục</Button>
        <Button size="sm" variant="secondary" onClick={() => setSheet('poster')}><Palette className="size-4" aria-hidden />Ảnh nhóm</Button>
        <Button size="sm" variant="secondary" onClick={() => setSheet('card')}><UserSquare2 className="size-4" aria-hidden />Ảnh cá nhân</Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => setSheet('publish')} disabled={!reviewDone || !h.enabled || !h.categories.length}>
          <Megaphone className="size-4" aria-hidden />{h.status === 'PUBLISHED' ? 'Công bố lại' : 'Chốt & công bố'}
        </Button>
        {h.status === 'PUBLISHED' && <Button variant="ghost" onClick={() => setSheet('unpublish')}><Undo2 className="size-4" aria-hidden />Gỡ công bố</Button>}
      </div>
      {sheet === 'setup' && <HonorSetup challengeId={id} honor={h} participants={participants} onClose={() => setSheet(null)} />}
      {(sheet === 'poster' || sheet === 'card') && <HonorDesigner challengeId={id} honor={h} mode={sheet} ctx={ctx} onClose={() => setSheet(null)} />}
      <ConfirmSheet open={sheet === 'publish'} onClose={() => setSheet(null)} onConfirm={() => publish.mutate()} loading={publish.isPending} danger={false}
        title={h.status === 'PUBLISHED' ? 'Công bố lại vinh danh?' : 'Chốt & công bố vinh danh?'} confirmLabel="Công bố"
        description="Danh sách chốt theo kết quả hiện tại. Mọi người xem được; người được vinh danh nhận thông báo + huy hiệu. Runner có thể tự đổi ảnh hoặc ẩn mình khỏi ảnh công khai." />
      <ConfirmSheet open={sheet === 'unpublish'} onClose={() => setSheet(null)} onConfirm={() => unpublish.mutate()} loading={unpublish.isPending}
        title="Gỡ công bố vinh danh?" description="Mọi người sẽ không xem được cho tới khi bạn công bố lại." confirmLabel="Gỡ công bố" />
    </Card>
  )
}

function HonoreeRow({ r, h, challengeId, objective, cat }: { r: Honoree; h: HonorState; challengeId: string; objective: string; cat: string }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const setPhoto = async (f: File | undefined) => {
    if (!f) return
    setBusy(true)
    try {
      const url = await uploadHonorImage(challengeId, f)
      qc.setQueryData(honorKey(challengeId), await setHonorPref(challengeId, r.user_id, { photo_url: url }))
      toast.success('Đã đổi ảnh vinh danh')
    } catch (e) { toast.error(challengeErrorMessage(e)) } finally { setBusy(false) }
  }
  const medal = ['text-medal-gold', 'text-medal-silver', 'text-medal-bronze'][r.rank - 1] ?? 'text-fg-muted'
  return (
    <li className={cn('flex items-center gap-3 rounded-xl border px-3 py-2.5', r.is_me ? 'border-brand/50 bg-brand/10' : 'border-border bg-surface')}>
      <span className={cn('w-6 text-center font-mono text-sm font-bold', medal)}>{cat.startsWith('CUSTOM') ? '★' : r.rank}</span>
      <Avatar src={r.photo_url ?? r.avatar_url} name={r.display_name} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{r.is_me ? `${r.display_name} (bạn)` : r.display_name}</span>
        {r.value != null && <span className="font-mono text-xs text-fg-subtle">{honorValue(cat, r.value, objective)}</span>}
      </span>
      {h.can_manage && !r.hidden && (
        <FileButton onPick={setPhoto} disabled={busy} label="Chọn ảnh vinh danh cho runner này"
          className="grid size-9 place-items-center rounded-lg text-fg-muted hover:bg-surface-2">
          <Camera className={cn('size-4', busy && 'animate-pulse')} aria-hidden />
        </FileButton>
      )}
    </li>
  )
}

/** Người được vinh danh: ảnh cá nhân, đổi ảnh, ẩn mình khỏi ảnh công khai */
function MyHonor({ h, d, ctx, mine }: { h: HonorState; d: ChallengeDetail; ctx: HonorContext; mine: Honoree[] }) {
  const qc = useQueryClient()
  const id = d.challenge.id
  const [pick, setPick] = useState(0)
  const [busy, setBusy] = useState(false)
  const { profile } = useMyProfile()
  const me = mine[Math.min(pick, mine.length - 1)]
  const cat = h.categories.find((c) => c.key === me.category) ?? { key: me.category, title: me.category, count: 1 }
  const withOwn = { ...me, photo_url: me.own_photo ?? me.photo_url, display_name: me.hidden ? profile?.display_name ?? me.display_name : me.display_name }
  const pref = async (p: { photo_url?: string | null; hidden?: boolean }) => {
    setBusy(true)
    try { qc.setQueryData(honorKey(id), await setHonorPref(id, me.user_id, p)) } catch (e) { toast.error(challengeErrorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <Card className="space-y-3 border-coin/50 bg-gradient-to-br from-coin/10 via-surface to-surface">
      <p className="flex items-center gap-2 font-semibold"><Crown className="size-4 text-coin" aria-hidden />Bạn được vinh danh!</p>
      {mine.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {mine.map((m, i) => (
            <button key={m.category} type="button" aria-pressed={i === pick} onClick={() => setPick(i)}
              className={cn('rounded-full border px-3 py-1 text-xs font-semibold', i === pick ? 'border-coin bg-coin/15' : 'border-border text-fg-muted')}>
              {h.categories.find((c) => c.key === m.category)?.title ?? m.category}
            </button>
          ))}
        </div>
      )}
      <HonorImage h={h} mode="card" ctx={ctx} cat={cat} rows={[]} me={withOwn} name={`vinh-danh-cua-toi-${me.category.toLowerCase()}`} />
      <div className="grid grid-cols-2 gap-2">
        <FileButton disabled={busy} label="Đổi ảnh của tôi"
          onPick={async (f) => { if (!f) return; setBusy(true); try { await pref({ photo_url: await uploadHonorImage(id, f) }); toast.success('Đã đổi ảnh') } catch (e) { toast.error(challengeErrorMessage(e)) } finally { setBusy(false) } }}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-surface-2 px-3 text-sm font-semibold">
          <Camera className="size-4" aria-hidden />Đổi ảnh của tôi
        </FileButton>
        <Button variant="ghost" onClick={() => pref({ hidden: !me.hidden })} loading={busy}>
          {me.hidden ? <><Eye className="size-4" aria-hidden />Hiện tôi công khai</> : <><EyeOff className="size-4" aria-hidden />Ẩn tôi khỏi ảnh công khai</>}
        </Button>
      </div>
      {me.hidden && <p className="text-xs text-fg-muted">Người khác đang thấy bạn là “VĐV ẩn danh”, không có ảnh.</p>}
    </Card>
  )
}
