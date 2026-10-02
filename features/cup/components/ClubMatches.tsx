'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Crown, Flame, Search, Shield, Swords, Trophy } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, EmptyState, ErrorState, Field, Input, Sheet, Skeleton, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { useDebounced } from '@/shared/lib/search'
import { formatNumber } from '@/shared/lib/format'
import { ClubAvatar, searchClubs } from '@/features/club'
import { createDuel, cupErrorMessage, getClubMatchSummary, getDuelLadder, myClubMatches, type Cup, type MatchTerms } from '../api/cupApi'
import { defaultTerms, rulesSummary, signupState, validateTerms } from '../model/match'
import { fmtTime } from './CupCard'
import { MatchCard } from './MatchParts'
import { RulesForm } from './RulesForm'

/** Tab "Đấu CLB" của một CLB: điểm uy tín, danh hiệu, trận đang diễn ra / chờ, lịch sử, bảng uy tín */
export function ClubMatchesTab({ clubId }: { clubId: string }) {
  const q = useQuery({ queryKey: ['club-matches', clubId], queryFn: () => getClubMatchSummary(clubId), refetchInterval: 60_000 })
  const [open, setOpen] = useState(false)
  const [ladder, setLadder] = useState(false)
  const [now] = useState(() => Date.now())
  if (q.isPending) return <Skeleton className="h-64" />
  if (q.isError) return <ErrorState message={cupErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
  const s = q.data
  const r = s.rating
  const isStaff = s.can_challenge
  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-bold"><Shield className="size-4 text-brand" aria-hidden />Điểm uy tín đấu CLB</p>
          <button type="button" onClick={() => setLadder(true)} className="text-xs font-semibold text-brand">Bảng uy tín</button>
        </div>
        <div className="grid grid-cols-4 gap-2 text-center">
          <Stat label="Điểm" value={formatNumber(r?.rating ?? 1000)} strong />
          <Stat label="Thắng" value={String(r?.wins ?? 0)} />
          <Stat label="Hòa" value={String(r?.draws ?? 0)} />
          <Stat label="Thua" value={String(r?.losses ?? 0)} />
        </div>
        {!!r?.streak && r.streak > 1 && <p className="flex items-center justify-center gap-1 text-sm font-semibold text-live"><Flame className="size-4" aria-hidden />Chuỗi {r.streak} trận thắng</p>}
        {s.champion && (
          <Link href={`/cups/${s.champion.cup_id}`} className="flex items-center gap-2 rounded-xl bg-medal-gold/10 px-3 py-2 text-sm">
            <Crown className="size-5 shrink-0 text-medal-gold" aria-hidden />
            <span className="min-w-0 flex-1"><b>Nhà vô địch</b> · {s.champion.title}</span>
          </Link>
        )}
        <p className="text-[11px] text-fg-muted">Bắt đầu 1.000 điểm. Thắng đội mạnh hơn được nhiều điểm hơn (Elo), thua đội yếu hơn mất nhiều hơn.</p>
      </Card>

      {isStaff && <Button block size="lg" onClick={() => setOpen(true)}><Swords className="size-5" aria-hidden />Thách đấu CLB khác</Button>}

      <section className="space-y-2">
        <h2 className="text-sm font-bold">Đang diễn ra & sắp tới</h2>
        {!s.active.length ? (
          <EmptyState icon={Swords} title="Chưa có trận nào"
            description={isStaff ? 'Gửi lời thách đấu tới CLB bạn bè — đặt luật, mời thành viên đăng ký và cùng chạy!' : 'Khi CLB có trận, bạn sẽ nhận thông báo để đăng ký thi đấu.'} />
        ) : <ul className="space-y-2">{s.active.map((c) => <li key={c.id}><MatchCard c={c} now={now} clubId={clubId} /></li>)}</ul>}
      </section>
      {!!s.recent.length && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold">Đã đấu</h2>
          <ul className="space-y-2">{s.recent.map((c) => <li key={c.id}><RecentRow c={c} clubId={clubId} /></li>)}</ul>
        </section>
      )}
      <NewDuelSheet open={open} onClose={() => setOpen(false)} clubId={clubId} />
      {ladder && <LadderSheet onClose={() => setLadder(false)} />}
    </div>
  )
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div className="rounded-xl bg-surface-2 py-2"><p className={cn('font-mono font-black tabular', strong ? 'text-xl text-brand' : 'text-lg')}>{value}</p><p className="text-[11px] text-fg-muted">{label}</p></div>
}

function RecentRow({ c, clubId }: { c: Cup; clubId: string }) {
  const other = c.kind === 'DUEL' ? (c.host?.id === clubId ? c.opponent : c.host) : null
  const res = c.status !== 'FINISHED' ? { text: { DECLINED: 'Từ chối', EXPIRED: 'Hết hạn', CANCELLED: 'Đã hủy' }[c.status as string] ?? '', tone: 'text-fg-muted' }
    : c.winner_id === clubId ? { text: 'Thắng', tone: 'text-success' } : c.winner_id ? { text: 'Thua', tone: 'text-danger' } : { text: 'Hòa', tone: 'text-fg-muted' }
  return (
    <Link href={`/cups/${c.id}`} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 hover:border-fg-subtle">
      {other ? <ClubAvatar club={other} size="sm" /> : <Trophy className="size-5 text-fg-subtle" aria-hidden />}
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{other ? `vs ${other.name}` : c.title}</span>
        <span className="block text-[11px] text-fg-muted">{fmtTime(c.start_at)}</span></span>
      <span className={cn('text-sm font-bold', res.tone)}>{res.text}</span>
    </Link>
  )
}

/** Gửi lời thách đấu: chọn đối thủ → đặt luật → lời nhắn */
function NewDuelSheet({ open, onClose, clubId }: { open: boolean; onClose: () => void; clubId: string }) {
  const router = useRouter()
  const qc = useQueryClient()
  const [now] = useState(() => Date.now())
  const [term, setTerm] = useState('')
  const [opponent, setOpponent] = useState<{ id: string; name: string; avatar_url: string | null; accent_color?: string | null } | null>(null)
  const [terms, setTerms] = useState<MatchTerms>(() => defaultTerms(now))
  const [message, setMessage] = useState('')
  const debounced = useDebounced(term.trim())
  const found = useQuery({ queryKey: ['club-search', debounced], queryFn: () => searchClubs(debounced, 10), enabled: open && !opponent, placeholderData: keepPreviousData })
  const err = validateTerms(terms, now, 'DUEL')
  const create = useMutation({
    mutationFn: () => createDuel(clubId, opponent!.id, terms, message.trim() || undefined),
    onSuccess: (c) => {
      toast.success('Đã gửi lời thách đấu — chờ đối thủ trả lời')
      void qc.invalidateQueries({ queryKey: ['club-matches', clubId] })
      onClose(); router.push(`/cups/${c.id}`)
    },
    onError: (e) => toast.error(cupErrorMessage(e)),
  })
  return (
    <Sheet open={open} onClose={onClose} title="Thách đấu CLB khác" description="Đối thủ có thể nhận lời, từ chối hoặc đề xuất lại luật. Nhận lời xong, thành viên hai CLB được mời đăng ký thi đấu."
      footer={<div className="space-y-2">{opponent && err && <p className="text-xs text-danger">{err}</p>}
        <Button block onClick={() => create.mutate()} loading={create.isPending} disabled={!opponent || !!err}><Swords className="size-4" aria-hidden />Gửi lời thách đấu</Button></div>}>
      <div className="space-y-4">
        {opponent ? (
          <div className="flex items-center gap-3 rounded-xl border border-brand/50 bg-brand/10 p-3">
            <ClubAvatar club={opponent} size="sm" />
            <span className="flex-1 font-semibold">{opponent.name}</span>
            <Button size="sm" variant="ghost" onClick={() => setOpponent(null)}>Đổi</Button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
              <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Tìm CLB đối thủ" className="pl-9" aria-label="Tìm CLB đối thủ" />
            </div>
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {(found.data ?? []).filter((c) => c.id !== clubId).map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => setOpponent(c)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-2">
                    <ClubAvatar club={c} size="sm" />
                    <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{c.name}</span>
                      <span className="text-xs text-fg-subtle">{formatNumber(c.member_count)} thành viên</span></span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {opponent && (
          <>
            <RulesForm value={terms} onChange={setTerms} kind="DUEL" />
            <Card className="space-y-1 bg-surface-2 p-3 text-xs">
              <p className="font-semibold">Tóm tắt luật</p>
              {rulesSummary({ ...terms, kind: 'DUEL', rules_version: 2, final_delay_hours: 48 }).map((r) => <p key={r}>• {r}</p>)}
            </Card>
            <Field label="Lời nhắn (không bắt buộc)" htmlFor="duel-msg">
              <Textarea id="duel-msg" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={200} placeholder="VD: Thua mời cà phê nhé!" />
            </Field>
          </>
        )}
      </div>
    </Sheet>
  )
}

function LadderSheet({ onClose }: { onClose: () => void }) {
  const q = useQuery({ queryKey: ['duel-ladder'], queryFn: getDuelLadder })
  return (
    <Sheet open onClose={onClose} title="Bảng uy tín đấu CLB" description="Xếp theo điểm uy tín (Elo) từ các trận 1–1 có luật mới.">
      {q.isPending ? <Skeleton className="h-40" /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data.length ? (
        <p className="py-6 text-center text-sm text-fg-muted">Chưa có trận nào kết thúc.</p>
      ) : (
        <ol className="space-y-1.5">
          {q.data.map((r) => (
            <li key={r.club_id} className={cn('flex items-center gap-3 rounded-xl border px-3 py-2', r.is_mine ? 'border-brand/50 bg-brand/10' : 'border-border')}>
              <span className="w-6 text-center font-mono text-sm font-bold text-fg-muted">{r.rank}</span>
              <ClubAvatar club={r} size="sm" />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{r.name}</span>
                <span className="text-[11px] text-fg-muted">{r.wins}T · {r.draws}H · {r.losses}B</span></span>
              <span className="font-mono font-black tabular">{formatNumber(r.rating)}</span>
            </li>
          ))}
        </ol>
      )}
    </Sheet>
  )
}

/** Trang chủ: các trận của CLB tôi — việc cần làm trước (trả lời lời mời, đăng ký), rồi trận đang đấu */
export function MyMatchesCard() {
  const q = useQuery({ queryKey: ['my-club-matches'], queryFn: myClubMatches, staleTime: 60_000, refetchInterval: 120_000 })
  const [now] = useState(() => Date.now())
  const list = q.data ?? []
  if (!list.length) return null
  const rank = (c: Cup) => (c.can_respond ? 0 : signupState(c, now).kind === 'CAN_SIGN' ? 1 : c.phase === 'LIVE' ? 2 : 3)
  const sorted = [...list].sort((a, b) => rank(a) - rank(b))
  return (
    <section className="space-y-2" aria-label="Đấu CLB">
      <h2 className="flex items-center gap-2 text-base font-bold"><Swords className="size-5 text-live" aria-hidden />Đấu CLB của bạn</h2>
      <ul className="space-y-2">{sorted.slice(0, 3).map((c) => <li key={c.id}><MatchCard c={c} now={now} /></li>)}</ul>
    </section>
  )
}

/** Dải nhắc ở đầu trang CLB: trận cần đăng ký / đang đấu / lời mời chờ trả lời */
export function ClubMatchBanner({ clubId }: { clubId: string }) {
  const q = useQuery({ queryKey: ['club-matches', clubId], queryFn: () => getClubMatchSummary(clubId), staleTime: 60_000 })
  const [now] = useState(() => Date.now())
  const items = (q.data?.active ?? []).filter((c) => c.can_respond || signupState(c, now).kind === 'CAN_SIGN' || c.phase === 'LIVE')
  const champ = q.data?.champion
  if (!items.length && !champ) return null
  return (
    <div className="mb-4 space-y-2">
      {champ && (
        <Link href={`/cups/${champ.cup_id}`} className="flex items-center gap-2 rounded-xl border border-medal-gold/40 bg-medal-gold/10 px-3 py-2 text-sm">
          <Crown className="size-5 shrink-0 text-medal-gold" aria-hidden /><span className="min-w-0 flex-1 truncate"><b>Nhà vô địch</b> · {champ.title}</span>
        </Link>
      )}
      {items.map((c) => {
        const st = signupState(c, now)
        const other = c.kind === 'DUEL' ? (c.host?.id === clubId ? c.opponent : c.host) : null
        const text = c.can_respond ? `Lời thách đấu từ ${other?.name ?? 'CLB khác'} — trả lời ngay`
          : st.kind === 'CAN_SIGN' ? `${other ? `Đấu với ${other.name}` : c.title}: bấm để đăng ký thi đấu`
          : `${other ? `Đang đấu với ${other.name}` : c.title} — xem bảng điểm`
        return (
          <Link key={c.id} href={`/cups/${c.id}`}
            className={cn('flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold',
              st.kind === 'CAN_SIGN' || c.can_respond ? 'bg-brand text-brand-fg' : 'border border-live/40 bg-live/10')}>
            <Swords className="size-5 shrink-0" aria-hidden /><span className="min-w-0 flex-1">{text}</span>
          </Link>
        )
      })}
    </div>
  )
}
