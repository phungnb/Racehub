'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ArrowLeft, CalendarDays, Clock, Flag, MoreHorizontal, Timer, UserMinus, UsersRound } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Card, ConfirmSheet, EmptyState, ErrorState, LevelBadge, SectionTitle, Sheet, Skeleton } from '@/shared/ui'
import { routes } from '@/shared/config/routes'
import {
  cancelRequest, nearbyErrorMessage, removeConnection, respondConnection, unblockUser, type Person,
} from '../api/nearbyApi'
import { useConnections, useNearbyMutation } from '../hooks/useNearby'
import { formatPace, GOALS, SLOTS } from '../model/nearby'
import { InviteSheet, ReportSheet } from './RunnerCard'

/** Kết nối Quanh đây: lời mời đến, bạn chạy đã kết nối, lời mời đã gửi, người đã chặn */
export function ConnectionsScreen() {
  const q = useConnections()
  return (
    <div className="space-y-4">
      <Link href={routes.nearby} className="-ml-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden />Quanh đây
      </Link>
      <h1 className="text-2xl font-bold">Kết nối</h1>
      {q.isPending ? <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
        : q.isError ? <ErrorState message={nearbyErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
        : (
          <>
            {q.data.incoming.length > 0 && (
              <section className="space-y-2">
                <SectionTitle>Lời mời kết nối ({q.data.incoming.length})</SectionTitle>
                {q.data.incoming.map((p) => <Incoming key={p.request_id} p={p} />)}
              </section>
            )}
            <section className="space-y-2">
              <SectionTitle>Bạn chạy ({q.data.connections.length})</SectionTitle>
              {q.data.connections.length === 0
                ? <EmptyState icon={UsersRound} title="Chưa có kết nối" description="Kết nối với runner hợp pace ở Quanh đây rồi rủ nhau vào buổi chạy nhóm."
                    action={<Link href={routes.nearby} className="font-semibold text-brand">Tìm runner quanh đây</Link>} />
                : q.data.connections.map((p) => <Connected key={p.id} p={p} />)}
            </section>
            {q.data.outgoing.length > 0 && (
              <section className="space-y-2">
                <SectionTitle>Đã gửi</SectionTitle>
                {q.data.outgoing.map((p) => <Outgoing key={p.request_id} p={p} />)}
              </section>
            )}
            {q.data.blocked.length > 0 && (
              <section className="space-y-2">
                <SectionTitle>Đã chặn</SectionTitle>
                {q.data.blocked.map((b) => <Blocked key={b.id} id={b.id} name={b.name} />)}
              </section>
            )}
          </>
        )}
    </div>
  )
}

function Who({ p, children }: { p: Person; children?: React.ReactNode }) {
  const pace = formatPace(p.pace_s)
  return (
    <div className="flex items-start gap-3">
      <Avatar src={p.avatar_url} name={p.name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5"><p className="truncate font-semibold">{p.name}</p>{p.level != null && <LevelBadge level={p.level} />}</div>
        <p className="flex flex-wrap gap-x-3 text-xs text-fg-muted">
          {pace && <span className="inline-flex items-center gap-1"><Timer className="size-3" aria-hidden />{pace}</span>}
          {p.goals.length > 0 && <span className="inline-flex items-center gap-1"><Flag className="size-3" aria-hidden />{p.goals.map((g) => GOALS[g]).join(', ')}</span>}
          {p.time_slots.length > 0 && <span className="inline-flex items-center gap-1"><Clock className="size-3" aria-hidden />{p.time_slots.map((s) => SLOTS[s]).join(', ')}</span>}
        </p>
      </div>
      {children}
    </div>
  )
}

function Incoming({ p }: { p: Person }) {
  const respond = useNearbyMutation((a: 'ACCEPT' | 'DECLINE') => respondConnection(p.request_id!, a))
  const act = (a: 'ACCEPT' | 'DECLINE') => respond.mutate(a, {
    onSuccess: () => toast.success(a === 'ACCEPT' ? `Đã kết nối với ${p.name}` : 'Đã từ chối (người kia không được báo)'),
    onError: (e) => toast.error(nearbyErrorMessage(e)),
  })
  return (
    <Card className="space-y-3">
      <Who p={p} />
      {p.message && <p className="rounded-xl bg-surface-2 p-3 text-sm">“{p.message}”</p>}
      {p.bio && !p.message && <p className="text-sm text-fg-muted">{p.bio}</p>}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" disabled={respond.isPending} onClick={() => act('DECLINE')}>Từ chối</Button>
        <Button loading={respond.isPending && respond.variables === 'ACCEPT'} disabled={respond.isPending} onClick={() => act('ACCEPT')}>Chấp nhận</Button>
      </div>
    </Card>
  )
}

function Connected({ p }: { p: Person }) {
  const [sheet, setSheet] = useState<'invite' | 'menu' | 'remove' | 'report' | null>(null)
  const remove = useNearbyMutation(() => removeConnection(p.id))
  const close = () => setSheet(null)
  return (
    <Card className="space-y-3">
      <Who p={p}>
        <button type="button" onClick={() => setSheet('menu')} aria-label={`Tuỳ chọn với ${p.name}`}
          className="-mr-2 -mt-1 grid size-11 place-items-center rounded-full text-fg-muted hover:bg-surface-2 hover:text-fg">
          <MoreHorizontal className="size-5" aria-hidden />
        </button>
      </Who>
      <Button block onClick={() => setSheet('invite')}><CalendarDays className="size-4" aria-hidden />Rủ chạy</Button>
      {sheet === 'invite' && <InviteSheet userId={p.id} name={p.name} onClose={close} />}
      {sheet === 'report' && <ReportSheet userId={p.id} name={p.name} onClose={close} />}
      <Sheet open={sheet === 'menu'} onClose={close} title={p.name}>
        <div className="space-y-2">
          <Button block variant="secondary" onClick={() => setSheet('remove')}><UserMinus className="size-4" aria-hidden />Huỷ kết nối</Button>
          <Button block variant="danger" onClick={() => setSheet('report')}><Flag className="size-4" aria-hidden />Báo cáo / chặn</Button>
        </div>
      </Sheet>
      <ConfirmSheet open={sheet === 'remove'} onClose={close} title={`Huỷ kết nối với ${p.name}?`} confirmLabel="Huỷ kết nối" loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined, { onSuccess: () => { toast.success('Đã huỷ kết nối'); close() }, onError: (e) => toast.error(nearbyErrorMessage(e)) })} />
    </Card>
  )
}

function Outgoing({ p }: { p: Person }) {
  const cancel = useNearbyMutation(() => cancelRequest(p.request_id!))
  return (
    <Card>
      <Who p={p}>
        <Button size="sm" variant="ghost" loading={cancel.isPending}
          onClick={() => cancel.mutate(undefined, { onSuccess: () => toast.success('Đã rút lời mời'), onError: (e) => toast.error(nearbyErrorMessage(e)) })}>
          Rút lại
        </Button>
      </Who>
    </Card>
  )
}

function Blocked({ id, name }: { id: string; name: string }) {
  const unblock = useNearbyMutation(() => unblockUser(id))
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border px-3 py-2">
      <Avatar name={name} size="sm" />
      <p className="min-w-0 flex-1 truncate text-sm">{name}</p>
      <Button size="sm" variant="ghost" loading={unblock.isPending}
        onClick={() => unblock.mutate(undefined, { onSuccess: () => toast.success(`Đã bỏ chặn ${name}`), onError: (e) => toast.error(nearbyErrorMessage(e)) })}>
        Bỏ chặn
      </Button>
    </div>
  )
}
