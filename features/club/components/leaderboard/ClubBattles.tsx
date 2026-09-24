'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Crown, Search, Swords, X } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Card, EmptyState, ErrorState, Field, Input, Sheet, Skeleton, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatNumber } from '@/shared/lib/format'
import {
  cancelClubBattle, createClubBattle, listClubBattles, respondClubBattle, settleDueBattles,
  type BattleMetric, type BattleSide, type ClubBattle,
} from '../../api/battleApi'
import { clubErrorMessage, searchClubs } from '../../api/clubApi'
import { accentOf } from '../../model/roles'
import { ClubAvatar } from '../hub/ClubAvatar'

const METRIC: Record<BattleMetric, { label: string; hint: string }> = {
  AVG_KM: { label: 'Km trung bình / thành viên', hint: 'Công bằng khi hai CLB chênh quân số' },
  TOTAL_KM: { label: 'Tổng km cả CLB', hint: 'CLB đông người có lợi thế' },
}
const STATUS: Record<ClubBattle['status'], { label: string; tone: string }> = {
  PENDING: { label: 'Chờ trả lời', tone: 'bg-warning/15 text-warning' },
  ACCEPTED: { label: 'Đang đấu', tone: 'bg-live/15 text-live' },
  DECLINED: { label: 'Bị từ chối', tone: 'bg-surface-2 text-fg-muted' },
  CANCELLED: { label: 'Đã hủy', tone: 'bg-surface-2 text-fg-muted' },
  FINISHED: { label: 'Đã kết thúc', tone: 'bg-surface-2 text-fg-muted' },
}
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })

export function ClubBattles({ clubId, isStaff }: { clubId: string; isStaff: boolean }) {
  const qc = useQueryClient()
  const key = ['club', clubId, 'battles']
  const q = useQuery({ queryKey: key, queryFn: () => listClubBattles(clubId), refetchInterval: 60_000 })
  const [open, setOpen] = useState(false)
  const [now] = useState(() => Date.now())
  const refresh = () => void qc.invalidateQueries({ queryKey: key })
  // Trận đã hết giờ mà chưa tất toán → tất toán ngay (idempotent) rồi tải lại
  const due = q.data?.some((b) => b.status === 'ACCEPTED' && Date.parse(b.end_at) < now - 2 * 3600_000)
  useEffect(() => { if (due) void settleDueBattles().then(refresh) }, [due]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3">
      {isStaff && (
        <Button block onClick={() => setOpen(true)}><Swords className="size-4" aria-hidden />Thách đấu CLB khác</Button>
      )}
      {q.isPending ? <Skeleton className="h-44" /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : !q.data.length ? (
        <EmptyState icon={Swords} title="Chưa có trận đấu nào"
          description={isStaff ? 'Gửi lời thách đấu tới CLB bạn bè — mọi km hợp lệ của thành viên đều tính cho CLB.' : 'Ban quản trị CLB có thể thách đấu CLB khác.'} />
      ) : (
        <ul className="space-y-3">{q.data.map((b) => <li key={b.id}><BattleCard b={b} clubId={clubId} now={now} onChange={refresh} /></li>)}</ul>
      )}
      <NewBattleSheet open={open} onClose={() => setOpen(false)} clubId={clubId} onCreated={() => { setOpen(false); refresh() }} />
    </div>
  )
}

function BattleCard({ b, clubId, now, onChange }: { b: ClubBattle; clubId: string; now: number; onChange: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const act = useMutation({
    mutationFn: (a: 'accept' | 'decline' | 'cancel') => a === 'cancel' ? cancelClubBattle(b.id) : respondClubBattle(b.id, a === 'accept'),
    onSuccess: (_, a) => { toast.success(a === 'accept' ? 'Đã nhận lời — chạy thôi!' : a === 'decline' ? 'Đã từ chối' : 'Đã hủy trận'); onChange() },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  const k = b.score_key
  const a = b.challenger, o = b.opponent
  const total = Number(a[k]) + Number(o[k])
  const share = total > 0 ? Number(a[k]) / total : 0.5
  const live = b.status === 'ACCEPTED' && now >= Date.parse(b.start_at)
  const mine = b.challenger.club_id === clubId ? 'challenger' : 'opponent'
  const result = b.status === 'FINISHED'
    ? (b.winner_id === null ? 'Hòa' : b.winner_id === clubId ? 'CLB thắng 🏆' : 'CLB thua')
    : null
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className={cn('shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 font-semibold', STATUS[b.status].tone)}>{result ?? STATUS[b.status].label}</span>
        <span className="text-right text-fg-muted">{fmtDay(b.start_at)} → {fmtDay(b.end_at)} · {METRIC[b.metric].label}</span>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <SideHead s={a} lead={b.leader_id === a.club_id && (live || b.status === 'FINISHED')} score={Number(a[k])} unit={k} mine={mine === 'challenger'} />
        <span className="text-xs font-bold text-fg-subtle">VS</span>
        <SideHead s={o} lead={b.leader_id === o.club_id && (live || b.status === 'FINISHED')} score={Number(o[k])} unit={k} mine={mine === 'opponent'} right />
      </div>
      {(live || b.status === 'FINISHED') && (
        <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div style={{ width: `${share * 100}%`, background: accentOf(a) }} />
          <div className="flex-1" style={{ background: accentOf(o) }} />
        </div>
      )}
      {b.message && <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm italic text-fg-muted">“{b.message}”</p>}
      {b.can_respond && (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => act.mutate('decline')} disabled={act.isPending}><X className="size-4" aria-hidden />Từ chối</Button>
          <Button onClick={() => act.mutate('accept')} loading={act.isPending && act.variables === 'accept'}><Check className="size-4" aria-hidden />Nhận lời</Button>
        </div>
      )}
      {(live || b.status === 'FINISHED') && (
        <button type="button" onClick={() => setExpanded((x) => !x)} className="w-full text-center text-xs font-semibold text-brand">
          {expanded ? 'Thu gọn' : 'Xem người chạy nhiều nhất mỗi bên'}
        </button>
      )}
      {expanded && (
        <div className="grid grid-cols-2 gap-3">
          {[a, o].map((s) => (
            <ol key={s.club_id} className="space-y-1.5">
              {s.top.length === 0 ? <li className="text-xs text-fg-subtle">Chưa có bài chạy</li> : s.top.map((r, i) => (
                <li key={r.user_id} className="flex items-center gap-1.5 text-xs">
                  <span className="w-3 text-fg-subtle">{i + 1}</span>
                  <Avatar src={r.avatar_url} name={r.display_name} size="xs" />
                  <span className="min-w-0 flex-1 truncate">{r.display_name}</span>
                  <span className="font-mono font-semibold">{formatNumber(r.km)}</span>
                </li>
              ))}
            </ol>
          ))}
        </div>
      )}
      {b.can_cancel && (
        <Button variant="ghost" size="sm" block onClick={() => act.mutate('cancel')} disabled={act.isPending}>Hủy trận</Button>
      )}
    </Card>
  )
}

function SideHead({ s, lead, score, unit, mine, right }: { s: BattleSide; lead: boolean; score: number; unit: 'km' | 'avg_km'; mine: boolean; right?: boolean }) {
  return (
    <div className={cn('flex min-w-0 flex-col items-center gap-1 text-center')}>
      <div className="relative">
        <ClubAvatar club={s} size="sm" />
        {lead && <Crown className={cn('absolute -top-3 size-4 text-medal-gold', right ? '-left-1' : '-right-1')} aria-label="Đang dẫn" />}
      </div>
      <p className={cn('w-full truncate text-sm font-semibold', mine && 'text-brand')}>{s.name}</p>
      <p className="font-mono text-lg font-bold tabular">{formatNumber(score)}<span className="ml-0.5 text-xs text-fg-muted">km</span></p>
      <p className="text-[11px] text-fg-subtle">{unit === 'avg_km' ? `TB · ${s.runners}/${s.members} người chạy` : `${s.runners}/${s.members} người chạy`}</p>
    </div>
  )
}

/** 00:00 giờ VN ngày mai */
function tomorrowVn() {
  const vn = new Date(Date.now() + 7 * 3600_000)
  return new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate() + 1) - 7 * 3600_000)
}

function NewBattleSheet({ open, onClose, clubId, onCreated }: { open: boolean; onClose: () => void; clubId: string; onCreated: () => void }) {
  const [term, setTerm] = useState('')
  const [opponent, setOpponent] = useState<{ id: string; name: string; avatar_url: string | null; accent_color?: string | null } | null>(null)
  const [metric, setMetric] = useState<BattleMetric>('AVG_KM')
  const [days, setDays] = useState(7)
  const [message, setMessage] = useState('')
  const found = useQuery({ queryKey: ['club-search', term], queryFn: () => searchClubs(term, 10), enabled: open && !opponent })
  const create = useMutation({
    mutationFn: () => {
      const start = tomorrowVn()
      return createClubBattle({ clubId, opponentId: opponent!.id, metric, start: start.toISOString(),
        end: new Date(start.getTime() + days * 86400_000).toISOString(), message: message.trim() || undefined })
    },
    onSuccess: () => { toast.success('Đã gửi lời thách đấu'); setOpponent(null); setMessage(''); onCreated() },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  const start = tomorrowVn()
  return (
    <Sheet open={open} onClose={onClose} title="Thách đấu CLB khác" description="Bắt đầu 00:00 ngày mai. Km hợp lệ của thành viên trong thời gian đấu tính cho CLB."
      footer={<Button block onClick={() => create.mutate()} loading={create.isPending} disabled={!opponent}><Swords className="size-4" aria-hidden />Gửi lời thách đấu</Button>}>
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
        <div role="radiogroup" aria-label="Cách tính" className="grid gap-2">
          {(Object.keys(METRIC) as BattleMetric[]).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={metric === m} onClick={() => setMetric(m)}
              className={cn('rounded-xl border p-3 text-left', metric === m ? 'border-brand/60 bg-brand/10' : 'border-border')}>
              <span className="block text-sm font-semibold">{METRIC[m].label}</span>
              <span className="block text-xs text-fg-muted">{METRIC[m].hint}</span>
            </button>
          ))}
        </div>
        <Field label="Thời gian đấu" hint={`${fmtDay(start.toISOString())} → ${fmtDay(new Date(start.getTime() + days * 86400_000 - 1).toISOString())}`}>
          <div className="grid grid-cols-3 gap-2">
            {[7, 14, 30].map((d) => (
              <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}
                className={cn('rounded-xl border py-2.5 text-sm font-semibold', days === d ? 'border-brand bg-brand text-brand-fg' : 'border-border')}>
                {d === 30 ? '1 tháng' : `${d / 7} tuần`}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Lời nhắn (không bắt buộc)" htmlFor="b-msg">
          <Textarea id="b-msg" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={200} placeholder="VD: Thua mời cà phê nhé!" />
        </Field>
      </div>
    </Sheet>
  )
}
