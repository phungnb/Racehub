'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Check, ChevronRight, Crown, Gift, KeyRound, Medal, Search, Swords, X } from 'lucide-react'
import { Avatar, Button, Card, EmptyState, ErrorState, Field, Input, RankSearch, Sheet, Skeleton, Textarea } from '@/shared/ui'
import { filterSearch, matchesSearch } from '@/shared/lib/search'
import { cn } from '@/shared/lib/cn'
import { ClubAvatar } from '@/features/club'
import { cancelCup, cupErrorMessage, getClubBoard, getCup, joinCup, leaveCup, reviewCup, type Cup, type CupStanding } from '../api/cupApi'
import { canJoin } from '../model/cup'
import { formatContribution, formatScore, PHASE_INFO } from '../model/match'
import { fmtTime } from './CupCard'
import { DuelScoreboard, NegotiationBox, PhaseBadge, ResultBanner, RulesCard, SignupBox, useMatchMutation } from './MatchParts'

export function CupDetailScreen({ id }: { id: string }) {
  // Đang thi đấu: làm mới mỗi 20 giây (gần thời gian thực); khi khác: 60 giây
  const q = useQuery({ queryKey: ['cup', id], queryFn: () => getCup(id),
    refetchInterval: (query) => (query.state.data?.phase === 'LIVE' ? 20_000 : 60_000), refetchOnWindowFocus: true })
  const [now] = useState(() => Date.now())
  if (q.isPending) return <div className="space-y-3"><Skeleton className="h-40" /><Skeleton className="h-64" /></div>
  if (q.isError) return <ErrorState message={cupErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
  const c = q.data
  const duel = c.kind === 'DUEL'
  const back = duel ? `/clubs/${c.my_clubs.find((m) => m.joined)?.id ?? c.host?.id}/leaderboard?tab=battles` : '/cups'
  const showBoard = c.standings && ['OPEN', 'PROVISIONAL', 'FINISHED'].includes(c.status)
  return (
    <div className="space-y-4 pb-6 animate-fade-in">
      <Link href={back} className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"><ArrowLeft className="size-4" aria-hidden />{duel ? 'Đấu CLB' : 'Thách đấu CLB'}</Link>
      <Card className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-xl font-bold leading-tight">{duel ? `⚔ ${c.title}` : c.title}</h1>
          <PhaseBadge c={c} />
        </div>
        {!duel && <p className="text-sm text-fg-muted">{c.host ? `${c.host.name} tổ chức` : `${c.creator?.display_name ?? 'RaceHub'} tổ chức`}</p>}
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <Info label="Bắt đầu" value={fmtTime(c.start_at)} />
          <Info label="Kết thúc" value={fmtTime(c.end_at)} />
          {c.require_signup && <Info label="Chốt danh sách" value={fmtTime(c.roster_close_at)} />}
          {duel ? <Info label="Trạng thái" value={PHASE_INFO[c.phase]?.label ?? ''} /> : <Info label="CLB" value={`${c.clubs} / ${c.max_clubs}`} />}
          {!duel && c.status === 'OPEN' && <Info label="Hạn CLB đăng ký" value={fmtTime(c.reg_close_at)} />}
        </dl>
        {c.prize && <p className="flex items-start gap-2 text-sm"><Gift className="mt-0.5 size-4 shrink-0 text-coin" aria-hidden />{c.prize}</p>}
        {c.description && <p className="whitespace-pre-line text-sm italic text-fg-muted">{duel ? `“${c.description}”` : c.description}</p>}
        {c.decline_reason && <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm">Lý do từ chối: {c.decline_reason}</p>}
        {c.cancel_reason && c.status === 'CANCELLED' && <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm">{c.cancel_reason}</p>}
      </Card>

      <ReviewBox c={c} />
      {c.status === 'INVITED' && <NegotiationBox c={c} now={now} />}
      <ResultBanner c={c} now={now} />
      {c.status === 'OPEN' && !duel && <JoinBox c={c} now={now} />}
      <SignupBox c={c} now={now} />
      {showBoard && (duel ? <DuelScoreboard c={c} myClub={c.my_signup ?? c.my_clubs.find((m) => m.joined)?.id} /> : <Standings c={c} />)}
      {showBoard && duel && <RosterLinks c={c} />}
      <RulesCard c={c} />
      {c.can_cancel && <CancelButton c={c} />}
    </div>
  )
}

/** Trận 1–1: mở bảng VĐV từng CLB (người đã đăng ký, km tính / km gốc, pace) */
function RosterLinks({ c }: { c: Cup }) {
  const [open, setOpen] = useState<CupStanding | null>(null)
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {(c.standings ?? []).map((s) => (
          <Button key={s.club_id} variant="secondary" size="sm" onClick={() => setOpen(s)}>VĐV {s.name} ({s.members})</Button>
        ))}
      </div>
      {open && <ClubBoardSheet c={c} club={open} onClose={() => setOpen(null)} />}
    </>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-surface-2 px-3 py-2"><dt className="text-[11px] text-fg-subtle">{label}</dt><dd className="font-semibold">{value}</dd></div>
}

/** Chờ duyệt: admin duyệt / từ chối; người tạo thấy trạng thái; bị từ chối thì thấy lý do */
function ReviewBox({ c }: { c: Cup }) {
  const [reject, setReject] = useState(false)
  const [note, setNote] = useState('')
  const approve = useMatchMutation(c.id, () => reviewCup(c.id, true), 'Đã duyệt — thách đấu mở đăng ký')
  const deny = useMatchMutation(c.id, () => reviewCup(c.id, false, note), 'Đã từ chối, người tạo nhận được lý do')
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
  const join = useMatchMutation(c.id, (club: string) => joinCup(c.id, club), 'Đã đăng ký CLB — thành viên đã được báo')
  const leave = useMatchMutation(c.id, (club: string) => leaveCup(c.id, club), 'Đã rút CLB khỏi thách đấu')
  const staff = c.my_clubs.filter((m) => m.staff)
  const open = canJoin(c, now)
  const started = now >= Date.parse(c.start_at)
  if (!c.my_clubs.length) return null
  return (
    <Card className="space-y-2 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold"><KeyRound className="size-4 text-coin" aria-hidden />Đăng ký CLB</p>
      {!staff.length && (
        <p className="text-sm text-fg-muted">Chỉ Chủ nhiệm / Quản trị viên mới đăng ký CLB được. Nhắn ban quản trị CLB của bạn nếu muốn tham gia.
          {c.my_clubs.some((m) => m.joined) && (c.require_signup ? ' CLB của bạn đã có trong thách đấu — bấm Đăng ký thi đấu bên dưới để km được tính.' : ' CLB của bạn đã có trong thách đấu — cứ chạy là km được tính!')}</p>
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

function Standings({ c }: { c: Cup }) {
  const live = c.phase === 'LIVE'
  const mine = new Set(c.my_clubs.filter((m) => m.joined).map((m) => m.id))
  const rows = c.standings ?? []
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState<CupStanding | null>(null)
  const shown = rows.filter((s) => !term.trim() || matchesSearch(term, s.name))
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-bold">
        <Swords className="size-4 text-fg-muted" aria-hidden />Bảng xếp hạng {live && <span className="rounded-full bg-danger/15 px-2 py-0.5 text-[10px] font-bold text-danger">TRỰC TIẾP</span>}
      </h2>
      {rows.length > 3 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Tìm CLB…" aria-label="Tìm CLB trên bảng xếp hạng" className="pl-9" />
        </div>
      )}
      {!rows.length ? <EmptyState icon={Swords} title="Chưa có CLB nào" description="Ban quản trị CLB bấm Đăng ký để đưa CLB vào thách đấu." /> : !shown.length ? (
        <p className="py-4 text-center text-sm text-fg-muted">Không có CLB nào khớp “{term}”.</p>
      ) : (
        <ol className="space-y-1.5">
          {shown.map((s) => (
            <li key={s.club_id}>
              <button type="button" onClick={() => setOpen(s)} aria-label={`Xem bảng xếp hạng thành viên ${s.name}`}
                className={cn('flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left hover:border-fg-subtle', mine.has(s.club_id) ? 'border-brand/50 bg-brand/10' : 'border-border bg-surface')}>
                <span className="grid w-7 place-items-center font-mono text-sm font-bold text-fg-muted">
                  {s.rank <= 3 && c.status === 'FINISHED' ? (s.rank === 1 ? <Crown className={cn('size-5', MEDAL[0])} aria-label="Hạng 1" /> : <Medal className={cn('size-5', MEDAL[s.rank - 1])} aria-label={`Hạng ${s.rank}`} />) : s.rank}
                </span>
                <ClubAvatar club={s} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{s.name}</span>
                  <span className="block text-[11px] text-fg-muted">{s.forfeited ? 'Thiếu người — xử thua' : `${s.runners}/${s.members} VĐV đã chạy · ${s.km.toLocaleString('vi-VN')} km`}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-base font-bold tabular">{formatScore(c, s.score)}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
              </button>
            </li>
          ))}
        </ol>
      )}
      {open && <ClubBoardSheet c={c} club={open} onClose={() => setOpen(null)} />}
    </section>
  )
}

/** BXH thành viên của một CLB trong giải: tên, ngày chạy, pace TB, tổng km — tìm runner */
function ClubBoardSheet({ c, club, onClose }: { c: Cup; club: CupStanding; onClose: () => void }) {
  const cupId = c.id
  const q = useQuery({ queryKey: ['cup', cupId, 'club', club.club_id], queryFn: () => getClubBoard(cupId, club.club_id) })
  const [term, setTerm] = useState('')
  const rows = q.data?.rows ?? []
  const shown = filterSearch(rows, term, (r) => [r.display_name])
  return (
    <Sheet open onClose={onClose} title={club.name} description={`Hạng ${club.rank} · ${formatScore(c, club.score)} · ${club.runners}/${club.members} VĐV đã chạy. Dòng mờ: chưa được tính (ngoài top / chưa đủ km tối thiểu).`}>
      <div className="space-y-2">
        {rows.length > 5 && <RankSearch value={term} onChange={setTerm} total={rows.length} matched={shown.length} placeholder="Tìm runner…" />}
        {q.isPending ? <Skeleton className="h-40" /> : q.isError ? <ErrorState message={cupErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
          : !rows.length ? <p className="py-6 text-center text-sm text-fg-muted">Chưa có VĐV nào đăng ký.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] uppercase text-fg-subtle">
                  <tr><th className="py-1.5 pr-2">#</th><th className="py-1.5">Runner</th><th className="py-1.5 text-right">Ngày</th><th className="py-1.5 text-right">Pace</th><th className="py-1.5 text-right">{c.measure === 'TIME' ? 'Thời gian' : c.measure === 'PACE' ? 'Km' : 'Km tính'}</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {shown.map((r) => (
                    <tr key={r.user_id} className={cn(r.counted === false && 'opacity-50')}>
                      <td className="py-2 pr-2 font-mono text-fg-muted">{r.rank}</td>
                      <td className="py-2"><span className="flex min-w-0 items-center gap-2"><Avatar src={r.avatar_url} name={r.display_name} size="xs" /><span className="truncate font-medium">{r.display_name ?? 'Runner'}</span></span></td>
                      <td className="py-2 text-right font-mono">{r.days}</td>
                      <td className="py-2 text-right font-mono">{formatContribution('PACE', r)}</td>
                      <td className="py-2 text-right font-mono font-bold" title={r.raw_km != null && r.raw_km !== r.km ? `Km gốc ${r.raw_km} (đã áp trần ngày)` : undefined}>
                        {c.measure === 'PACE' ? Number(r.km).toLocaleString('vi-VN') : formatContribution(c.measure, r).replace(' km', '')}{r.raw_km != null && r.raw_km > r.km ? '*' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </Sheet>
  )
}

function CancelButton({ c }: { c: Cup }) {
  const [ask, setAsk] = useState(false)
  const cancel = useMatchMutation(c.id, () => cancelCup(c.id), 'Đã hủy thách đấu')
  return (
    <>
      <Button block variant="ghost" onClick={() => setAsk(true)}>{c.kind === 'DUEL' ? 'Hủy trận' : 'Hủy thách đấu'}</Button>
      <Sheet open={ask} onClose={() => setAsk(false)} title={c.kind === 'DUEL' ? 'Hủy trận?' : 'Hủy thách đấu?'} description="Các CLB sẽ nhận thông báo. Không hoàn tác được."
        footer={<Button block variant="danger" onClick={() => { cancel.mutate(undefined); setAsk(false) }} loading={cancel.isPending}>Hủy thách đấu</Button>}>
        <p className="text-sm text-fg-muted">{c.title}</p>
      </Sheet>
    </>
  )
}
