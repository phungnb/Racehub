'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Clock, Crown, Eye, Handshake, ListChecks, Pencil, Swords, Trophy, UserCheck, X } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Card, Field, Sheet, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { ClubAvatar } from '@/features/club'
import { setStravaSharing } from '@/features/integrations'
import { cupErrorMessage, joinCupAsMember, leaveCupAsMember, respondDuel, type Cup, type CupStanding, type MatchTerms } from '../api/cupApi'
import { countdown, duelLead, formatContribution, formatScore, PHASE_INFO, rulesSummary, signupState, validateTerms } from '../model/match'
import { fmtTime } from './CupCard'
import { RulesForm } from './RulesForm'

/** Cập nhật cache sau một thao tác trên trận (chi tiết, danh sách CLB, trang chủ) */
export function useMatchMutation<T>(id: string, fn: (v: T) => Promise<Cup>, ok: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (c) => {
      qc.setQueryData(['cup', id], (old: Cup | undefined) => ({ ...old, ...c, standings: c.standings ?? old?.standings ?? null }))
      void qc.invalidateQueries({ queryKey: ['cups'] })
      void qc.invalidateQueries({ queryKey: ['club-matches'] })
      void qc.invalidateQueries({ queryKey: ['my-club-matches'] })
      toast.success(ok)
    },
    onError: (e) => toast.error(cupErrorMessage(e)),
  })
}

export function PhaseBadge({ c }: { c: Pick<Cup, 'phase'> }) {
  const p = PHASE_INFO[c.phase] ?? PHASE_INFO.REGISTRATION
  return <span className={cn('shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold', p.tone)}>{p.label}</span>
}

/** Luật thi đấu — ai cũng đọc được trước khi đăng ký */
export function RulesCard({ c }: { c: Cup }) {
  return (
    <Card className="space-y-2 p-4">
      <p className="flex items-center gap-2 text-sm font-bold"><ListChecks className="size-4 text-brand" aria-hidden />Luật thi đấu</p>
      <ul className="space-y-1.5 text-sm">
        {rulesSummary(c).map((r) => <li key={r} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />{r}</li>)}
        <li className="flex gap-2 text-fg-muted"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-fg-subtle" aria-hidden />
          Chỉ tính bài chạy hợp lệ, bắt đầu trong giờ thi đấu và được chia sẻ (bài Strava cần bật &quot;Hiện bài Strava&quot;)</li>
      </ul>
    </Card>
  )
}

/** Nút đăng ký thi đấu — luôn hiện rõ cho thành viên: cần làm gì, trước giờ nào */
export function SignupBox({ c, now }: { c: Cup; now: number }) {
  const st = signupState(c, now)
  const join = useMatchMutation(c.id, (club: string) => joinCupAsMember(c.id, club), 'Đã đăng ký thi đấu — chạy trong giờ thi đấu là km được tính cho CLB!')
  const leave = useMatchMutation(c.id, () => leaveCupAsMember(c.id), 'Đã rút đăng ký')
  const qc = useQueryClient()
  const share = useMutation({
    mutationFn: () => setStravaSharing(true),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['cup', c.id] }); toast.success('Đã bật hiện bài Strava — bài chạy sẽ được tính') },
    onError: () => toast.error('Không bật được. Vào Cài đặt → Quyền riêng tư để bật.'),
  })
  if (st.kind === 'NOT_MEMBER' || st.kind === 'WAITING' || st.kind === 'AUTO' && !c.my_strava_hidden) return null
  const club = (id: string) => c.my_clubs.find((m) => m.id === id)
  return (
    <Card className={cn('space-y-3 p-4', st.kind === 'CAN_SIGN' ? 'border-brand bg-brand/5' : 'border-border')}>
      {st.kind === 'CAN_SIGN' && (
        <>
          <p className="flex items-center gap-2 font-bold"><UserCheck className="size-5 text-brand" aria-hidden />Bạn chưa đăng ký thi đấu</p>
          <p className="text-sm text-fg-muted">Chỉ người đã đăng ký mới được tính cho CLB. Hạn chót <b>{fmtTime(st.deadline)}</b> ({countdown(st.deadline, now)}).</p>
          {c.my_clubs.filter((m) => m.joined && m.eligible !== false).map((m) => (
            <Button key={m.id} block size="lg" onClick={() => join.mutate(m.id)} loading={join.isPending && join.variables === m.id} disabled={join.isPending}>
              <UserCheck className="size-5" aria-hidden />Đăng ký thi đấu cho {m.name}
            </Button>
          ))}
        </>
      )}
      {st.kind === 'SIGNED' && (
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-success/15 text-success"><Check className="size-5" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Bạn thi đấu cho {club(st.clubId)?.name ?? 'CLB'}</p>
            <p className="text-xs text-fg-muted">{now < Date.parse(c.start_at) ? `Bắt đầu ${fmtTime(c.start_at)} — mọi bài chạy hợp lệ trong giờ thi đấu đều tính.` : 'Chạy thôi! Bài hợp lệ trong giờ thi đấu được cộng tự động.'}</p>
          </div>
          {st.canLeave && <Button size="sm" variant="ghost" onClick={() => leave.mutate(undefined)} loading={leave.isPending}>Rút</Button>}
        </div>
      )}
      {st.kind === 'NOT_ELIGIBLE' && (
        <p className="flex gap-2 text-sm text-fg-muted"><Clock className="mt-0.5 size-4 shrink-0" aria-hidden />Bạn vào CLB sau khi trận được tạo nên chưa thi đấu được trận này (luật chống &quot;chiêu mộ&quot;). Hẹn trận sau nhé!</p>
      )}
      {st.kind === 'LOCKED' && <p className="flex gap-2 text-sm text-fg-muted"><Clock className="mt-0.5 size-4 shrink-0" aria-hidden />Đã chốt danh sách lúc {fmtTime(c.roster_close_at)}. Bạn có thể theo dõi và cổ vũ CLB.</p>}
      {st.kind === 'CLUB_NOT_IN' && <p className="text-sm text-fg-muted">CLB của bạn chưa vào thách đấu này. Nhắn ban quản trị CLB để đăng ký CLB.</p>}
      {c.my_strava_hidden && (st.kind === 'SIGNED' || st.kind === 'CAN_SIGN' || st.kind === 'AUTO') && (
        <div className="flex items-start gap-2 rounded-xl bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div className="min-w-0 flex-1 space-y-2">
            <p>Bài chạy từ Strava của bạn đang <b>ẩn</b> nên <b>không được tính</b> cho CLB.</p>
            <Button size="sm" variant="secondary" onClick={() => share.mutate()} loading={share.isPending}><Eye className="size-4" aria-hidden />Bật hiện bài Strava</Button>
          </div>
        </div>
      )}
    </Card>
  )
}

/** Bảng điểm trận 1–1: hai bên, thanh so sánh, ai dẫn, top đóng góp */
export function DuelScoreboard({ c, myClub }: { c: Cup; myClub?: string | null }) {
  const st = c.standings ?? []
  const a = st.find((s) => s.club_id === c.host?.id) ?? st[0]
  const b = st.find((s) => s.club_id === c.opponent?.id) ?? st[1]
  if (!a || !b) return null
  const live = c.phase === 'LIVE' || c.phase === 'SETTLING' || c.phase === 'PROVISIONAL'
  const done = c.phase === 'FINISHED'
  const lead = duelLead({ ...c, standings: [a, b] })
  const sa = Number(a.score ?? 0), sb = Number(b.score ?? 0)
  // Pace: thấp hơn là tốt → đảo tỉ lệ để thanh dài hơn là bên đang dẫn
  const share = c.measure === 'PACE' ? (sa && sb ? sb / (sa + sb) : 0.5) : sa + sb > 0 ? sa / (sa + sb) : 0.5
  const winner = done ? c.winner_id : null
  return (
    <Card className="space-y-3 p-4">
      <p className="flex items-center gap-2 text-sm font-bold"><Swords className="size-4 text-fg-muted" aria-hidden />Bảng điểm
        {c.phase === 'LIVE' && <span className="whitespace-nowrap rounded-full bg-danger/15 px-2 py-0.5 text-[10px] font-bold text-danger">TRỰC TIẾP</span>}
        {c.phase === 'PROVISIONAL' && <span className="whitespace-nowrap rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold text-warning">TẠM</span>}
      </p>
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2">
        <Side s={a} measure={c} lead={(done ? winner : lead.leaderId) === a.club_id} mine={myClub === a.club_id} show={live || done} />
        <span className="pt-4 text-xs font-black text-fg-subtle">VS</span>
        <Side s={b} measure={c} lead={(done ? winner : lead.leaderId) === b.club_id} mine={myClub === b.club_id} show={live || done} />
      </div>
      {(live || done) && <p className="text-center text-sm font-semibold">{done ? (winner ? '' : 'Hòa') : lead.text}</p>}
      {(live || done) && (
        <div className="flex h-3 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div className="transition-all" style={{ width: `${share * 100}%`, background: a.accent_color ?? 'var(--color-brand)' }} />
          <div className="flex-1" style={{ background: b.accent_color ?? 'var(--color-live)' }} />
        </div>
      )}
      {(live || done) && (
        <div className="grid grid-cols-2 gap-3">
          {[a, b].map((s) => (
            <ol key={s.club_id} className="space-y-1.5" aria-label={`Đóng góp nhiều nhất ${s.name}`}>
              {!s.top?.length ? <li className="text-xs text-fg-subtle">Chưa có bài chạy</li> : s.top.map((r, i) => (
                <li key={r.user_id} className="flex items-center gap-1.5 text-xs">
                  <span className="w-3 text-fg-subtle">{i + 1}</span>
                  <Avatar src={r.avatar_url} name={r.display_name} size="xs" />
                  <span className="min-w-0 flex-1 truncate">{r.display_name}</span>
                  <span className="font-mono font-semibold">{formatContribution(c.measure, r)}</span>
                </li>
              ))}
            </ol>
          ))}
        </div>
      )}
      {!live && !done && <p className="text-center text-xs text-fg-muted">Bắt đầu {fmtTime(c.start_at)} · đã đăng ký {a.members} vs {b.members} VĐV</p>}
    </Card>
  )
}

function Side({ s, measure, lead, mine, show }: { s: CupStanding; measure: Pick<Cup, 'measure' | 'format'>; lead: boolean; mine: boolean; show: boolean }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1 text-center">
      <div className="relative">
        <ClubAvatar club={s} size="md" />
        {lead && <Crown className="absolute -right-2 -top-3 size-5 text-medal-gold" aria-label="Đang dẫn" />}
      </div>
      <p className={cn('w-full truncate text-sm font-semibold', mine && 'text-brand')}>{s.name}</p>
      {show && <p className="font-mono text-xl font-black tabular">{formatScore(measure, s.score)}</p>}
      <p className="text-[11px] text-fg-subtle">{s.forfeited ? 'Thiếu người — xử thua' : `${s.runners}/${s.members} VĐV đã chạy`}</p>
    </div>
  )
}

/** Kết quả: ai thắng, MVP, kết quả tạm hay chính thức */
export function ResultBanner({ c, now }: { c: Cup; now: number }) {
  if (c.phase === 'PROVISIONAL' || c.phase === 'SETTLING') {
    return (
      <Card className="flex gap-3 border-warning/40 p-4 text-sm">
        <Clock className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
        <div><p className="font-semibold">Kết quả tạm</p>
          <p className="text-fg-muted">Chính thức lúc {fmtTime(c.final_after)} ({countdown(c.final_after, now)}) — chờ bài đồng bộ muộn và bài đang duyệt.
            {!!c.pending_runs && <> Còn <b>{c.pending_runs}</b> bài của VĐV CLB bạn đang chờ duyệt — <Link href={`/clubs/${c.my_clubs.find((m) => m.staff && m.joined)?.id ?? ''}/members`} className="font-semibold text-brand underline">duyệt ngay</Link>.</>}
          </p></div>
      </Card>
    )
  }
  if (c.phase !== 'FINISHED') return null
  const win = c.standings?.find((s) => s.club_id === c.winner_id)
  return (
    <Card className="space-y-2 border-medal-gold/40 bg-medal-gold/5 p-4 text-center">
      <Trophy className="mx-auto size-8 text-medal-gold" aria-hidden />
      <p className="text-lg font-black">{win ? `${win.name} thắng!` : 'Kết quả hòa'}</p>
      {c.mvp && (
        <p className="flex items-center justify-center gap-2 text-sm">
          <Crown className="size-4 text-medal-gold" aria-hidden />MVP: <Avatar src={c.mvp.avatar_url} name={c.mvp.display_name} size="xs" />
          <b>{c.mvp.display_name}</b> · {formatContribution(c.measure, c.mvp)}
        </p>
      )}
      {c.rules_version && <p className="text-xs text-fg-muted">VĐV đã chạy của CLB thắng nhận huy hiệu &quot;Chiến thắng đấu CLB&quot;.</p>}
    </Card>
  )
}

/** Trận 1–1 đang chờ trả lời: nhận lời / từ chối (lý do) / đề xuất lại điều khoản; lịch sử thương lượng */
export function NegotiationBox({ c, now }: { c: Cup; now: number }) {
  const [decline, setDecline] = useState(false)
  const [counter, setCounter] = useState<MatchTerms | null>(null)
  const [note, setNote] = useState('')
  const accept = useMatchMutation(c.id, () => respondDuel(c.id, 'ACCEPT'), 'Đã nhận lời — thành viên hai CLB được mời đăng ký thi đấu!')
  const deny = useMatchMutation(c.id, () => respondDuel(c.id, 'DECLINE', { note: note.trim() || undefined }), 'Đã từ chối')
  const offer = useMatchMutation(c.id, (t: MatchTerms) => respondDuel(c.id, 'COUNTER', { ...t, note: note.trim() || undefined }), 'Đã gửi đề xuất mới')
  const awaiting = c.awaiting_club_id === c.host?.id ? c.host : c.opponent
  const current: MatchTerms = {
    format: c.format, measure: c.measure, top_n: c.top_n, min_roster: c.min_roster, max_roster: c.max_roster, daily_cap_km: c.daily_cap_km,
    share_cap_pct: c.share_cap_pct, pace_min_km: c.pace_min_km, tiebreak: c.tiebreak, lock_hours: c.lock_hours, forfeit_rule: c.forfeit_rule,
    start_at: c.start_at, end_at: c.end_at,
  }
  const err = counter ? validateTerms(counter, now, 'DUEL') : null
  return (
    <Card className="space-y-3 border-warning/40 p-4">
      <p className="flex items-center gap-2 text-sm font-bold"><Handshake className="size-4 text-warning" aria-hidden />
        {c.can_respond ? 'CLB bạn được mời thi đấu' : `Chờ ${awaiting?.name ?? 'đối thủ'} trả lời`}</p>
      <p className="text-xs text-fg-muted">Lời mời hết hạn lúc chốt danh sách ({fmtTime(c.roster_close_at)}). Phiên bản điều khoản: {c.terms_version}.</p>
      {c.can_respond && (
        <div className="space-y-2">
          <Button block size="lg" onClick={() => accept.mutate(undefined)} loading={accept.isPending}><Check className="size-5" aria-hidden />Nhận lời</Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setCounter(current)}><Pencil className="size-4" aria-hidden />Đề xuất lại</Button>
            <Button variant="secondary" onClick={() => setDecline(true)}><X className="size-4" aria-hidden />Từ chối</Button>
          </div>
        </div>
      )}
      {!!c.negotiation?.length && (
        <ol className="space-y-1 border-l-2 border-border pl-3 text-xs text-fg-muted">
          {c.negotiation.map((n, i) => {
            const who = n.club_id === c.host?.id ? c.host?.name : c.opponent?.name
            const act = { PROPOSE: 'gửi lời thách đấu', COUNTER: 'đề xuất lại điều khoản', ACCEPT: 'nhận lời', DECLINE: 'từ chối' }[n.action]
            return <li key={i}><b className="text-fg">{who}</b> {act} · {fmtTime(n.at)}{n.note ? ` — “${n.note}”` : ''}</li>
          })}
        </ol>
      )}
      <Sheet open={decline} onClose={() => setDecline(false)} title="Từ chối lời thách đấu" description="Đối thủ sẽ nhận lý do (không bắt buộc)."
        footer={<Button block variant="danger" onClick={() => { deny.mutate(undefined); setDecline(false) }} loading={deny.isPending}>Từ chối</Button>}>
        <Field label="Lý do" htmlFor="d-note"><Textarea id="d-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="VD: Tuần này CLB đi giải, hẹn tháng sau!" /></Field>
      </Sheet>
      <Sheet open={!!counter} onClose={() => setCounter(null)} title="Đề xuất lại điều khoản" description="Đối thủ sẽ xem và Nhận lời / Từ chối / Đề xuất lại."
        footer={<div className="space-y-2">{err && <p className="text-xs text-danger">{err}</p>}
          <Button block onClick={() => { if (counter) offer.mutate(counter); setCounter(null) }} disabled={!!err} loading={offer.isPending}>Gửi đề xuất</Button></div>}>
        {counter && (
          <div className="space-y-4">
            <RulesForm value={counter} onChange={setCounter} kind="DUEL" />
            <Field label="Lời nhắn (không bắt buộc)" htmlFor="c-note"><Textarea id="c-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="VD: Đấu top 5 cho cân sức nhé" /></Field>
          </div>
        )}
      </Sheet>
    </Card>
  )
}

/** Thẻ gọn một trận — dùng ở tab Đấu CLB và trang chủ: VS / tên giải, trạng thái, việc cần làm */
export function MatchCard({ c, now, clubId }: { c: Cup; now: number; clubId?: string }) {
  const st = signupState(c, now)
  const duel = c.kind === 'DUEL'
  const mine = clubId ?? c.my_signup ?? c.my_clubs.find((m) => m.joined)?.id
  const me = c.standings?.find((s) => s.club_id === mine)
  const other = duel ? c.standings?.find((s) => s.club_id !== mine) : null
  const action = c.can_respond ? { text: 'Trả lời lời mời', tone: 'bg-warning text-bg' }
    : st.kind === 'CAN_SIGN' ? { text: `Đăng ký thi đấu · ${countdown(st.deadline, now)}`, tone: 'bg-brand text-brand-fg' }
    : st.kind === 'SIGNED' && c.phase === 'LIVE' ? { text: 'Bạn đang thi đấu — chạy thôi!', tone: 'bg-success/15 text-success' }
    : st.kind === 'SIGNED' ? { text: 'Đã đăng ký ✓', tone: 'bg-success/15 text-success' }
    : null
  return (
    <Link href={`/cups/${c.id}`} className="block">
      <Card className="space-y-2.5 p-3.5 transition-colors hover:border-fg-subtle">
        <div className="flex items-start justify-between gap-2">
          <p className="line-clamp-2 min-w-0 font-semibold leading-snug">{duel ? `⚔ ${c.title}` : c.title}</p>
          <PhaseBadge c={c} />
        </div>
        <p className="text-xs text-fg-muted">{fmtTime(c.start_at)} → {fmtTime(c.end_at)} · {rulesSummary(c)[0]}</p>
        {me && (c.phase === 'LIVE' || c.phase === 'PROVISIONAL' || c.phase === 'FINISHED' || c.phase === 'SETTLING') && (
          <p className="text-sm">
            {duel && other ? <><b>{formatScore(c, me.score)}</b> <span className="text-fg-muted">vs</span> <b>{formatScore(c, other.score)}</b></>
              : <>Hạng <b>{me.rank}</b>/{c.standings?.length} · <b>{formatScore(c, me.score)}</b></>}
            {c.phase === 'FINISHED' && <span className="ml-2 text-xs font-semibold">{c.winner_id === mine ? '🏆 Thắng' : c.winner_id ? 'Thua' : 'Hòa'}</span>}
          </p>
        )}
        {action && <span className={cn('block rounded-xl px-3 py-2 text-center text-sm font-bold', action.tone)}>{action.text}</span>}
      </Card>
    </Link>
  )
}
