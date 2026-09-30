'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Award, ChevronRight, Flag, Footprints, Medal, Route, ShieldCheck, Sparkles, Trash2, Trophy, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Card, ConfirmSheet, EmptyState, ErrorState, PageHeader, SegmentedControl, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { getSources, myVictories, revokeVictory, victoryErrorMessage, type MyVictory, type SourceItem } from '../api/victoryApi'
import { KIND_LABEL, type VicKind } from '../model/victory'
import { victoryKeys } from '../hooks/keys'
import { useVictoryAccess } from '../hooks/useVictoryAccess'
import { VictoryUpsell } from './VictoryUpsell'

const STATE: Record<string, { label: string; tone: string }> = {
  COMPLETED: { label: 'Hoàn thành', tone: 'bg-brand/15 text-brand' },
  FINISHED: { label: 'Đã kết thúc', tone: 'bg-coin/15 text-coin' },
  IN_PROGRESS: { label: 'Đang diễn ra', tone: 'bg-sky-500/15 text-sky-400' },
}

/** Victory Studio: chọn thành tích → chọn mẫu → xuất ảnh. BTC / ban quản trị: vinh danh thành viên trong thử thách mình quản lý. */
export function VictoryHome() {
  const [tab, setTab] = useState<'MINE' | 'HONOR' | 'HISTORY'>('MINE')
  const q = useQuery({ queryKey: victoryKeys.sources, queryFn: getSources })
  const managed = q.data?.managed ?? []
  const access = useVictoryAccess()
  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader title="Victory Studio" subtitle="Tạo ảnh vinh danh đẹp, đúng thành tích, chỉ vài chạm" />
      {!access.unlocked && <VictoryUpsell />}
      <SegmentedControl value={tab} onChange={setTab} options={[
        { value: 'MINE', label: 'Thành tích' },
        ...(managed.length ? [{ value: 'HONOR' as const, label: 'Vinh danh', count: managed.length }] : []),
        { value: 'HISTORY', label: 'Đã tạo' },
      ]} />
      {tab === 'HISTORY' ? <History /> : q.isPending ? (
        <div className="space-y-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : q.isError ? (
        <ErrorState message="Không tải được thành tích." error={q.error} onRetry={() => void q.refetch()} />
      ) : tab === 'HONOR' ? (
        <div className="space-y-4">
          <Group icon={Users} title="Vinh danh thành viên" hint="Chọn thử thách → chọn runner → đặt danh hiệu (tùy chọn). Số liệu tự lấy từ kết quả.">
            {managed.map((c) => (
              <Item key={c.ref} href={routes.victoryCreate('CHALLENGE', c.ref, { pick: true })} title={c.title}
                subtitle={`${c.participants ?? 0} người tham gia · kết thúc ${c.date ?? ''}`} />
            ))}
          </Group>
          <Group icon={Award} title="Vinh danh thử thách" hint="Bảng tôn vinh chung của cả giải: Top thành tích, danh hiệu, ảnh nhóm — công bố cho mọi người.">
            {managed.map((c) => (
              <Item key={c.ref} href={routes.challengeHonorStudio(c.ref)} title={c.title} subtitle="Thiết kế ảnh tôn vinh cả giải" />
            ))}
          </Group>
        </div>
      ) : (
        <Mine />
      )}
    </div>
  )
}

function Mine() {
  const q = useQuery({ queryKey: victoryKeys.sources, queryFn: getSources })
  const d = q.data!
  const empty = !d.challenges.length && !d.runs.length && !d.totals.length && !d.levels.length && !d.badges.length
  if (empty) {
    return <EmptyState icon={Trophy} title="Chưa có thành tích" description="Chạy bài đầu tiên (từ 5 km), tham gia thử thách hoặc lên Level để tạo ảnh vinh danh." />
  }
  const link = (kind: VicKind) => (s: SourceItem) => routes.victoryCreate(kind, s.ref)
  return (
    <div className="space-y-4">
      {!!d.challenges.length && (
        <Group icon={Flag} title="Thử thách" hint="Chọn thông số muốn khoe: kết quả, hạng, thời gian, số buổi…">
          {d.challenges.map((s) => (
            <Item key={s.ref} href={link('CHALLENGE')(s)} title={s.title} subtitle={s.subtitle}
              badge={s.state ? STATE[s.state] : undefined} />
          ))}
        </Group>
      )}
      {!!d.runs.length && (
        <Group icon={Footprints} title="Thành tích cá nhân" hint="5K · 10K · Half · Marathon · kỷ lục cá nhân">
          {d.runs.map((s) => <Item key={s.ref} href={link('RUN')(s)} title={s.title} subtitle={`${s.subtitle ?? ''} · ${s.date ?? ''}`} />)}
        </Group>
      )}
      {!!d.totals.length && (
        <Group icon={Route} title="Cột mốc hành trình" hint={`Tổng ${String(d.total_km).replace('.', ',')} km trên RaceHub`}>
          <div className="flex flex-wrap gap-2 p-3">
            {d.totals.map((s) => (
              <Link key={s.ref} href={link('TOTAL_KM')(s)} className="rounded-full border border-border bg-surface-2 px-3.5 py-2 text-sm font-bold hover:border-brand/60">
                {s.title}
              </Link>
            ))}
          </div>
        </Group>
      )}
      {!!d.levels.length && (
        <Group icon={Sparkles} title="Level">
          {d.levels.slice(0, 3).map((s) => <Item key={s.ref} href={link('LEVEL')(s)} title={s.title} subtitle={s.subtitle} />)}
        </Group>
      )}
      {!!d.badges.length && (
        <Group icon={Medal} title="Huy hiệu">
          {d.badges.map((s) => <Item key={s.ref} href={link('BADGE')(s)} title={`${s.icon ?? '🏅'} ${s.title}`} subtitle={s.date} />)}
        </Group>
      )}
    </div>
  )
}

function Group({ icon: Icon, title, hint, children }: { icon: typeof Award; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h2 className="flex items-center gap-2 px-1 text-sm font-bold"><Icon className="size-4 text-brand" aria-hidden />{title}</h2>
      {hint && <p className="px-1 text-xs text-fg-muted">{hint}</p>}
      <Card className="divide-y divide-border overflow-hidden p-0">{children}</Card>
    </section>
  )
}

function Item({ href, title, subtitle, badge }: { href: string; title: string; subtitle?: string | null; badge?: { label: string; tone: string } }) {
  return (
    <Link href={href} className="flex min-h-14 items-center gap-3 px-3 py-2.5 hover:bg-surface-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{title}</span>
        {subtitle && <span className="block truncate text-xs text-fg-muted">{subtitle}</span>}
      </span>
      {badge && <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold', badge.tone)}>{badge.label}</span>}
      <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
    </Link>
  )
}

function History() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: victoryKeys.mine, queryFn: myVictories })
  const [revoke, setRevoke] = useState<MyVictory | null>(null)
  const del = useMutation({
    mutationFn: (code: string) => revokeVictory(code),
    onSuccess: () => { toast.success('Đã thu hồi mã xác thực'); setRevoke(null); void qc.invalidateQueries({ queryKey: victoryKeys.mine }) },
    onError: (e) => toast.error(victoryErrorMessage(e)),
  })
  if (q.isPending) return <div className="space-y-2">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>
  if (q.isError) return <ErrorState message="Không tải được ảnh đã tạo." error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data.length) return <EmptyState icon={ShieldCheck} title="Chưa có ảnh nào" description="Mỗi ảnh xuất ra có mã xác thực riêng; danh sách hiện ở đây." />
  return (
    <>
      <Card className="divide-y divide-border overflow-hidden p-0">
        {q.data.map((v) => (
          <div key={v.code} className="flex items-center gap-3 px-3 py-2.5">
            <Link href={routes.victoryVerify(v.code)} className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{v.award ?? v.facts.headline} · {v.facts.title}</span>
              <span className="block truncate text-xs text-fg-muted">
                {KIND_LABEL[v.kind]}{!v.mine && ` · vinh danh ${v.person.display_name ?? ''}`} · mã {v.code} · {v.exports} lần xuất
              </span>
            </Link>
            <button type="button" onClick={() => setRevoke(v)} aria-label={`Thu hồi mã ${v.code}`}
              className="grid size-10 shrink-0 place-items-center rounded-full text-fg-subtle hover:bg-surface-2 hover:text-danger">
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
        ))}
      </Card>
      <ConfirmSheet open={!!revoke} onClose={() => setRevoke(null)} title={`Thu hồi mã ${revoke?.code ?? ''}?`} confirmLabel="Thu hồi"
        description="Quét QR trên ảnh đã chia sẻ sẽ báo mã không còn hiệu lực. Bạn vẫn tạo lại ảnh mới được." loading={del.isPending}
        onConfirm={() => revoke && del.mutate(revoke.code)} />
    </>
  )
}
