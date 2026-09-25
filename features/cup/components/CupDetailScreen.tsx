'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, Crown, Gift, KeyRound, Medal, Swords, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, EmptyState, ErrorState, Field, Sheet, Skeleton, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { ClubAvatar } from '@/features/club'
import { cancelCup, cupErrorMessage, getCup, joinCup, leaveCup, reviewCup, type Cup } from '../api/cupApi'
import { canJoin, cupPhase, METRIC_LABEL } from '../model/cup'
import { fmtTime, PhaseChip } from './CupCard'

export function CupDetailScreen({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['cup', id], queryFn: () => getCup(id), refetchInterval: 60_000 })
  const [now] = useState(() => Date.now())
  if (q.isPending) return <div className="space-y-3"><Skeleton className="h-40" /><Skeleton className="h-64" /></div>
  if (q.isError) return <ErrorState message={cupErrorMessage(q.error)} onRetry={() => void q.refetch()} />
  const c = q.data
  const phase = cupPhase(c, now)
  return (
    <div className="space-y-4 pb-6 animate-fade-in">
      <Link href="/cups" className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"><ArrowLeft className="size-4" aria-hidden />Thách đấu CLB</Link>
      <Card className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-xl font-bold leading-tight">{c.title}</h1>
          <PhaseChip c={c} now={now} />
        </div>
        <p className="text-sm text-fg-muted">{c.host ? `${c.host.name} tổ chức` : `${c.creator?.display_name ?? 'RaceHub'} tổ chức`}</p>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <Info label="Bắt đầu" value={fmtTime(c.start_at)} />
          <Info label="Kết thúc" value={fmtTime(c.end_at)} />
          <Info label="Hạn đăng ký" value={fmtTime(c.reg_close_at)} />
          <Info label="CLB" value={`${c.clubs} / ${c.max_clubs}`} />
        </dl>
        <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm"><span className="font-semibold">Tính điểm: </span>{METRIC_LABEL[c.metric].title} · {METRIC_LABEL[c.metric].hint}</p>
        {c.prize && <p className="flex items-start gap-2 text-sm"><Gift className="mt-0.5 size-4 shrink-0 text-coin" aria-hidden />{c.prize}</p>}
        {c.description && <p className="whitespace-pre-line text-sm text-fg-muted">{c.description}</p>}
      </Card>

      <ReviewBox c={c} />
      {c.status === 'OPEN' && <JoinBox c={c} now={now} />}
      {c.standings && c.status !== 'PENDING_REVIEW' && c.status !== 'REJECTED' && <Standings c={c} live={phase === 'LIVE'} />}
      {c.can_manage && (c.status === 'PENDING_REVIEW' || (c.status === 'OPEN' && phase === 'REGISTRATION')) && <CancelButton c={c} />}
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-surface-2 px-3 py-2"><dt className="text-[11px] text-fg-subtle">{label}</dt><dd className="font-semibold">{value}</dd></div>
}

function useCupMutation<T>(id: string, fn: (v: T) => Promise<Cup>, ok: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (c) => { qc.setQueryData(['cup', id], (old: Cup | undefined) => ({ ...old, ...c, standings: c.standings ?? old?.standings ?? null })); void qc.invalidateQueries({ queryKey: ['cups'] }); toast.success(ok) },
    onError: (e) => toast.error(cupErrorMessage(e)),
  })
}

/** Chờ duyệt: admin duyệt / từ chối; người tạo thấy trạng thái; bị từ chối thì thấy lý do */
function ReviewBox({ c }: { c: Cup }) {
  const [reject, setReject] = useState(false)
  const [note, setNote] = useState('')
  const approve = useCupMutation(c.id, () => reviewCup(c.id, true), 'Đã duyệt — thách đấu mở đăng ký')
  const deny = useCupMutation(c.id, () => reviewCup(c.id, false, note), 'Đã từ chối, người tạo nhận được lý do')
  if (c.status === 'REJECTED') return <Card className="border-danger/40 p-4 text-sm"><p className="font-semibold text-danger">Không được duyệt</p>{c.review_note && <p className="mt-1 text-fg-muted">{c.review_note}</p>}</Card>
  if (c.status !== 'PENDING_REVIEW') return null
  if (!c.can_review) return <Card className="border-warning/40 p-4 text-sm text-fg-muted">Thách đấu đang chờ admin RaceHub duyệt. Bạn sẽ nhận thông báo khi có kết quả.</Card>
  return (
    <Card className="space-y-3 border-warning/40 p-4">
      <p className="text-sm font-semibold">Duyệt thách đấu do {c.creator?.display_name ?? 'người dùng'} tạo</p>
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => approve.mutate(undefined)} loading={approve.isPending}><Check className="size-4" aria-hidden />Duyệt</Button>
        <Button variant="danger" onClick={() => setReject(true)}><X className="size-4" aria-hidden />Từ chối</Button>
      </div>
      <Sheet open={reject} onClose={() => setReject(false)} title="Từ chối thách đấu" description="Người tạo sẽ nhận lý do này."
        footer={<Button block variant="danger" onClick={() => deny.mutate(undefined)} loading={deny.isPending} disabled={note.trim().length < 3}>Từ chối</Button>}>
        <Field label="Lý do" htmlFor="cup-note"><Textarea id="cup-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="VD: Trùng thời gian với giải của RaceHub" /></Field>
      </Sheet>
    </Card>
  )
}

/** Đăng ký CLB: chỉ CLB mình là Chủ nhiệm / Quản trị viên */
function JoinBox({ c, now }: { c: Cup; now: number }) {
  const join = useCupMutation(c.id, (club: string) => joinCup(c.id, club), 'Đã đăng ký CLB — thành viên đã được báo')
  const leave = useCupMutation(c.id, (club: string) => leaveCup(c.id, club), 'Đã rút CLB khỏi thách đấu')
  const staff = c.my_clubs.filter((m) => m.staff)
  const open = canJoin(c, now)
  const started = now >= Date.parse(c.start_at)
  if (!c.my_clubs.length) return null
  return (
    <Card className="space-y-2 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold"><KeyRound className="size-4 text-coin" aria-hidden />Đăng ký CLB</p>
      {!staff.length && (
        <p className="text-sm text-fg-muted">Chỉ Chủ nhiệm / Quản trị viên mới đăng ký CLB được. Nhắn ban quản trị CLB của bạn nếu muốn tham gia.
          {c.my_clubs.some((m) => m.joined) && ' CLB của bạn đã có trong thách đấu — cứ chạy là km được tính!'}</p>
      )}
      {staff.map((m) => (
        <div key={m.id} className="flex items-center gap-3 rounded-xl border border-border p-2.5">
          <ClubAvatar club={m} size="sm" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{m.name}</span>
          {m.joined ? (
            started ? <span className="text-xs font-semibold text-brand">Đang thi đấu</span>
              : <Button size="sm" variant="ghost" onClick={() => leave.mutate(m.id)} loading={leave.isPending && leave.variables === m.id}>Rút</Button>
          ) : (
            <Button size="sm" onClick={() => join.mutate(m.id)} loading={join.isPending && join.variables === m.id} disabled={!open}>
              {open ? 'Đăng ký' : 'Đã đóng'}
            </Button>
          )}
        </div>
      ))}
    </Card>
  )
}

const MEDAL = ['text-medal-gold', 'text-medal-silver', 'text-medal-bronze']

function Standings({ c, live }: { c: Cup; live: boolean }) {
  const mine = new Set(c.my_clubs.filter((m) => m.joined).map((m) => m.id))
  const rows = c.standings ?? []
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-bold">
        <Swords className="size-4 text-fg-muted" aria-hidden />Bảng xếp hạng {live && <span className="rounded-full bg-danger/15 px-2 py-0.5 text-[10px] font-bold text-danger">TRỰC TIẾP</span>}
      </h2>
      {!rows.length ? <EmptyState icon={Swords} title="Chưa có CLB nào" description="Ban quản trị CLB bấm Đăng ký để đưa CLB vào thách đấu." /> : (
        <ol className="space-y-1.5">
          {rows.map((s) => (
            <li key={s.club_id} className={cn('flex items-center gap-3 rounded-xl border px-3 py-2.5', mine.has(s.club_id) ? 'border-brand/50 bg-brand/10' : 'border-border bg-surface')}>
              <span className="grid w-7 place-items-center font-mono text-sm font-bold text-fg-muted">
                {s.rank <= 3 && c.status === 'FINISHED' ? (s.rank === 1 ? <Crown className={cn('size-5', MEDAL[0])} aria-label="Hạng 1" /> : <Medal className={cn('size-5', MEDAL[s.rank - 1])} aria-label={`Hạng ${s.rank}`} />) : s.rank}
              </span>
              <ClubAvatar club={s} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{s.name}</span>
                <span className="block text-[11px] text-fg-muted">{s.runners}/{s.members} người chạy{c.metric === 'AVG_KM' && ` · ${s.km.toLocaleString('vi-VN')} km`}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-mono text-base font-bold tabular">{(c.metric === 'TOTAL_KM' ? s.km : s.avg_km).toLocaleString('vi-VN')}</span>
                <span className="block text-[10px] text-fg-muted">{METRIC_LABEL[c.metric].unit}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function CancelButton({ c }: { c: Cup }) {
  const [ask, setAsk] = useState(false)
  const cancel = useCupMutation(c.id, () => cancelCup(c.id), 'Đã hủy thách đấu')
  return (
    <>
      <Button block variant="ghost" onClick={() => setAsk(true)}>Hủy thách đấu</Button>
      <Sheet open={ask} onClose={() => setAsk(false)} title="Hủy thách đấu?" description="Các CLB đã đăng ký sẽ nhận thông báo. Không hoàn tác được."
        footer={<Button block variant="danger" onClick={() => { cancel.mutate(undefined); setAsk(false) }} loading={cancel.isPending}>Hủy thách đấu</Button>}>
        <p className="text-sm text-fg-muted">{c.title}</p>
      </Sheet>
    </>
  )
}
