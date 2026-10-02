'use client'

import { useState } from 'react'
import { MapPin, X } from 'lucide-react'
import { Input, PlaceSearch } from '@/shared/ui'
import { parseLatLng } from '../../model/events'

/**
 * Điểm hẹn: gõ tên → gợi ý địa điểm (có địa chỉ) → chọn là có luôn tọa độ. Chạm ô là có "Vị trí của tôi",
 * "Chọn trên bản đồ" (kéo ghim) và nơi đã chọn gần đây. Dán link Google Maps / tọa độ chỉ còn là lựa chọn nâng cao.
 */
export function PlaceField({ id = 'ev-place', place, onPlace, coords, onCoords, coordsError }: {
  id?: string; place: string; onPlace: (v: string) => void; coords: string; onCoords: (v: string) => void; coordsError?: string | null
}) {
  const [advanced, setAdvanced] = useState(() => !!coords && !place)
  const ll = coords.trim() ? parseLatLng(coords) : null

  return (
    <div className="space-y-2">
      <PlaceSearch id={id} value={place} onChange={onPlace} near={ll} placeholder="Tìm: Công viên Thống Nhất, Hồ Gươm…"
        onPick={(p) => onCoords(`${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`)} />

      {ll ? (
        <div className="flex items-center gap-2 rounded-xl bg-success/10 px-3 py-2 text-xs">
          <MapPin className="size-4 shrink-0 text-success" aria-hidden />
          <span className="min-w-0 flex-1">Đã có tọa độ điểm hẹn <span className="font-mono text-fg-subtle">{ll.lat.toFixed(5)}, {ll.lng.toFixed(5)}</span></span>
          <a href={`https://www.openstreetmap.org/?mlat=${ll.lat}&mlon=${ll.lng}#map=17/${ll.lat}/${ll.lng}`} target="_blank" rel="noreferrer" className="font-semibold text-brand">Xem</a>
          <button type="button" aria-label="Bỏ tọa độ" onClick={() => onCoords('')} className="grid size-7 place-items-center rounded-full text-fg-subtle hover:bg-surface-2">
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      ) : null}

      {advanced ? (
        <div className="space-y-1">
          <Input id={`${id}-ll`} value={coords} onChange={(e) => onCoords(e.target.value)} placeholder='Dán link Google Maps hoặc "21.05, 105.82"' aria-label="Link Google Maps hoặc tọa độ" />
          {coordsError && <p role="alert" className="text-xs text-danger">{coordsError}</p>}
        </div>
      ) : (
        <button type="button" onClick={() => setAdvanced(true)} className="text-xs font-semibold text-fg-muted underline-offset-2 hover:underline">
          Nâng cao: dán link Google Maps / tọa độ
        </button>
      )}
    </div>
  )
}
