'use client'

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'
import { LocateFixed, MapPin } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Field, Input, SegmentedControl } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { MAP_TILES } from '@/shared/config/map'
import { toCell, TTL } from '../model/nearby'

export interface PickedPlace { lat: number; lng: number; source: 'DEVICE' | 'AREA'; area: string | null; hours: 24 | 168 | 720 }

const HANOI = { lat: 21.0285, lng: 105.8542 }

/**
 * Chọn vị trí GẦN ĐÚNG: dùng vị trí điện thoại MỘT LẦN (độ chính xác thấp) hoặc chạm trên bản đồ.
 * Hiện vòng tròn ~1 km để người dùng thấy RaceHub chỉ lưu tới mức ô lưới, không lưu điểm chính xác.
 */
export function LocationPicker({ initialArea, onPick, busy, submitLabel = 'Dùng vị trí này' }: {
  initialArea?: string | null; onPick: (p: PickedPlace) => void; busy?: boolean; submitLabel?: string
}) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<import('leaflet').Map | null>(null)
  const marker = useRef<import('leaflet').Circle | null>(null)
  const [pos, setPos] = useState<{ lat: number; lng: number; source: 'DEVICE' | 'AREA' } | null>(null)
  const [area, setArea] = useState(initialArea ?? '')
  const [hours, setHours] = useState<24 | 168 | 720>(168)
  const [locating, setLocating] = useState(false)

  const place = (lat: number, lng: number, source: 'DEVICE' | 'AREA') => {
    const c = { lat: toCell(lat), lng: toCell(lng) }
    setPos({ ...c, source })
    void import('leaflet').then((L) => {
      if (!map.current) return
      marker.current?.remove()
      const brand = getComputedStyle(document.documentElement).getPropertyValue('--color-brand').trim() || '#b6ff3b'
      marker.current = L.circle([c.lat, c.lng], { radius: 700, color: brand, weight: 2, fillColor: brand, fillOpacity: 0.18 }).addTo(map.current)
      map.current.setView([c.lat, c.lng], Math.max(map.current.getZoom(), 13))
    })
  }

  useEffect(() => {
    let cancelled = false
    void import('leaflet').then((L) => {
      if (cancelled || !el.current || map.current) return
      map.current = L.map(el.current, { zoomControl: false, attributionControl: true }).setView([HANOI.lat, HANOI.lng], 11)
      L.tileLayer(MAP_TILES.url, {
        maxZoom: MAP_TILES.maxZoom, attribution: MAP_TILES.attribution, className: MAP_TILES.darken ? 'map-dark' : '',
      }).addTo(map.current)
      L.control.zoom({ position: 'bottomright' }).addTo(map.current)
      map.current.on('click', (e: import('leaflet').LeafletMouseEvent) => place(e.latlng.lat, e.latlng.lng, 'AREA'))
    })
    return () => { cancelled = true; map.current?.remove(); map.current = null }
  }, [])

  const locate = () => {
    if (!navigator.geolocation) { toast.error('Thiết bị không hỗ trợ định vị — hãy chạm trên bản đồ.'); return }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (p) => { place(p.coords.latitude, p.coords.longitude, 'DEVICE'); setLocating(false) },
      () => { setLocating(false); toast.error('Không lấy được vị trí. Bạn có thể chạm trên bản đồ để chọn khu vực.') },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 10 * 60_000 },
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={locate} loading={locating}><LocateFixed className="size-4" aria-hidden />Vị trí hiện tại (một lần)</Button>
      </div>
      <div className="relative">
        <div ref={el} className="isolate z-0 h-64 overflow-hidden rounded-2xl border border-border bg-[#0e1116]" role="application" aria-label="Chạm để chọn khu vực" />
        {!pos && (
          <p className="pointer-events-none absolute inset-x-3 top-3 z-[400] flex items-center gap-1.5 rounded-xl bg-bg/85 px-3 py-2 text-xs text-fg-muted backdrop-blur">
            <MapPin className="size-3.5 shrink-0" aria-hidden />Hoặc chạm lên bản đồ vào khu bạn hay chạy
          </p>
        )}
      </div>
      <p className="text-[11px] text-fg-muted">Vòng xanh là vùng ~1 km. RaceHub chỉ lưu tới mức ô lưới này — không lưu điểm chính xác, không theo dõi liên tục.</p>
      <Field label="Tên khu vực (không bắt buộc)" htmlFor="nb-area" hint="Ví dụ: Hồ Tây, Cầu Giấy, Công viên Gia Định">
        <Input id="nb-area" value={area} maxLength={60} onChange={(e) => setArea(e.target.value)} />
      </Field>
      <Field label="Hiện trong">
        <SegmentedControl value={String(hours)} onChange={(v) => setHours(Number(v) as 24 | 168 | 720)} options={TTL.map((t) => ({ value: String(t.hours), label: t.label }))} />
      </Field>
      <Button block disabled={!pos} loading={busy} className={cn(!pos && 'opacity-60')}
        onClick={() => pos && onPick({ ...pos, area: area.trim() || null, hours })}>{submitLabel}</Button>
    </div>
  )
}
