'use client'

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'
import { LocateFixed, MapPin } from 'lucide-react'
import { toast } from 'sonner'
import { MAP_TILES } from '@/shared/config/map'
import { currentPosition, reversePlace, type Place } from '@/shared/lib/geocode'
import { Button } from './Button'
import { Sheet } from './Sheet'

const HANOI = { lat: 21.0285, lng: 105.8542 }

/**
 * Chọn trên bản đồ kiểu app giao hàng: ghim cố định giữa màn hình, kéo bản đồ cho ghim nằm đúng chỗ,
 * tên địa điểm tự hiện theo vị trí ghim. Nạp riêng (dynamic) để trang không có bản đồ không phải tải Leaflet.
 */
export default function MapPickSheet({ open, onClose, onPick, start, title = 'Chọn trên bản đồ' }: {
  open: boolean; onClose: () => void; onPick: (p: Place) => void; start?: { lat: number; lng: number } | null; title?: string
}) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<import('leaflet').Map | null>(null)
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null)
  const [label, setLabel] = useState<Place | null>(null)
  const [naming, setNaming] = useState(false)
  const [locating, setLocating] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    // Sheet vừa mở: đợi khung có kích thước rồi mới dựng bản đồ
    const t = setTimeout(() => {
      void import('leaflet').then((L) => {
        if (cancelled || !el.current || map.current) return
        const s = start ?? HANOI
        map.current = L.map(el.current, { zoomControl: false, attributionControl: true }).setView([s.lat, s.lng], start ? 16 : 12)
        L.tileLayer(MAP_TILES.url, { maxZoom: MAP_TILES.maxZoom, attribution: MAP_TILES.attribution, className: MAP_TILES.darken ? 'map-dark' : '' }).addTo(map.current)
        L.control.zoom({ position: 'bottomright' }).addTo(map.current)
        const sync = () => { const c = map.current?.getCenter(); if (c) setCenter({ lat: c.lat, lng: c.lng }) }
        map.current.on('moveend', sync)
        sync()
      })
    }, 60)
    return () => { cancelled = true; clearTimeout(t); map.current?.remove(); map.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dựng một lần mỗi lần mở
  }, [open])

  // Tên theo vị trí ghim (chờ người dùng dừng kéo)
  useEffect(() => {
    if (!center) return
    const ctl = new AbortController()
    const t = setTimeout(() => {
      setNaming(true)
      reversePlace(center.lat, center.lng, ctl.signal)
        .then((p) => { if (!ctl.signal.aborted) setLabel(p) })
        .catch(() => { if (!ctl.signal.aborted) setLabel(null) })
        .finally(() => { if (!ctl.signal.aborted) setNaming(false) })
    }, 450)
    return () => { clearTimeout(t); ctl.abort() }
  }, [center])

  const locate = async () => {
    setLocating(true)
    try {
      const p = await currentPosition()
      map.current?.setView([p.lat, p.lng], 17)
    } catch { toast.error('Không lấy được vị trí — hãy kéo bản đồ tới chỗ bạn muốn.') } finally { setLocating(false) }
  }

  const choose = () => {
    if (!center) return
    onPick({ name: label?.name ?? `Điểm ${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`, address: label?.address ?? '', lat: Number(center.lat.toFixed(6)), lng: Number(center.lng.toFixed(6)) })
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title={title} description="Kéo bản đồ để ghim nằm đúng chỗ, rồi bấm Chọn."
      footer={<Button block onClick={choose} disabled={!center}>Chọn điểm này</Button>}>
      <div className="space-y-3">
        <div className="relative">
          <div ref={el} className="isolate z-0 h-[46dvh] min-h-64 overflow-hidden rounded-2xl border border-border bg-[#0e1116]" role="application" aria-label="Bản đồ — kéo để di chuyển ghim" />
          <MapPin className="pointer-events-none absolute left-1/2 top-1/2 z-[500] size-9 -translate-x-1/2 -translate-y-full fill-brand text-bg drop-shadow-lg" aria-hidden />
          <button type="button" onClick={locate} disabled={locating} aria-label="Về vị trí của tôi"
            className="absolute left-3 top-3 z-[500] grid size-10 place-items-center rounded-full border border-border bg-surface shadow-lg disabled:opacity-60">
            <LocateFixed className={locating ? 'size-4 animate-pulse text-brand' : 'size-4 text-brand'} aria-hidden />
          </button>
        </div>
        <div className="flex min-h-12 items-start gap-2 rounded-xl bg-surface-2 px-3 py-2" aria-live="polite">
          <MapPin className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{naming ? 'Đang tìm tên địa điểm…' : label?.name ?? 'Điểm đã ghim'}</span>
            <span className="block truncate text-xs text-fg-subtle">{label?.address || (center ? `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}` : '')}</span>
          </span>
        </div>
      </div>
    </Sheet>
  )
}
