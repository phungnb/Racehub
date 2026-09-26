'use client'

import Link from 'next/link'
import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CalendarDays, Handshake, MapPin, Route, Search, Send, Timer, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button, EmptyState, ErrorState, Field, Input, SegmentedControl, Sheet, Skeleton, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { useDebounced } from '@/shared/lib/search'
import { formatNumber } from '@/shared/lib/format'
import { routes } from '@/shared/config/routes'
import { clubErrorMessage, searchClubs } from '../../api/clubApi'
import { cancelClubExchange, getClubExchanges, respondClubExchange, sendClubExchange, type ClubExchange, type ExchangeStatus } from '../../api/exchangeApi'
import { useClub } from '../../hooks/useClub'
import { accentOf } from '../../model/roles'
import { fromVnLocalInput, parseLatLng, toVnLocalInput } from '../../model/events'
import { ClubAvatar } from '../hub/ClubAvatar'

const STATUS: Record<ExchangeStatus, { label: string; cls: string }> = {
  PENDING: { label: 'Chờ trả lời', cls: 'bg-coin/20 text-coin' },
  ACCEPTED: { label: 'Đã nhận lời', cls: 'bg-success/20 text-success' },
  DECLINED: { label: 'Từ chối', cls: 'bg-surface-2 text-fg-muted' },
  CANCELLED: { label: 'Đã huỷ', cls: 'bg-danger/15 text-danger' },
}
const fmtWhen = (iso: string) => new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'long', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })

/** Giao lưu CLB: gửi thư mời chạy chung offline cho CLB khác; nhận lời → sự kiện tự tạo ở tab Lịch của cả hai CLB */
export function ExchangeScreen({ clubId }: { clubId: string }) {
  const { club } = useClub(clubId)
  const [tab, setTab] = useState<'IN' | 'OUT'>('IN')
  const [composing, setComposing] = useState(false)
  const q = useQuery({ queryKey: ['club', clubId, 'exchanges'], queryFn: () => getClubExchanges(clubId) })
  const staff = q.data?.is_staff ?? false
  const list = tab === 'IN' ? q.data?.incoming : q.data?.outgoing
  const pendingIn = q.data?.incoming.filter((x) => x.status === 'PENDING').length ?? 0

  return (
    <div className="space-y-4 pb-8">
      <Link href={`${routes.club(clubId)}/events`} className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden />Lịch CLB
      </Link>
      <div className="relative overflow-hidden rounded-2xl border border-border p-4"
        style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${accentOf(club)} 30%, transparent), transparent 75%)` }}>
        <Handshake className="absolute -right-3 -top-3 size-24 opacity-10" aria-hidden />
        <h1 className="text-lg font-bold">Giao lưu CLB</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Mời một CLB khác chạy chung offline. Khi họ nhận lời, buổi giao lưu tự xuất hiện ở tab Lịch của cả hai CLB — thành viên đăng ký, điểm danh QR như sự kiện thường.
        </p>
        {staff && <Button className="mt-3" onClick={() => setComposing(true)}><Send className="size-4" aria-hidden />Gửi thư mời giao lưu</Button>}
      </div>

      <SegmentedControl value={tab} onChange={setTab}
        options={[{ value: 'IN', label: pendingIn ? `Nhận được (${pendingIn})` : 'Nhận được' }, { value: 'OUT', label: 'Đã gửi' }]} />

      {q.isPending ? (
        <div className="space-y-3"><Skeleton className="h-52" /><Skeleton className="h-52" /></div>
      ) : q.isError ? (
        <ErrorState message={clubErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
      ) : !list?.length ? (
        <EmptyState icon={Handshake} title={tab === 'IN' ? 'Chưa có thư mời nào' : 'Chưa gửi thư mời nào'}
          description={staff ? (tab === 'IN' ? 'Thư mời từ CLB khác sẽ hiện ở đây.' : 'Bấm “Gửi thư mời giao lưu” để rủ một CLB chạy chung.')
            : 'Các buổi giao lưu đã chốt sẽ hiện ở đây và trong tab Lịch.'} />
      ) : (
        <ul className="space-y-4">
          {list.map((x) => <li key={x.id}><InviteLetter x={x} clubId={clubId} staff={staff} incoming={tab === 'IN'} /></li>)}
        </ul>
      )}
      {composing && club && <ComposeSheet clubId={clubId} clubName={club.name} onClose={() => setComposing(false)} />}
    </div>
  )
}

function InviteLetter({ x, clubId, staff, incoming }: { x: ClubExchange; clubId: string; staff: boolean; incoming: boolean }) {
  const qc = useQueryClient()
  const [mode, setMode] = useState<'accept' | 'decline' | 'cancel' | null>(null)
  const [note, setNote] = useState('')
  const refresh = () => void qc.invalidateQueries({ queryKey: ['club', clubId] })
  const act = useMutation({
    mutationFn: () => mode === 'cancel' ? cancelClubExchange(x.id, note) : respondClubExchange(x.id, mode === 'accept', note),
    onSuccess: () => {
      toast.success(mode === 'accept' ? 'Đã nhận lời — sự kiện đã có trong tab Lịch' : mode === 'decline' ? 'Đã trả lời thư mời' : 'Đã huỷ buổi giao lưu')
      setMode(null); setNote(''); refresh()
    },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  const mine = incoming ? x.guest_event_id : x.host_event_id
  const a = accentOf(x.from), b = accentOf(x.to)
  const canCancel = staff && (x.status === 'ACCEPTED' || (x.status === 'PENDING' && !incoming))

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      {/* Đầu thư: hai logo CLB, dải màu hai CLB */}
      <div className="relative px-4 pb-4 pt-5 text-center" style={{ background: `linear-gradient(120deg, color-mix(in srgb, ${a} 35%, transparent), color-mix(in srgb, ${b} 35%, transparent))` }}>
        <span className={cn('absolute right-3 top-3 rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS[x.status].cls)}>{STATUS[x.status].label}</span>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-fg-muted">Thư mời giao lưu</p>
        <div className="mt-3 flex items-center justify-center gap-3">
          <ClubAvatar club={x.from} size="md" className="shadow-md" />
          <span className="text-xl font-black text-fg-muted">×</span>
          <ClubAvatar club={x.to} size="md" className="shadow-md" />
        </div>
        <p className="mt-2 text-sm"><b>{x.from.name}</b> <span className="text-fg-muted">mời</span> <b>{x.to.name}</b></p>
        <h3 className="mt-1 font-serif text-lg font-bold italic">“{x.title}”</h3>
      </div>
      <div className="space-y-2 border-t border-dashed border-border p-4 text-sm">
        <p className="flex items-start gap-2"><CalendarDays className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden /><span className="first-letter:uppercase">{fmtWhen(x.starts_at)}</span></p>
        <p className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
          {x.lat != null ? <a className="underline" href={`https://www.google.com/maps?q=${x.lat},${x.lng}`} target="_blank" rel="noopener noreferrer">{x.location_name}</a> : x.location_name}
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-fg-muted">
          <span className="flex items-center gap-1"><Timer className="size-4" aria-hidden />{x.duration_min} phút</span>
          {x.distance_km != null && <span className="flex items-center gap-1"><Route className="size-4" aria-hidden />{String(x.distance_km).replace('.', ',')} km</span>}
          {x.pace_text && <span>Pace {x.pace_text}</span>}
          {x.guest_capacity != null && <span className="flex items-center gap-1"><Users className="size-4" aria-hidden />Tối đa {x.guest_capacity} khách</span>}
        </div>
        {x.message && <p className="whitespace-pre-line rounded-xl bg-surface-2 p-3 italic">{x.message}</p>}
        <p className="text-xs text-fg-subtle">
          Gửi bởi {x.sender_name ?? 'ban quản trị'} · {new Date(x.created_at).toLocaleDateString('vi-VN')}
          {x.responded_at && ` · ${x.status === 'DECLINED' ? 'Từ chối' : 'Trả lời'} bởi ${x.responder_name ?? '—'}`}
        </p>
        {x.response_note && <p className="text-xs text-fg-muted">Ghi chú: {x.response_note}</p>}
      </div>
      {(mine || (staff && (x.status === 'PENDING' || canCancel))) && (
        <div className="space-y-2 border-t border-border p-3">
          {mine && x.status === 'ACCEPTED' && (
            <Link href={`${routes.club(clubId)}/events/${mine}`} className="block rounded-xl bg-brand py-2.5 text-center text-sm font-semibold text-brand-fg">
              Xem sự kiện & đăng ký tham gia
            </Link>
          )}
          {mode ? (
            <div className="space-y-2">
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300}
                placeholder={mode === 'accept' ? 'Lời nhắn (không bắt buộc): “Hẹn gặp cả nhà!”' : mode === 'decline' ? 'Lý do / đề xuất ngày khác (không bắt buộc)' : 'Lý do huỷ (bắt buộc)'} />
              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1" onClick={() => setMode(null)}>Thôi</Button>
                <Button className="flex-1" variant={mode === 'accept' ? 'primary' : 'danger'} loading={act.isPending}
                  disabled={mode === 'cancel' && note.trim().length < 3} onClick={() => act.mutate()}>
                  {mode === 'accept' ? 'Xác nhận nhận lời' : mode === 'decline' ? 'Gửi từ chối' : 'Huỷ giao lưu'}
                </Button>
              </div>
            </div>
          ) : staff && incoming && x.status === 'PENDING' ? (
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setMode('decline')}>Từ chối</Button>
              <Button className="flex-1" onClick={() => setMode('accept')}><Handshake className="size-4" aria-hidden />Nhận lời</Button>
            </div>
          ) : canCancel ? (
            <Button variant="ghost" block onClick={() => setMode('cancel')}>{x.status === 'PENDING' ? 'Rút thư mời' : 'Huỷ buổi giao lưu'}</Button>
          ) : null}
        </div>
      )}
    </article>
  )
}

function ComposeSheet({ clubId, clubName, onClose }: { clubId: string; clubName: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [term, setTerm] = useState('')
  const [to, setTo] = useState<{ id: string; name: string; avatar_url: string | null; accent_color?: string | null } | null>(null)
  const [title, setTitle] = useState('Chạy giao lưu cuối tuần')
  const [start, setStart] = useState(() => {
    const d = new Date(Date.now() + 7 * 24 * 3600_000)
    return toVnLocalInput(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), -2, 30)).toISOString())
  })
  const [duration, setDuration] = useState(90)
  const [place, setPlace] = useState('')
  const [coords, setCoords] = useState('')
  const [distance, setDistance] = useState('')
  const [pace, setPace] = useState('')
  const [capacity, setCapacity] = useState('')
  const [message, setMessage] = useState('')
  const debounced = useDebounced(term.trim())
  const found = useQuery({ queryKey: ['club-search', debounced], queryFn: () => searchClubs(debounced, 10), enabled: !to, placeholderData: keepPreviousData })
  const startIso = fromVnLocalInput(start)
  const ll = coords.trim() ? parseLatLng(coords) : null
  const valid = !!to && title.trim().length >= 3 && !!startIso && place.trim().length >= 2 && (!coords.trim() || !!ll)
  const send = useMutation({
    mutationFn: () => sendClubExchange(clubId, to!.id, {
      title: title.trim(), starts_at: startIso!, duration_min: duration, location_name: place.trim(), lat: ll?.lat ?? null, lng: ll?.lng ?? null,
      distance_km: distance ? Number(distance.replace(',', '.')) : null, pace_text: pace.trim() || null,
      guest_capacity: capacity ? Number(capacity) : null, message: message.trim() || null,
    }),
    onSuccess: () => { toast.success(`Đã gửi thư mời tới ${to!.name}`); void qc.invalidateQueries({ queryKey: ['club', clubId, 'exchanges'] }); onClose() },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  return (
    <Sheet open onClose={onClose} title="Gửi thư mời giao lưu" description={`Từ ${clubName}. Ban quản trị CLB được mời sẽ nhận thông báo và trả lời.`}
      footer={<Button block onClick={() => send.mutate()} loading={send.isPending} disabled={!valid}><Send className="size-4" aria-hidden />Gửi thư mời</Button>}>
      <div className="space-y-4">
        {to ? (
          <div className="flex items-center gap-3 rounded-xl border border-brand/50 bg-brand/10 p-3">
            <ClubAvatar club={to} size="sm" />
            <span className="flex-1 font-semibold">{to.name}</span>
            <Button size="sm" variant="ghost" onClick={() => setTo(null)}>Đổi</Button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
              <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Tìm CLB muốn mời" className="pl-9" aria-label="Tìm CLB muốn mời" />
            </div>
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {(found.data ?? []).filter((c) => c.id !== clubId).map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => setTo(c)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-2">
                    <ClubAvatar club={c} size="sm" />
                    <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{c.name}</span>
                      <span className="text-xs text-fg-subtle">{formatNumber(c.member_count)} thành viên</span></span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Field label="Tên buổi giao lưu" htmlFor="x-title">
          <Input id="x-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bắt đầu (giờ VN)" htmlFor="x-start" hint="Sớm nhất 2 giờ nữa">
            <Input id="x-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Thời lượng (phút)" htmlFor="x-dur">
            <Input id="x-dur" type="number" min={15} max={720} value={duration} onChange={(e) => setDuration(Number(e.target.value) || 90)} />
          </Field>
        </div>
        <Field label="Địa điểm tập trung" htmlFor="x-place">
          <Input id="x-place" value={place} maxLength={120} onChange={(e) => setPlace(e.target.value)} placeholder="VD: Cổng số 1 công viên Thống Nhất" />
        </Field>
        <Field label="Toạ độ / link Google Maps (không bắt buộc)" htmlFor="x-ll" error={coords.trim() && !ll ? 'Không đọc được toạ độ' : null}>
          <Input id="x-ll" value={coords} onChange={(e) => setCoords(e.target.value)} placeholder="21.0123, 105.8456" />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Cự ly (km)" htmlFor="x-km"><Input id="x-km" inputMode="decimal" value={distance} onChange={(e) => setDistance(e.target.value)} placeholder="10" /></Field>
          <Field label="Pace" htmlFor="x-pace"><Input id="x-pace" value={pace} maxLength={40} onChange={(e) => setPace(e.target.value)} placeholder="6:00–7:00" /></Field>
          <Field label="Số khách" htmlFor="x-cap"><Input id="x-cap" type="number" min={2} max={1000} value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="30" /></Field>
        </div>
        <Field label="Lời mời" htmlFor="x-msg">
          <Textarea id="x-msg" value={message} maxLength={1000} onChange={(e) => setMessage(e.target.value)}
            placeholder="VD: Chạy nhẹ 10 km quanh hồ, sau đó cà phê làm quen. CLB chủ nhà chuẩn bị nước và chụp ảnh chung." />
        </Field>
      </div>
    </Sheet>
  )
}
