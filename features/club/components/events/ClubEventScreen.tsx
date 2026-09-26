'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import QRCode from 'qrcode'
import {
  ArrowLeft, Ban, Camera, ExternalLink, CheckCircle2, Circle, MapPin, Navigation, Pencil, QrCode, RefreshCw, Route, ScanLine, Timer, Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Card, EmptyState, ErrorState, Field, Input, SectionTitle, SegmentedControl, Sheet, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatRelative } from '@/shared/lib/format'
import { routes } from '@/shared/config/routes'
import {
  cancelEvent, checkinToken, eventsErrorMessage, rsvpEvent, staffCheckin, type ClubEventDetail, type RsvpStatus,
} from '../../api/eventsApi'
import { useClubMutation, useEvent } from '../../hooks/useEvents'
import { eventCountdown, eventWhen, mapsUrl } from '../../model/events'
import { EventFormSheet } from './EventFormSheet'
import { listAlbums } from '../../api/albumsApi'
import { providerOf } from '../../model/media'
import { RSVP_LABEL } from './ClubEventsScreen'

const METHOD_LABEL = { QR: 'quét QR', AUTO: 'tự động từ bài chạy', STAFF: 'ban tổ chức' } as const

/** Chi tiết sự kiện: thông tin, báo tham gia, người tham gia + điểm danh; ban quản trị mở QR điểm danh */
export function ClubEventScreen({ clubId, eventId }: { clubId: string; eventId: string }) {
  const q = useEvent(eventId)
  const back = `${routes.club(clubId)}/events`
  return (
    <div className="space-y-4">
      <Link href={back} className="-ml-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden />Lịch CLB
      </Link>
      {q.isPending ? <div className="space-y-3"><Skeleton className="h-56" /><Skeleton className="h-40" /></div>
        : q.isError ? <ErrorState message={eventsErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
        : <Detail clubId={clubId} e={q.data} />}
    </div>
  )
}

function Detail({ clubId, e }: { clubId: string; e: ClubEventDetail }) {
  const [qrOpen, setQrOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const cancelled = e.status === 'CANCELLED'
  const [now] = useState(() => Date.now())
  const ended = new Date(e.ends_at).getTime() < now
  const rsvp = useClubMutation(clubId, (s: RsvpStatus) => rsvpEvent(e.id, s))
  const map = mapsUrl(e)
  const checkedIn = e.attendees.filter((a) => a.checked_in_at)

  return (
    <>
      <Card className="space-y-4">
        <div>
          <div className="flex items-start gap-2">
            <h1 className={cn('min-w-0 flex-1 text-xl font-bold', cancelled && 'line-through opacity-70')}>{e.title}</h1>
            {e.can_manage && !cancelled && !ended && (
              <Button size="sm" variant="secondary" aria-label="Sửa sự kiện" onClick={() => setEditing(true)}><Pencil className="size-4" aria-hidden /></Button>
            )}
          </div>
          <p className="mt-1 text-sm text-fg-muted">{eventWhen(e.starts_at)} · {cancelled ? 'Đã hủy' : eventCountdown(e.starts_at, e.ends_at)}</p>
          {e.creator_name && <p className="text-xs text-fg-subtle">Tổ chức: {e.creator_name}</p>}
        </div>

        {cancelled && e.cancel_reason && (
          <p className="rounded-xl bg-danger/10 p-3 text-sm text-danger">Lý do hủy: {e.cancel_reason}</p>
        )}

        <dl className="grid grid-cols-2 gap-2 text-sm">
          {e.location_name && (
            <Info icon={MapPin} label="Điểm hẹn" className="col-span-2">
              <span>{e.location_name}</span>
              {map && <a href={map} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 font-semibold text-brand"><Navigation className="size-3.5" aria-hidden />Chỉ đường</a>}
            </Info>
          )}
          {e.distance_km && <Info icon={Route} label="Cự ly">{String(e.distance_km).replace('.', ',')} km</Info>}
          {e.pace_text && <Info icon={Timer} label="Pace nhóm">{e.pace_text}</Info>}
          <Info icon={Users} label="Tham gia">{e.going_count}{e.capacity ? ` / ${e.capacity} chỗ` : ''}{e.maybe_count ? ` · ${e.maybe_count} có thể` : ''}</Info>
          <Info icon={CheckCircle2} label="Đã điểm danh">{e.checked_in_count}</Info>
        </dl>
        {e.description && <p className="whitespace-pre-line text-sm text-fg-muted">{e.description}</p>}

        {e.my_checked_in_at ? (
          <p className="flex items-center gap-2 rounded-xl bg-brand/10 p-3 text-sm font-semibold text-brand">
            <CheckCircle2 className="size-5" aria-hidden />Bạn đã điểm danh {formatRelative(e.my_checked_in_at)}
          </p>
        ) : !cancelled && !ended ? (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-fg-muted">Bạn có đi không?</p>
            <SegmentedControl value={e.my_status ?? ('' as RsvpStatus)}
              onChange={(s) => rsvp.mutate(s, { onSuccess: () => toast.success(s === 'GOING' ? 'Hẹn gặp bạn ở buổi chạy!' : 'Đã ghi nhận'), onError: (err) => toast.error(eventsErrorMessage(err)) })}
              options={(['GOING', 'MAYBE', 'NOT_GOING'] as const).map((s) => ({ value: s, label: RSVP_LABEL[s] }))} />
            {e.checkin_open && (
              <p className="flex items-center gap-1.5 text-xs text-fg-subtle"><ScanLine className="size-3.5" aria-hidden />
                Tới nơi thì quét mã QR của ban tổ chức bằng camera điện thoại. Chạy có GPS gần điểm hẹn cũng được tự điểm danh.</p>
            )}
          </div>
        ) : null}

        {e.can_manage && !cancelled && (
          <div className="flex gap-2">
            {e.checkin_open && <Button block onClick={() => setQrOpen(true)}><QrCode className="size-4" aria-hidden />Mở QR điểm danh</Button>}
            {!ended && <Button variant="secondary" className={e.checkin_open ? 'shrink-0' : 'flex-1'} onClick={() => setCancelling(true)}><Ban className="size-4" aria-hidden />Hủy</Button>}
          </div>
        )}
      </Card>

      <EventAlbums clubId={clubId} eventId={e.id} />

      <section>
        <SectionTitle>Người tham gia · {e.attendees.length}</SectionTitle>
        {e.attendees.length === 0 ? (
          <EmptyState icon={Users} title="Chưa ai báo tham gia" />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
            {e.attendees.map((a) => (
              <li key={a.user_id} className="flex items-center gap-3 px-4 py-2.5">
                <Avatar src={a.avatar_url} name={a.display_name ?? 'Runner'} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{a.display_name ?? 'Runner'}</span>
                  <span className="block text-xs text-fg-subtle">
                    {a.checked_in_at ? `Đã điểm danh · ${a.checkin_method ? METHOD_LABEL[a.checkin_method] : ''}` : RSVP_LABEL[a.status]}
                  </span>
                </span>
                {e.can_manage && !cancelled ? <CheckToggle clubId={clubId} eventId={e.id} userId={a.user_id} checked={!!a.checked_in_at} />
                  : a.checked_in_at ? <CheckCircle2 className="size-5 text-brand" aria-label="Đã điểm danh" /> : null}
              </li>
            ))}
          </ul>
        )}
        {checkedIn.length > 0 && <p className="mt-2 text-xs text-fg-subtle">Mỗi lần điểm danh được tính cho huy hiệu chạy nhóm.</p>}
      </section>

      {qrOpen && <QrSheet eventId={e.id} clubId={clubId} onClose={() => setQrOpen(false)} />}
      {editing && <EventFormSheet clubId={clubId} event={e} open onClose={() => setEditing(false)} />}
      {cancelling && <CancelSheet clubId={clubId} eventId={e.id} onClose={() => setCancelling(false)} />}
    </>
  )
}

function Info({ icon: Icon, label, children, className }: { icon: typeof MapPin; label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl bg-surface-2 p-2.5', className)}>
      <dt className="flex items-center gap-1 text-xs text-fg-subtle"><Icon className="size-3.5" aria-hidden />{label}</dt>
      <dd className="mt-0.5 font-semibold">{children}</dd>
    </div>
  )
}

function CheckToggle({ clubId, eventId, userId, checked }: { clubId: string; eventId: string; userId: string; checked: boolean }) {
  const m = useClubMutation(clubId, (v: boolean) => staffCheckin(eventId, userId, v))
  return (
    <button type="button" onClick={() => m.mutate(!checked, { onError: (e) => toast.error(eventsErrorMessage(e)) })} disabled={m.isPending}
      aria-pressed={checked} aria-label={checked ? 'Bỏ điểm danh' : 'Điểm danh'}
      className="grid size-11 place-items-center rounded-full hover:bg-surface-2 disabled:opacity-50">
      {checked ? <CheckCircle2 className="size-6 text-brand" aria-hidden /> : <Circle className="size-6 text-fg-subtle" aria-hidden />}
    </button>
  )
}

/** Mã QR điểm danh: link mở bằng camera điện thoại; tự làm mới 5 phút một lần (mã có hạn 15 phút) */
function QrSheet({ clubId, eventId, onClose }: { clubId: string; eventId: string; onClose: () => void }) {
  const t = useQuery({ queryKey: ['club-event', eventId, 'qr'], queryFn: () => checkinToken(eventId), refetchInterval: 5 * 60_000, gcTime: 0 })
  const [img, setImg] = useState<string | null>(null)
  const url = t.data ? `${window.location.origin}${routes.club(clubId)}/events/${eventId}/checkin?t=${encodeURIComponent(t.data.token)}` : null
  useEffect(() => {
    if (!url) return
    let alive = true
    void QRCode.toDataURL(url, { width: 640, margin: 1, errorCorrectionLevel: 'M' }).then((d) => { if (alive) setImg(d) })
    return () => { alive = false }
  }, [url])
  return (
    <Sheet open onClose={onClose} title="QR điểm danh" description="Thành viên mở camera điện thoại, quét mã là điểm danh xong">
      <div className="flex flex-col items-center gap-3 pb-2">
        {t.isError ? <ErrorState message={eventsErrorMessage(t.error)} error={t.error} onRetry={() => void t.refetch()} />
          : img ? (
            // eslint-disable-next-line @next/next/no-img-element -- ảnh QR tạo tại chỗ (data URL)
            <img src={img} alt="Mã QR điểm danh" className="size-72 rounded-2xl bg-white p-3" />
          ) : <Skeleton className="size-72" />}
        {t.data && <p className="text-xs text-fg-subtle">Mã tự đổi mỗi 5 phút · hết hạn {new Date(t.data.expires_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</p>}
        <Button variant="secondary" size="sm" onClick={() => void t.refetch()} loading={t.isFetching}><RefreshCw className="size-4" aria-hidden />Làm mới mã</Button>
      </div>
    </Sheet>
  )
}

function CancelSheet({ clubId, eventId, onClose }: { clubId: string; eventId: string; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const m = useClubMutation(clubId, () => cancelEvent(eventId, reason.trim()))
  return (
    <Sheet open onClose={onClose} title="Hủy sự kiện?" description="Người đã báo tham gia sẽ nhận thông báo kèm lý do"
      footer={<div className="flex gap-2">
        <Button variant="secondary" block onClick={onClose}>Giữ lại</Button>
        <Button variant="danger" block disabled={reason.trim().length < 3} loading={m.isPending}
          onClick={() => m.mutate(undefined, { onSuccess: () => { toast.success('Đã hủy sự kiện'); onClose() }, onError: (e) => toast.error(eventsErrorMessage(e)) })}>Hủy sự kiện</Button>
      </div>}>
      <Field label="Lý do" htmlFor="cancel-reason">
        <Input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Trời mưa lớn, dời sang tuần sau" />
      </Field>
    </Sheet>
  )
}

/** Album ảnh gắn với sự kiện (từ tab Ảnh) + lối thêm link */
function EventAlbums({ clubId, eventId }: { clubId: string; eventId: string }) {
  const q = useQuery({ queryKey: ['club', clubId, 'albums', { event_id: eventId }], queryFn: () => listAlbums(clubId, { event_id: eventId }) })
  const items = (q.data?.items ?? []).filter((a) => a.status === 'APPROVED')
  return (
    <section className="space-y-2">
      <SectionTitle action={<Link href={routes.clubTab(clubId, 'photos')} className="text-sm font-semibold text-brand">Kho ảnh</Link>}>Ảnh buổi chạy</SectionTitle>
      {items.length === 0 ? (
        <Link href={routes.clubTab(clubId, 'photos')} className="flex items-center gap-3 rounded-xl border border-dashed border-border p-3 text-sm text-fg-muted hover:border-fg-subtle">
          <Camera className="size-5 shrink-0" aria-hidden />Chưa có album. Có ảnh buổi này? Gửi link album ở tab Ảnh.
        </Link>
      ) : items.map((a) => (
        <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer nofollow"
          className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3 hover:border-fg-subtle">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg text-white" style={{ background: providerOf(a.url).color }}><Camera className="size-5" aria-hidden /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{a.title}</span>
            <span className="block text-xs text-fg-muted">{providerOf(a.url).name}{a.photographer ? ` · 📷 ${a.photographer}` : ''}</span></span>
          <ExternalLink className="size-4 shrink-0 text-fg-subtle" aria-hidden />
        </a>
      ))}
    </section>
  )
}
