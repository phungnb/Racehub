'use client'

import Link from 'next/link'
import { useState } from 'react'
import { CalendarDays, Flag, Hand, MapPin, MessageCircle, Timer, Trophy, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Card, LevelBadge, Sheet } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatRelative } from '@/shared/lib/format'
import { routes } from '@/shared/config/routes'
import { dayLabel, formatKm, formatPace, GOALS, REPORT_REASONS } from '@/features/nearby'
import { closeHubPost, hubErrorMessage, reportHubPost, toggleHubInterest, type HubPost } from '../api/hubApi'
import { formatDuration, POST_KINDS } from '../model/hub'
import { useHubMutation, useInterested } from './hubHooks'

const when = (iso: string) => new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
}).format(new Date(iso))

/** Một bài Hội quán: rủ chạy / đi giải / pacer / khoe thành tích / hỏi đáp. "Quan tâm" → hai bên nhắn tin được. */
export function HubPostCard({ p, highlight }: { p: HubPost; highlight?: boolean }) {
  const [sheet, setSheet] = useState<'who' | 'report' | null>(null)
  const interest = useHubMutation(() => toggleHubInterest(p.id))
  const close = useHubMutation(() => closeHubPost(p.id))
  const k = POST_KINDS[p.kind]
  const pace = p.pace_s ? formatPace(p.pace_s) : null
  const closed = p.status !== 'ACTIVE'

  return (
    <Card className={cn('space-y-2.5', highlight && 'ring-2 ring-violet-400', closed && 'opacity-70')}>
      <div className="flex items-start gap-2.5">
        <Link href={routes.athlete(p.author.id)} aria-label={`Hồ sơ ${p.author.name}`}><Avatar src={p.author.avatar_url} name={p.author.name} /></Link>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm">
            <Link href={routes.athlete(p.author.id)} className="truncate font-semibold hover:underline">{p.author.name}</Link>
            {p.author.level != null && <LevelBadge level={p.author.level} />}
          </p>
          <p className="truncate text-xs text-fg-subtle">
            {[p.province ?? p.author.province, p.km != null ? formatKm(p.km) : null, formatRelative(p.created_at)].filter(Boolean).join(' · ')}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-bold text-violet-300">{k.emoji} {k.label}</span>
      </div>

      <p className="whitespace-pre-line text-sm">{p.body}</p>

      {(p.race_name || p.meet_at || p.goal || pace || p.activity || p.area_label) && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {p.race_name && <Chip icon={Trophy}>{p.race_name}</Chip>}
          {p.meet_at && <Chip icon={CalendarDays}>{when(p.meet_at)}</Chip>}
          {p.goal && <Chip>{GOALS[p.goal]}</Chip>}
          {pace && <Chip icon={Timer}>pace {pace}</Chip>}
          {p.area_label && <Chip icon={MapPin}>{p.area_label}</Chip>}
          {p.activity && (
            <Chip icon={Trophy}>
              {(p.activity.distance_m / 1000).toFixed(1).replace('.', ',')} km · {formatDuration(p.activity.moving_time_s)} · {dayLabel(p.activity.day)}
            </Chip>
          )}
        </div>
      )}

      {closed && <p className="text-xs font-semibold text-fg-muted">{p.status === 'HIDDEN' ? 'Đang ẩn chờ quản trị viên xem xét (nhiều báo cáo)' : 'Đã đóng'}</p>}

      <div className="flex items-center gap-2 border-t border-border pt-2.5">
        {p.is_mine ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => setSheet('who')} disabled={!p.interest_count}>
              <Users className="size-4" aria-hidden />{p.interest_count} người quan tâm
            </Button>
            {!closed && (
              <Button size="sm" variant="ghost" loading={close.isPending} className="ml-auto"
                onClick={() => close.mutate(undefined, { onSuccess: () => toast.success('Đã đóng bài'), onError: (e) => toast.error(hubErrorMessage(e)) })}>
                Đóng bài
              </Button>
            )}
          </>
        ) : (
          <>
            <Button size="sm" variant={p.interested ? 'primary' : 'secondary'} loading={interest.isPending} disabled={closed}
              aria-pressed={p.interested}
              onClick={() => interest.mutate(undefined, {
                onSuccess: (x) => { if (x.interested) toast.success('Đã báo cho người đăng', { description: 'Hai bạn giờ nhắn tin được cho nhau.' }) },
                onError: (e) => toast.error(hubErrorMessage(e)),
              })}>
              <Hand className="size-4" aria-hidden />{p.interested ? 'Đã quan tâm' : 'Quan tâm'}{p.interest_count ? ` · ${p.interest_count}` : ''}
            </Button>
            {p.interested && (
              <Link href={routes.message(p.author.id)} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-semibold text-brand">
                <MessageCircle className="size-4" aria-hidden />Nhắn tin
              </Link>
            )}
            <button type="button" aria-label="Báo cáo bài" onClick={() => setSheet('report')}
              className="ml-auto grid size-9 place-items-center rounded-full text-fg-subtle hover:bg-surface-2">
              <Flag className="size-4" aria-hidden />
            </button>
          </>
        )}
      </div>
      {sheet === 'who' && <InterestedSheet id={p.id} onClose={() => setSheet(null)} />}
      {sheet === 'report' && <ReportSheet id={p.id} onClose={() => setSheet(null)} />}
    </Card>
  )
}

function Chip({ icon: Icon, children }: { icon?: typeof Trophy; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-1 font-semibold text-fg-muted">
      {Icon && <Icon className="size-3" aria-hidden />}{children}
    </span>
  )
}

function InterestedSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useInterested(id)
  return (
    <Sheet open onClose={onClose} title="Người quan tâm" description="Họ đã đồng ý để bạn nhắn tin. Hẹn nhau ở nơi công cộng nhé.">
      {q.isPending ? <p className="text-sm text-fg-muted">Đang tải…</p> : (
        <ul className="space-y-2">
          {(q.data ?? []).map((u) => (
            <li key={u.id} className="flex items-center gap-3 rounded-xl border border-border p-2.5">
              <Avatar src={u.avatar_url} name={u.name} />
              <div className="min-w-0 flex-1">
                <Link href={routes.athlete(u.id)} className="block truncate text-sm font-semibold hover:underline">{u.name}</Link>
                <p className="truncate text-xs text-fg-subtle">{[u.province, u.pace_s ? `pace ${formatPace(u.pace_s)}` : null, formatRelative(u.at)].filter(Boolean).join(' · ')}</p>
              </div>
              <Link href={routes.message(u.id)} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand px-3 text-sm font-semibold text-brand-fg">
                <MessageCircle className="size-4" aria-hidden />Nhắn
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}

function ReportSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const [reason, setReason] = useState<string>('SPAM')
  const report = useHubMutation(() => reportHubPost(id, reason))
  return (
    <Sheet open onClose={onClose} title="Báo cáo bài đăng" description="3 người báo cáo → bài tự ẩn chờ quản trị viên xem xét."
      footer={<Button block variant="danger" loading={report.isPending}
        onClick={() => report.mutate(undefined, { onSuccess: () => { toast.success('Đã gửi báo cáo'); onClose() }, onError: (e) => toast.error(hubErrorMessage(e)) })}>Gửi báo cáo</Button>}>
      <div className="space-y-1.5">
        {Object.entries(REPORT_REASONS).map(([k, label]) => (
          <button key={k} type="button" aria-pressed={reason === k} onClick={() => setReason(k)}
            className={cn('w-full rounded-xl border p-3 text-left text-sm', reason === k ? 'border-danger bg-danger/10' : 'border-border')}>
            {label}
          </button>
        ))}
      </div>
    </Sheet>
  )
}
