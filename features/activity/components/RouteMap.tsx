'use client'

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { MAP_TILES } from '@/shared/config/map'
import type { LatLng } from '../model/route'

/**
 * Bản đồ tuyến chạy (Leaflet + nền OpenStreetMap, xem shared/config/map.ts).
 * Leaflet chỉ nạp ở trình duyệt khi màn hình mở, không làm nặng các trang khác.
 */
export function RouteMap({ route, className }: { route: LatLng[]; className?: string }) {
  const el = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!el.current || route.length < 2) return
    let map: import('leaflet').Map | null = null
    let cancelled = false
    import('leaflet').then((L) => {
      if (cancelled || !el.current) return
      map = L.map(el.current, { zoomControl: false, attributionControl: true, scrollWheelZoom: false })
      L.tileLayer(MAP_TILES.url, {
        maxZoom: MAP_TILES.maxZoom, attribution: MAP_TILES.attribution, className: MAP_TILES.darken ? 'map-dark' : '',
      }).addTo(map)
      const brand = getComputedStyle(document.documentElement).getPropertyValue('--color-brand').trim() || '#b6ff3b'
      // Viền tối dưới tuyến cho dễ nhìn trên nền bản đồ
      L.polyline(route, { color: '#000', weight: 7, opacity: 0.45 }).addTo(map)
      const line = L.polyline(route, { color: brand, weight: 4, opacity: 1, lineJoin: 'round' }).addTo(map)
      const dot = (p: LatLng, fill: string) => L.circleMarker(p, { radius: 7, color: '#0a0d12', weight: 3, fillColor: fill, fillOpacity: 1 }).addTo(map!)
      dot(route[0], brand)
      dot(route[route.length - 1], '#ff4d4f')
      map.fitBounds(line.getBounds(), { padding: [24, 24] })
      L.control.zoom({ position: 'bottomright' }).addTo(map)
    }).catch(() => setFailed(true))
    return () => { cancelled = true; map?.remove() }
  }, [route])

  if (failed) return <div className={cn('grid place-items-center bg-surface-2 text-sm text-fg-muted', className)}>Không tải được bản đồ</div>
  return <div ref={el} className={cn('isolate z-0 bg-[#0e1116]', className)} role="img" aria-label="Bản đồ tuyến chạy" />
}
