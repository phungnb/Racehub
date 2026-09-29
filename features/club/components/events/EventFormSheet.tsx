'use client'

import { useState } from 'react'
import { Copy, LocateFixed, Plus, Share2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Field, Input, Sheet, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { EventVisibilityToggle, nearbyErrorMessage, setEventVisibility, type EventVisibility } from '@/features/nearby'
import { createEvent, eventRoutes, eventsErrorMessage, updateEvent, type ClubEvent, type EventInput } from '../../api/eventsApi'
import { useClubMutation } from '../../hooks/useEvents'
import { fromVnLocalInput, parseLatLng, toVnLocalInput } from '../../model/events'

const DURATIONS = [60, 90, 120, 180]

/** Tạo / sửa sự kiện chạy nhóm (ban quản trị) */
export function EventFormSheet({ clubId, event, open, onClose, onSaved }: {
  clubId: string; event?: ClubEvent | null; open: boolean; onClose: () => void; onSaved?: (e: ClubEvent) => void
}) {
  const defaultStart = () => {
    const d = new Date(Date.now() + 24 * 3600_000)
    return toVnLocalInput(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), -2, 30)).toISOString())   // 5:30 sáng mai (giờ VN)
  }
  const [title, setTitle] = useState(event?.title ?? '')
  const [start, setStart] = useState(() => (event ? toVnLocalInput(event.starts_at) : defaultStart()))
  const [duration, setDuration] = useState(event?.duration_min ?? 90)
  const [place, setPlace] = useState(event?.location_name ?? '')
  const [coords, setCoords] = useState(event?.lat != null ? `${event.lat}, ${event.lng}` : '')
  // Nhiều cự ly: mỗi dòng một cự ly + pace nhóm (VD 5 km · 7:00, 10 km · 6:00)
  const [routes, setRoutes] = useState<{ km: string; pace: string }[]>(() => {
    const r = event ? eventRoutes(event) : []
    return r.length ? r.map((x) => ({ km: x.km ? String(x.km).replace('.', ',') : '', pace: x.pace ?? '' })) : [{ km: '', pace: '' }]
  })
  const [showErrors, setShowErrors] = useState(false)
  const [created, setCreated] = useState<ClubEvent | null>(null)
  const [capacity, setCapacity] = useState(event?.capacity ? String(event.capacity) : '')
  const [desc, setDesc] = useState(event?.description ?? '')
  const [locating, setLocating] = useState(false)
  const [visibility, setVisibility] = useState<EventVisibility>(event?.visibility ?? 'CLUB')

  const ll = coords.trim() ? parseLatLng(coords) : null
  const startIso = fromVnLocalInput(start)
  const problems: string[] = []
  if (title.trim().length < 3) problems.push('title')
  if (!startIso) problems.push('start')
  if (coords.trim() && !ll) problems.push('coords')
  if (visibility === 'PUBLIC' && !ll) problems.push('public')
  const kmOf = (v: string) => Number(v.replace(',', '.'))
  if (routes.some((r) => r.km.trim() && !(kmOf(r.km) > 0 && kmOf(r.km) <= 200))) problems.push('routes')
  const err = (k: string, msg: string) => (showErrors && problems.includes(k) ? msg : null)
  const MESSAGES: Record<string, string> = {
    title: 'Tên sự kiện cần ít nhất 3 ký tự', start: 'Chọn ngày giờ bắt đầu', coords: 'Tọa độ chưa đúng',
    public: 'Buổi chạy công khai cần tọa độ điểm hẹn', routes: 'Cự ly từ 0,1 đến 200 km',
  }

  const save = useClubMutation(clubId, (input: EventInput) => (event ? updateEvent(event.id, input) : createEvent(clubId, input)))
  const submit = async () => {
    // Không khóa nút âm thầm: bấm là chỉ rõ ô nào còn thiếu
    if (problems.length || !startIso) {
      setShowErrors(true)
      toast.error(MESSAGES[problems[0]] ?? 'Kiểm tra lại các ô được đánh dấu.')
      return
    }
    const clean = routes.filter((r) => r.km.trim()).map((r) => ({ km: kmOf(r.km), pace: r.pace.trim() || null }))
    try {
      const saved = await save.mutateAsync({
        title: title.trim(), starts_at: startIso, duration_min: duration, location_name: place.trim() || null,
        lat: ll?.lat ?? null, lng: ll?.lng ?? null, distance_km: clean[0]?.km ?? null,
        pace_text: clean[0]?.pace ?? (routes[0]?.pace.trim() || null), routes: clean,
        capacity: capacity ? Number(capacity) : null, description: desc.trim() || null,
      })
      if (visibility !== (event?.visibility ?? 'CLUB')) {
        try { await setEventVisibility(saved.id, visibility) } catch (e) { toast.error(nearbyErrorMessage(e)) }
      }
      toast.success(event ? 'Đã lưu sự kiện' : visibility === 'PUBLIC' ? 'Đã tạo buổi chạy công khai' : 'Đã tạo sự kiện và báo cho thành viên')
      onSaved?.({ ...saved, visibility })
      // Tạo mới: đưa link tham gia để gửi vào nhóm Zalo / Messenger
      if (event) onClose()
      else setCreated({ ...saved, visibility })
    } catch (e) {
      toast.error(eventsErrorMessage(e))
    }
  }

  const locate = () => {
    if (!navigator.geolocation) { toast.error('Máy không hỗ trợ định vị.'); return }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (p) => { setCoords(`${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`); setLocating(false) },
      () => { toast.error('Không lấy được vị trí. Hãy dán link Google Maps.'); setLocating(false) },
      { enableHighAccuracy: true, timeout: 10_000 },
    )
  }

  if (created) return <EventLinkSheet event={created} onClose={() => { setCreated(null); onClose() }} />

  return (
    <Sheet open={open} onClose={onClose} title={event ? 'Sửa sự kiện' : 'Tạo sự kiện chạy nhóm'}
      description={event ? 'Đổi giờ, điểm hẹn hay cự ly: cả CLB được báo' : 'Cả CLB nhận thông báo ngay'}
      footer={<Button block onClick={submit} loading={save.isPending}>{event ? 'Lưu' : 'Tạo sự kiện'}</Button>}>
      <div className="space-y-4">
        <Field label="Tên sự kiện" htmlFor="ev-title" error={err('title', MESSAGES.title)}>
          <Input id="ev-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Chạy dài Chủ nhật" />
        </Field>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Field label="Bắt đầu (giờ VN)" htmlFor="ev-start" error={err('start', MESSAGES.start)}>
            <Input id="ev-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Kéo dài" htmlFor="ev-dur">
            <select id="ev-dur" value={duration} onChange={(e) => setDuration(Number(e.target.value))}
              className="h-11 rounded-xl border border-border bg-bg px-3 text-[15px]">
              {DURATIONS.map((d) => <option key={d} value={d}>{d < 120 ? `${d} phút` : `${d / 60} giờ`}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Điểm hẹn" htmlFor="ev-place">
          <Input id="ev-place" value={place} onChange={(e) => setPlace(e.target.value)} maxLength={120} placeholder="Cổng công viên Thống Nhất" />
        </Field>
        <Field label={visibility === 'PUBLIC' ? 'Tọa độ điểm hẹn' : 'Tọa độ (không bắt buộc)'} htmlFor="ev-ll"
          error={problems.includes('coords') ? 'Dán link Google Maps hoặc "21.05, 105.82"' : err('public', MESSAGES.public)}
          hint="Có tọa độ thì bài chạy xuất phát trong 500 m quanh điểm hẹn sẽ tự điểm danh">
          <div className="flex gap-2">
            <Input id="ev-ll" value={coords} onChange={(e) => setCoords(e.target.value)} placeholder="Dán link Google Maps" />
            <Button variant="secondary" className="shrink-0" onClick={locate} loading={locating} aria-label="Dùng vị trí hiện tại">
              <LocateFixed className="size-4" aria-hidden />
            </Button>
          </div>
        </Field>
        <EventVisibilityToggle value={visibility} onChange={setVisibility} hasCoords={!!ll} />
        {visibility === 'PUBLIC' && !ll && (
          <p role="alert" className="-mt-2 text-xs text-warning">Buổi chạy công khai cần tọa độ điểm hẹn: dán link Google Maps hoặc bấm nút định vị ở trên. Không có tọa độ thì chọn “Chỉ thành viên”.</p>
        )}
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-sm font-medium">Cự ly & pace nhóm</legend>
          {routes.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="relative w-28 shrink-0">
                <Input aria-label={`Cự ly ${i + 1} (km)`} inputMode="decimal" value={r.km} placeholder={['10', '5', '21'][i] ?? 'km'} className="pr-9"
                  onChange={(e) => setRoutes(routes.map((x, j) => (j === i ? { ...x, km: e.target.value.replace(/[^\d.,]/g, '').slice(0, 5) } : x)))} />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-fg-subtle">km</span>
              </div>
              <Input aria-label={`Pace nhóm cự ly ${i + 1}`} value={r.pace} maxLength={40} placeholder="Pace, vd 6:00–6:30"
                onChange={(e) => setRoutes(routes.map((x, j) => (j === i ? { ...x, pace: e.target.value } : x)))} />
              {routes.length > 1 && (
                <button type="button" aria-label={`Bỏ cự ly ${i + 1}`} onClick={() => setRoutes(routes.filter((_, j) => j !== i))}
                  className="grid size-11 shrink-0 place-items-center rounded-xl text-fg-subtle hover:bg-surface-2"><X className="size-4" aria-hidden /></button>
              )}
            </div>
          ))}
          {err('routes', MESSAGES.routes) && <p role="alert" className="text-xs text-danger">{MESSAGES.routes}</p>}
          {routes.length < 6 && (
            <Button type="button" size="sm" variant="secondary" onClick={() => setRoutes([...routes, { km: '', pace: '' }])}>
              <Plus className="size-4" aria-hidden />Thêm cự ly
            </Button>
          )}
        </fieldset>
        <Field label="Số người tối đa" htmlFor="ev-cap" hint="Để trống nếu không giới hạn">
          <Input id="ev-cap" inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="Không giới hạn" />
        </Field>
        <Field label="Ghi chú" htmlFor="ev-desc">
          <Textarea id="ev-desc" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={1000} rows={3}
            placeholder="Mang nước, gửi xe ở cổng số 2…" className={cn('min-h-20')} />
        </Field>
      </div>
    </Sheet>
  )
}

/** Sau khi tạo: link tham gia để gửi vào nhóm (thành viên mở là thấy, bấm Tham gia) */
function EventLinkSheet({ event, onClose }: { event: ClubEvent; onClose: () => void }) {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const link = event.visibility === 'PUBLIC' ? `${origin}/nearby/events/${event.id}` : `${origin}/clubs/${event.club_id}/events/${event.id}`
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); toast.success('Đã sao chép link tham gia') } catch { toast.error('Không sao chép được, hãy chọn và sao chép thủ công.') }
  }
  const share = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: event.title, text: `Cùng chạy "${event.title}" nhé!`, url: link }) } catch { /* người dùng hủy */ }
    } else void copy()
  }
  return (
    <Sheet open onClose={onClose} title="Đã tạo sự kiện 🎉"
      description={event.visibility === 'PUBLIC' ? 'Ai có link cũng xem và đăng ký tham gia được.' : 'Cả CLB đã nhận thông báo. Gửi thêm link vào nhóm chat để mọi người bấm Tham gia.'}
      footer={<Button block variant="secondary" onClick={onClose}>Xong</Button>}>
      <div className="space-y-3">
        <p className="font-semibold">{event.title}</p>
        <p className="break-all rounded-xl border border-border bg-bg p-3 font-mono text-sm">{link}</p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={copy}><Copy className="size-4" aria-hidden />Sao chép</Button>
          <Button onClick={share}><Share2 className="size-4" aria-hidden />Chia sẻ</Button>
        </div>
      </div>
    </Sheet>
  )
}
