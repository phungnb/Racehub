'use client'

import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownRight, ArrowUpRight, CalendarDays, ChevronRight, Gift, Megaphone, Sparkles, Trophy, UserCheck, UserX, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Card, ErrorState, SectionTitle, Skeleton, SwitchRow } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatKm, formatNumber, formatRelative } from '@/shared/lib/format'
import { formatVnd } from '@/shared/lib/economy'
import { routes } from '@/shared/config/routes'
import { getClubDashboard, pointsErrorMessage, postRecapNow, setClubRecap, type RecapMeta } from '../../api/pointsApi'
import { useClub } from '../../hooks/useClub'

/**
 * Bảng điều khiển ban quản trị (009600): mọi việc cần làm trên một màn — đơn chờ duyệt, người lâu không chạy,
 * hoạt động tuần này so với tuần trước, quỹ, lịch, thử thách, quay thưởng, điểm CLB, tổng kết tự động.
 */
export function ClubDashboardScreen({ clubId }: { clubId: string }) {
  const { isStaff, isLoading } = useClub(clubId)
  const q = useQuery({ queryKey: ['club', clubId, 'dashboard'], queryFn: () => getClubDashboard(clubId), enabled: isStaff })
  if (isLoading) return <Skeleton className="h-96" />
  if (!isStaff) return <ErrorState message="Chỉ chủ nhiệm và quản trị viên CLB xem được bảng điều khiển." />
  if (q.isPending) return <Skeleton className="h-96" />
  if (q.isError) return <ErrorState message={pointsErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
  const d = q.data
  const base = routes.club(clubId)
  return (
    <div className="space-y-5">
      <Todo d={d} base={base} />

      <section className="space-y-2">
        <SectionTitle>Tuần này so với tuần trước</SectionTitle>
        <div className="grid grid-cols-3 gap-2">
          <Kpi label="Km cả CLB" now={d.this_week.distance_m / 1000} prev={d.last_week.distance_m / 1000} fmt={(v) => formatKm(v * 1000)} />
          <Kpi label="Người chạy" now={d.this_week.active_members} prev={d.last_week.active_members} />
          <Kpi label="Buổi chạy" now={d.this_week.run_count} prev={d.last_week.run_count} />
        </div>
        <p className="text-xs text-fg-muted">{formatNumber(d.members)} thành viên · {formatNumber(d.new_30d)} người mới 30 ngày qua · {formatNumber(d.this_week.checkins ?? 0)} lượt điểm danh tuần này</p>
      </section>

      {d.points.has_rules && !!d.points.top.length && (
        <Card className="space-y-2">
          <p className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-coin" aria-hidden />Top điểm CLB tuần này</p>
          <ol className="space-y-1 text-sm">
            {d.points.top.map((t, i) => <li key={t.user_id} className="flex gap-2"><span className="w-4 font-mono text-fg-muted">{i + 1}</span><span className="flex-1 truncate">{t.name}</span><b className="font-mono">{formatNumber(Math.round(t.points))}</b></li>)}
          </ol>
          <Link href={`${base}/leaderboard?tab=points`} className="text-xs font-semibold text-brand">Xem BXH điểm · sửa luật</Link>
        </Card>
      )}
      {!d.points.has_rules && (
        <LinkCard href={`${base}/leaderboard?tab=points`} icon={Sparkles} title="Đặt luật tính điểm CLB" text="Thưởng sự đều đặn, chạy sáng sớm, đi chạy nhóm… hệ thống tự chấm cho mọi bài chạy." />
      )}

      <section className="space-y-2">
        <SectionTitle>Thành viên lâu không chạy ({d.inactive.length})</SectionTitle>
        {!d.inactive.length ? <p className="text-sm text-fg-muted">Ai cũng có bài chạy trong 30 ngày qua.</p> : (
          <Card className="divide-y divide-border p-0">
            {d.inactive.slice(0, 8).map((m) => (
              <div key={m.user_id} className="flex items-center gap-3 px-3 py-2">
                <Avatar src={m.avatar_url} name={m.name} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
                <span className="shrink-0 text-xs text-fg-muted">{m.last_run_at ? `chạy ${formatRelative(m.last_run_at)}` : 'chưa có bài'}</span>
              </div>
            ))}
            {d.inactive.length > 8 && <p className="px-3 py-2 text-xs text-fg-muted">và {d.inactive.length - 8} người khác</p>}
          </Card>
        )}
        <p className="text-xs text-fg-subtle">Nhắn hỏi thăm hoặc rủ đi buổi chạy nhóm sắp tới — người quay lại sớm dễ gắn bó lâu.</p>
      </section>

      <div className="grid gap-2 sm:grid-cols-2">
        <LinkCard href={`${base}/treasury`} icon={Wallet} title={`Quỹ: ${formatVnd(d.finance.balance)}`}
          text={d.finance.claims ? `${d.finance.claims} khoản báo đã chuyển, chờ xác nhận` : `${d.finance.open_dues} kỳ thu phí đang mở`} alert={d.finance.claims > 0} />
        <LinkCard href={`${base}/events`} icon={CalendarDays} title={`${d.events.length} buổi trong 14 ngày tới`}
          text={d.events[0] ? `${d.events[0].title} · ${new Date(d.events[0].starts_at).toLocaleString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${d.events[0].going} người đi` : 'Chưa có buổi chạy nhóm — tạo lịch để thành viên đăng ký'} />
        <LinkCard href={`${base}/challenges`} icon={Trophy} title={`${d.challenges.length} thử thách đang chạy`}
          text={d.challenges.map((c) => `${c.title} (${c.participants})`).join(' · ') || 'Tạo thử thách tuần / tháng cho CLB'} />
        <LinkCard href={`${base}/hall`} icon={Gift} title="Quay thưởng" text={d.draws.live ? `${d.draws.live} lượt đang quay` : d.draws.ready ? `${d.draws.ready} lượt chờ quay` : 'Quay thưởng cho người có mặt tại buổi, danh sách dán sẵn…'} alert={d.draws.live > 0} />
      </div>

      <RecapSettings clubId={clubId} weekly={d.recap.weekly} monthly={d.recap.monthly} lastWeek={d.last_week} />
    </div>
  )
}

function Todo({ d, base }: { d: Awaited<ReturnType<typeof getClubDashboard>>; base: string }) {
  const items = [
    d.pending.length ? { href: `${base}/members`, icon: UserCheck, text: `${d.pending.length} đơn xin vào CLB chờ duyệt`, sub: d.pending.slice(0, 3).map((p) => p.name).join(', ') } : null,
    d.finance.claims ? { href: `${base}/treasury`, icon: Wallet, text: `${d.finance.claims} khoản đóng quỹ chờ xác nhận`, sub: 'Kiểm tra tài khoản rồi bấm xác nhận' } : null,
    d.inactive.length >= 5 ? { href: `${base}/members`, icon: UserX, text: `${d.inactive.length} thành viên 30 ngày chưa chạy`, sub: 'Xem danh sách bên dưới' } : null,
  ].filter(Boolean) as { href: string; icon: typeof UserCheck; text: string; sub: string }[]
  return (
    <Card className={cn('space-y-2', items.length ? 'border-warning/40' : 'border-success/30')}>
      <p className="font-semibold">{items.length ? 'Việc cần làm' : 'Mọi việc đã xong 👏'}</p>
      {items.map((it) => (
        <Link key={it.text} href={it.href} className="flex items-center gap-3 rounded-xl bg-surface-2/60 px-3 py-2">
          <it.icon className="size-5 shrink-0 text-warning" aria-hidden />
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{it.text}</span><span className="block truncate text-xs text-fg-muted">{it.sub}</span></span>
          <ChevronRight className="size-4 text-fg-subtle" aria-hidden />
        </Link>
      ))}
    </Card>
  )
}

function Kpi({ label, now, prev, fmt = (v) => formatNumber(v) }: { label: string; now: number; prev: number; fmt?: (v: number) => string }) {
  const diff = prev > 0 ? Math.round(((now - prev) / prev) * 100) : null
  return (
    <Card className="space-y-0.5 p-3 text-center">
      <p className="text-[11px] text-fg-subtle">{label}</p>
      <p className="font-mono text-xl font-bold">{fmt(now)}</p>
      {diff !== null && (
        <p className={cn('inline-flex items-center gap-0.5 text-[11px] font-semibold', diff >= 0 ? 'text-success' : 'text-danger')}>
          {diff >= 0 ? <ArrowUpRight className="size-3" aria-hidden /> : <ArrowDownRight className="size-3" aria-hidden />}{Math.abs(diff)}%
        </p>
      )}
    </Card>
  )
}

function LinkCard({ href, icon: Icon, title, text, alert }: { href: string; icon: typeof Wallet; title: string; text: string; alert?: boolean }) {
  return (
    <Link href={href} className={cn('flex items-start gap-3 rounded-[var(--radius-card)] border bg-surface p-3', alert ? 'border-warning/50' : 'border-border')}>
      <Icon className={cn('mt-0.5 size-5 shrink-0', alert ? 'text-warning' : 'text-brand')} aria-hidden />
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{title}</span><span className="line-clamp-2 block text-xs text-fg-muted">{text}</span></span>
      <ChevronRight className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
    </Link>
  )
}

function RecapSettings({ clubId, weekly, monthly, lastWeek }: { clubId: string; weekly: boolean; monthly: boolean; lastWeek: RecapMeta }) {
  const qc = useQueryClient()
  const refresh = () => void qc.invalidateQueries({ queryKey: ['club', clubId] })
  const set = useMutation({
    mutationFn: (v: { weekly: boolean; monthly: boolean }) => setClubRecap(clubId, v.weekly, v.monthly),
    onSuccess: refresh, onError: (e) => toast.error(pointsErrorMessage(e)),
  })
  const post = useMutation({
    mutationFn: (p: 'WEEK' | 'MONTH') => postRecapNow(clubId, p),
    onSuccess: () => { toast.success('Đã đăng tổng kết lên bảng tin'); refresh() },
    onError: (e) => toast.error(pointsErrorMessage(e)),
  })
  return (
    <Card className="space-y-2">
      <p className="flex items-center gap-2 font-semibold"><Megaphone className="size-4 text-xp" aria-hidden />Tổng kết tự động lên bảng tin</p>
      <p className="text-xs text-fg-muted">Km cả CLB, top km, top điểm CLB, buổi chạy nhóm và lượt điểm danh — đăng sáng thứ Hai và ngày đầu tháng. Tuần trước: {formatKm(lastWeek.distance_m)} km, {lastWeek.active_members} người chạy.</p>
      <SwitchRow checked={weekly} disabled={set.isPending} onChange={(v) => set.mutate({ weekly: v, monthly })} label="Tổng kết tuần" />
      <SwitchRow checked={monthly} disabled={set.isPending} onChange={(v) => set.mutate({ weekly, monthly: v })} label="Tổng kết tháng" />
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="secondary" loading={post.isPending && post.variables === 'WEEK'} onClick={() => post.mutate('WEEK')}>Đăng tuần trước</Button>
        <Button size="sm" variant="secondary" loading={post.isPending && post.variables === 'MONTH'} onClick={() => post.mutate('MONTH')}>Đăng tháng trước</Button>
      </div>
    </Card>
  )
}
