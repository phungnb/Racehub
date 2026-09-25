'use client'

import { useState } from 'react'
import { LocateFixed } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Field, Input, Sheet, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { EventVisibilityToggle, nearbyErrorMessage, setEventVisibility, type EventVisibility } from '@/features/nearby'
import { createEvent, eventsErrorMessage, updateEvent, type ClubEvent, type EventInput } from '../../api/eventsApi'
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
  const [distance, setDistance] = useState(event?.distance_km ? String(event.distance_km) : '')
  const [pace, setPace] = useState(event?.pace_text ?? '')
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

  const save = useClubMutation(clubId, (input: EventInput) => (event ? updateEvent(event.id, input) : createEvent(clubId, input)))
  const submit = async () => {
    if (problems.length || !startIso) return
    try {
      const saved = await save.mutateAsync({
        title: title.trim(), starts_at: startIso, duration_min: duration, location_name: place.trim() || null,
        lat: ll?.lat ?? null, lng: ll?.lng ?? null, distance_km: distance ? Number(distance.replace(',', '.')) : null,
        pace_text: pace.trim() || null, capacity: capacity ? Number(capacity) : null, description: desc.trim() || null,
      })
      if (visibility !== (event?.visibility ?? 'CLUB')) {
        try { await setEventVisibility(saved.id, visibility) } catch (e) { toast.error(nearbyErrorMessage(e)) }
      }
      toast.success(event ? 'Đã lưu sự kiện' : visibility === 'PUBLIC' ? 'Đã tạo buổi chạy công khai' : 'Đã tạo sự kiện và báo cho thành viên')
      onSaved?.({ ...saved, visibility })
      onClose()
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

  return (
    <Sheet open={open} onClose={onClose} title={event ? 'Sửa sự kiện' : 'Tạo sự kiện chạy nhóm'}
      description={event ? undefined : 'Thành viên CLB nhận thông báo ngay'}
      footer={<Button block onClick={submit} loading={save.isPending} disabled={problems.length > 0}>{event ? 'Lưu' : 'Tạo sự kiện'}</Button>}>
      <div className="space-y-4">
        <Field label="Tên sự kiện" htmlFor="ev-title">
          <Input id="ev-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Chạy dài Chủ nhật" />
        </Field>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Field label="Bắt đầu (giờ VN)" htmlFor="ev-start" error={problems.includes('start') ? 'Chọn ngày giờ' : null}>
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
        <Field label="Tọa độ (không bắt buộc)" htmlFor="ev-ll" error={problems.includes('coords') ? 'Dán link Google Maps hoặc "21.05, 105.82"' : null}
          hint="Có tọa độ thì bài chạy xuất phát trong 500 m quanh điểm hẹn sẽ tự điểm danh">
          <div className="flex gap-2">
            <Input id="ev-ll" value={coords} onChange={(e) => setCoords(e.target.value)} placeholder="Dán link Google Maps" />
            <Button variant="secondary" className="shrink-0" onClick={locate} loading={locating} aria-label="Dùng vị trí hiện tại">
              <LocateFixed className="size-4" aria-hidden />
            </Button>
          </div>
        </Field>
        <EventVisibilityToggle value={visibility} onChange={setVisibility} hasCoords={!!ll} />
        <div className="grid grid-cols-3 gap-2">
          <Field label="Cự ly (km)" htmlFor="ev-km">
            <Input id="ev-km" inputMode="decimal" value={distance} onChange={(e) => setDistance(e.target.value.replace(/[^\d.,]/g, '').slice(0, 5))} placeholder="10" />
          </Field>
          <Field label="Pace nhóm" htmlFor="ev-pace">
            <Input id="ev-pace" value={pace} onChange={(e) => setPace(e.target.value)} maxLength={40} placeholder="6:00–6:30" />
          </Field>
          <Field label="Tối đa" htmlFor="ev-cap">
            <Input id="ev-cap" inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="Không" />
          </Field>
        </div>
        <Field label="Ghi chú" htmlFor="ev-desc">
          <Textarea id="ev-desc" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={1000} rows={3}
            placeholder="Mang nước, gửi xe ở cổng số 2…" className={cn('min-h-20')} />
        </Field>
      </div>
    </Sheet>
  )
}
