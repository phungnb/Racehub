'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Flag, Lock, Scale, Shuffle, Trophy } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Card, Input, SectionTitle, Sheet, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatNumber } from '@/shared/lib/format'
import {
  assignPledgeTeams, challengeErrorMessage, getPledgeBoard, movePledgeMember, setMyPledge,
  type ChallengeDetail, type PledgeBoard, type PledgeMember,
} from '../../api/challengeApi'
import { challengeKeys } from '../../hooks/useChallenge'

const km = (v: number | null | undefined) => `${formatNumber(Math.round(Number(v ?? 0) * 10) / 10)} km`

/** Thử thách có mục tiêu tự đăng ký: chọn mục tiêu của tôi + bảng theo % mục tiêu (+ chia đội cho ban quản trị) */
export function PledgePanel({ d }: { d: ChallengeDetail }) {
  const c = d.challenge
  const q = useQuery({ queryKey: challengeKeys.pledge(c.id), queryFn: () => getPledgeBoard(c.id) })
  const [now] = useState(() => Date.now())
  const started = now >= Date.parse(c.start_date)
  const team = c.format === 'TEAM'
  const locked = team ? started || !!c.teams_assigned_at : started && d.me?.pledge_km != null

  return (
    <div className="space-y-4">
      {d.me && d.me.status !== 'LEFT' && <MyPledge d={d} locked={locked} />}
      {q.isPending ? <Skeleton className="h-48" /> : q.data ? (
        <>
          {team && q.data.teams && <TeamPledges board={q.data} capPct={c.pledge_cap_pct ?? null} />}
          {team && q.data.can_manage && !started && <TeamTools id={c.id} board={q.data} />}
          <PledgeRanking board={q.data} team={team} teamsById={Object.fromEntries((q.data.teams ?? []).map((t) => [t.team_id, t]))} />
        </>
      ) : null}
    </div>
  )
}

function MyPledge({ d, locked }: { d: ChallengeDetail; locked: boolean }) {
  const c = d.challenge
  const qc = useQueryClient()
  const current = d.me?.pledge_km != null ? Number(d.me.pledge_km) : null
  const [custom, setCustom] = useState('')
  const save = useMutation({
    mutationFn: (v: number) => setMyPledge(c.id, v),
    onSuccess: () => { toast.success('Đã lưu mục tiêu của bạn'); void qc.invalidateQueries({ queryKey: ['challenge', c.id] }) },
    onError: (e) => toast.error(challengeErrorMessage(e)),
  })
  const options = (c.pledge_options ?? []).map(Number)
  const done = Number(d.me?.current_progress ?? 0)
  const cap = c.pledge_cap_pct != null ? Number(c.pledge_cap_pct) : null

  if (current !== null && locked) {
    const pct = current > 0 ? Math.min(done / current, 2) : 0
    return (
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 font-semibold"><Flag className="size-4 text-brand" aria-hidden />Mục tiêu của bạn</p>
          <span className="flex items-center gap-1 text-xs text-fg-subtle"><Lock className="size-3.5" aria-hidden />Đã khóa</span>
        </div>
        <p className="font-mono text-3xl font-bold">{formatNumber(done)}<span className="text-base text-fg-muted"> / {km(current)}</span></p>
        <div className="h-3 overflow-hidden rounded-full bg-surface-2">
          <div className={cn('h-full rounded-full', done >= current ? 'bg-coin' : 'bg-brand')} style={{ width: `${Math.min(pct, 1) * 100}%` }} />
        </div>
        <p className="text-sm text-fg-muted">
          {done >= current ? <span className="font-semibold text-coin">Đã đạt mục tiêu! </span> : `Còn ${km(current - done)}. `}
          {cap !== null && `Được tính tối đa ${km(current * (1 + cap / 100))} (+${cap}%).`}
        </p>
      </Card>
    )
  }

  return (
    <Card className="space-y-3 border-brand/40">
      <p className="flex items-center gap-2 font-semibold"><Flag className="size-4 text-brand" aria-hidden />{current === null ? 'Đăng ký mục tiêu của bạn' : 'Đổi mục tiêu'}</p>
      <p className="text-xs text-fg-muted">
        {c.format === 'TEAM' ? 'Mục tiêu khóa khi ban quản trị chia đội hoặc khi xuất phát. Hãy chọn đúng sức mình — chạy vượt chỉ được tính thêm tối đa ' + (cap ?? 0) + '%.'
          : 'Hoàn thành mốc bạn chọn là chiến thắng. Chọn trước giờ bắt đầu thì đổi được.'}
      </p>
      {options.length ? (
        <div className="grid grid-cols-4 gap-2">
          {options.map((o) => (
            <button key={o} type="button" disabled={save.isPending} onClick={() => save.mutate(o)} aria-pressed={current === o}
              className={cn('min-h-12 rounded-xl border font-mono font-bold', current === o ? 'border-brand bg-brand text-brand-fg' : 'border-border hover:border-fg-subtle')}>
              {o}<span className="block text-[10px] font-medium opacity-70">km</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex gap-2">
          <Input inputMode="decimal" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Mục tiêu (km)"
            placeholder={`${c.pledge_min_km ?? 10}–${c.pledge_max_km ?? 300} km${current !== null ? ` (hiện ${current})` : ''}`} />
          <Button className="shrink-0" loading={save.isPending} disabled={!(Number(custom.replace(',', '.')) > 0)}
            onClick={() => save.mutate(Number(custom.replace(',', '.')))}>Lưu</Button>
        </div>
      )}
    </Card>
  )
}

function TeamPledges({ board, capPct }: { board: PledgeBoard; capPct: number | null }) {
  const teams = board.teams ?? []
  const max = Math.max(...teams.map((t) => t.pledge_total), 1)
  const spread = teams.length ? Math.max(...teams.map((t) => t.pledge_total)) - Math.min(...teams.map((t) => t.pledge_total)) : 0
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 font-semibold"><Scale className="size-4 text-xp" aria-hidden />Cân bằng mục tiêu các đội</p>
        {teams.length > 1 && <span className={cn('text-xs font-semibold', spread <= 10 ? 'text-brand' : 'text-warning')}>lệch {km(spread)}</span>}
      </div>
      <ul className="space-y-2.5">
        {teams.map((t) => (
          <li key={t.team_id} className="space-y-1">
            <div className="flex items-center gap-2 text-sm">
              <span className="size-3 rounded-full" style={{ background: t.color }} aria-hidden />
              <span className="flex-1 font-semibold">{t.name} <span className="font-normal text-fg-subtle">· {t.members} người</span></span>
              <span className="font-mono text-xs text-fg-muted">{km(t.counted_total)} / {km(t.pledge_total)}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full opacity-40" style={{ width: `${(t.pledge_total / max) * 100}%`, background: t.color }}>
                <div className="h-full rounded-full" style={{ width: `${t.pledge_total ? Math.min(t.counted_total / t.pledge_total, 1) * 100 : 0}%`, background: t.color }} />
              </div>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-xs text-fg-subtle">Điểm đội = tổng km được tính{capPct !== null ? ` (mỗi người tối đa mục tiêu +${capPct}%)` : ''}.</p>
    </Card>
  )
}

/** Ban quản trị: chia đội tự động (cân bằng / ngẫu nhiên có cân bằng) hoặc xếp tay từng người */
function TeamTools({ id, board }: { id: string; board: PledgeBoard }) {
  const qc = useQueryClient()
  const [moving, setMoving] = useState<PledgeMember | null>(null)
  const done = (b: PledgeBoard) => { qc.setQueryData(challengeKeys.pledge(id), b); void qc.invalidateQueries({ queryKey: ['challenge', id] }) }
  const assign = useMutation({
    mutationFn: (v: { method: 'BALANCE' | 'RANDOM'; includeMissing?: boolean }) => assignPledgeTeams(id, v.method, v.includeMissing),
    onSuccess: (b) => { done(b); toast.success('Đã chia đội và báo cho mọi người') },
    onError: (e) => toast.error(challengeErrorMessage(e)),
  })
  const move = useMutation({
    mutationFn: (v: { pid: string; team: string }) => movePledgeMember(id, v.pid, v.team),
    onSuccess: (b) => { done(b); setMoving(null) },
    onError: (e) => toast.error(challengeErrorMessage(e)),
  })
  return (
    <Card className="space-y-3 border-xp/40">
      <p className="font-semibold">Chia đội (ban quản trị)</p>
      {board.missing > 0 && (
        <p className="flex items-start gap-2 rounded-xl bg-warning/10 p-2.5 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />{board.missing} người chưa đăng ký mục tiêu. Nhắc họ trước khi chia, hoặc chia luôn (tính 0 km).
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" loading={assign.isPending && assign.variables?.method === 'BALANCE'}
          onClick={() => assign.mutate({ method: 'BALANCE', includeMissing: board.missing > 0 })}><Scale className="size-4" aria-hidden />Cân bằng</Button>
        <Button variant="secondary" loading={assign.isPending && assign.variables?.method === 'RANDOM'}
          onClick={() => assign.mutate({ method: 'RANDOM', includeMissing: board.missing > 0 })}><Shuffle className="size-4" aria-hidden />Ngẫu nhiên</Button>
      </div>
      <p className="text-xs text-fg-subtle">Cả hai cách đều giữ tổng km đăng ký các đội gần bằng nhau và số người chênh tối đa 1. Bấm tên một người trong bảng dưới để xếp tay.</p>
      <MoveSheet member={moving} board={board} onClose={() => setMoving(null)} loading={move.isPending}
        onPick={(team) => moving && move.mutate({ pid: moving.participant_id, team })} />
      <ManagerList board={board} onPick={setMoving} />
    </Card>
  )
}

function ManagerList({ board, onPick }: { board: PledgeBoard; onPick: (m: PledgeMember) => void }) {
  const teams = Object.fromEntries((board.teams ?? []).map((t) => [t.team_id, t]))
  return (
    <ul className="divide-y divide-border rounded-xl border border-border">
      {board.members.map((m) => (
        <li key={m.participant_id}>
          <button type="button" onClick={() => onPick(m)} className="flex min-h-11 w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: m.team_id ? teams[m.team_id]?.color : 'transparent' }} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{m.display_name ?? 'Runner'}</span>
            <span className={cn('font-mono text-xs', m.pledge_km ? 'text-fg-muted' : 'text-warning')}>{m.pledge_km ? km(m.pledge_km) : 'chưa đăng ký'}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function MoveSheet({ member, board, onClose, onPick, loading }: {
  member: PledgeMember | null; board: PledgeBoard; onClose: () => void; onPick: (team: string) => void; loading: boolean
}) {
  return (
    <Sheet open={!!member} onClose={onClose} title={`Xếp ${member?.display_name ?? 'thành viên'} vào đội`}
      description={member?.pledge_km ? `Mục tiêu ${km(member.pledge_km)}` : 'Chưa đăng ký mục tiêu'}>
      <div className="space-y-2">
        {(board.teams ?? []).map((t) => (
          <button key={t.team_id} type="button" disabled={loading || member?.team_id === t.team_id} onClick={() => onPick(t.team_id)}
            className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-border px-3 text-left disabled:opacity-50">
            <span className="size-3.5 rounded-full" style={{ background: t.color }} aria-hidden />
            <span className="flex-1 font-semibold">{t.name}</span>
            <span className="font-mono text-xs text-fg-muted">{t.members} người · {km(t.pledge_total)}</span>
            {member?.team_id === t.team_id && <Check className="size-4 text-brand" aria-hidden />}
          </button>
        ))}
      </div>
    </Sheet>
  )
}

/** Bảng xếp hạng theo % mục tiêu tự đăng ký */
function PledgeRanking({ board, team, teamsById }: { board: PledgeBoard; team: boolean; teamsById: Record<string, { color: string; name: string }> }) {
  if (!board.members.length) return <p className="py-6 text-center text-sm text-fg-muted">Chưa có ai tham gia.</p>
  return (
    <section>
      <SectionTitle>Theo % mục tiêu</SectionTitle>
      <ol className="divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
        {board.members.map((m, i) => (
          <li key={m.participant_id} className="flex items-center gap-3 px-3 py-2.5">
            <span className="w-6 text-center font-mono text-sm text-fg-subtle">{i + 1}</span>
            <Avatar src={m.avatar_url} name={m.display_name ?? 'Runner'} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 truncate text-sm font-semibold">
                {team && m.team_id && <span className="size-2 shrink-0 rounded-full" style={{ background: teamsById[m.team_id]?.color }} aria-hidden />}
                {m.display_name ?? 'Runner'}
                {m.completed && <Trophy className="size-3.5 shrink-0 text-coin" aria-label="Đã đạt mục tiêu" />}
              </span>
              <span className="block h-1.5 overflow-hidden rounded-full bg-surface-2">
                <span className={cn('block h-full rounded-full', m.completed ? 'bg-coin' : 'bg-brand')} style={{ width: `${Math.min(m.pct ?? 0, 100)}%` }} />
              </span>
              <span className="block text-xs text-fg-subtle">
                {m.pledge_km ? `${km(m.counted_km)} / ${km(m.pledge_km)}` : 'Chưa đăng ký mục tiêu'}
                {m.km > m.counted_km ? ` · chạy ${km(m.km)}` : ''}
              </span>
            </span>
            <span className={cn('shrink-0 font-mono text-sm font-bold', m.completed ? 'text-coin' : 'text-fg')}>{m.pct != null ? `${Math.round(m.pct)}%` : '—'}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
