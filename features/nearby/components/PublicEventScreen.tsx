'use client'

import Link from 'next/link'
import { ArrowLeft, MapPin, Navigation, Route, ShieldCheck, Timer, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Card, ErrorState, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { nearbyErrorMessage, rsvpPublicEvent } from '../api/nearbyApi'
import { useNearbyMutation, usePublicEvent } from '../hooks/useNearby'
import { eventWhen } from '../model/nearby'

const RSVP = { GOING: 'Sẽ đi', MAYBE: 'Có thể', NOT_GOING: 'Không đi' } as const

/** Buổi chạy công khai của CLB — người ngoài CLB xem và báo tham gia (không thấy danh sách người đi) */
export function PublicEventScreen({ eventId }: { eventId: string }) {
  const q = usePublicEvent(eventId)
  const rsvp = useNearbyMutation((s: keyof typeof RSVP) => rsvpPublicEvent(eventId, s))
  return (
    <div className="space-y-4">
      <Link href={routes.nearby} className="-ml-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden />Quanh đây
      </Link>
      {q.isPending ? <div className="space-y-3"><Skeleton className="h-56" /></div>
        : q.isError ? <ErrorState message={nearbyErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
        : (() => {
          const e = q.data
          const cancelled = e.status === 'CANCELLED'
          const map = e.lat != null ? `https://www.google.com/maps/search/?api=1&query=${e.lat},${e.lng}` : null
          return (
            <>
              <Card className="space-y-4">
                <Link href={routes.club(e.club_id)} className="flex items-center gap-2 text-sm font-semibold text-fg-muted hover:text-fg">
                  <Avatar src={e.club_avatar} name={e.club_name} size="sm" />{e.club_name}
                </Link>
                <div>
                  <h1 className={cn('text-xl font-bold', cancelled && 'line-through opacity-70')}>{e.title}</h1>
                  <p className="mt-1 text-sm text-fg-muted">{eventWhen(e.starts_at)} · {e.duration_min} phút{cancelled ? ' · Đã huỷ' : ''}</p>
                </div>
                <dl className="space-y-2 text-sm">
                  <div className="flex gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-fg-muted" aria-hidden />
                    <dd>{e.location_name ?? 'Điểm hẹn công cộng'}
                      {map && <a href={map} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 font-semibold text-brand"><Navigation className="size-3.5" aria-hidden />Chỉ đường</a>}
                    </dd>
                  </div>
                  {e.distance_km && <div className="flex gap-2"><Route className="size-4 text-fg-muted" aria-hidden /><dd>{String(e.distance_km).replace('.', ',')} km</dd></div>}
                  {e.pace_text && <div className="flex gap-2"><Timer className="size-4 text-fg-muted" aria-hidden /><dd>Pace nhóm {e.pace_text}</dd></div>}
                  <div className="flex gap-2"><Users className="size-4 text-fg-muted" aria-hidden /><dd>{e.going_count}{e.capacity ? ` / ${e.capacity}` : ''} người sẽ đi</dd></div>
                </dl>
                {e.description && <p className="whitespace-pre-line text-sm">{e.description}</p>}
                {!cancelled && (
                  <div className="grid grid-cols-3 gap-2" role="group" aria-label="Báo tham gia">
                    {(Object.keys(RSVP) as (keyof typeof RSVP)[]).map((s) => (
                      <Button key={s} size="sm" variant={e.my_status === s ? 'primary' : 'secondary'} disabled={rsvp.isPending}
                        onClick={() => rsvp.mutate(s, { onSuccess: () => toast.success(s === 'GOING' ? 'Hẹn gặp bạn ở buổi chạy!' : 'Đã cập nhật'), onError: (x) => toast.error(nearbyErrorMessage(x)) })}>
                        {RSVP[s]}
                      </Button>
                    ))}
                  </div>
                )}
              </Card>
              <p className="flex gap-2 rounded-xl bg-surface p-3 text-xs text-fg-muted">
                <ShieldCheck className="size-4 shrink-0 text-brand" aria-hidden />
                Buổi chạy nhóm ở nơi công cộng do CLB tổ chức. Đi cùng nhóm, báo người thân lịch chạy, không chia sẻ địa chỉ nhà. Có vấn đề? Báo cáo trong Quanh đây.
              </p>
              {e.is_member && <Link href={`${routes.club(e.club_id)}/events/${e.id}`} className="block text-center text-sm font-semibold text-brand">Mở trong lịch CLB</Link>}
            </>
          )
        })()}
    </div>
  )
}
