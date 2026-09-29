'use client'

import { useEffect, useState } from 'react'
import { LocateFixed, MapPin, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Input } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { currentPosition, positionIfAllowed, reversePlace, searchPlaces, type Place } from '@/shared/lib/geocode'
import { parseLatLng } from '../../model/events'

/**
 * Điểm hẹn: gõ tên → gợi ý địa điểm (có địa chỉ) → chọn là có luôn tọa độ. Nút "Vị trí của tôi" lấy GPS và tự điền tên.
 * Dán link Google Maps / tọa độ chỉ còn là lựa chọn nâng cao.
 */
export function PlaceField({ id = 'ev-place', place, onPlace, coords, onCoords, coordsError }: {
  id?: string; place: string; onPlace: (v: string) => void; coords: string; onCoords: (v: string) => void; coordsError?: string | null
}) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Place[]>([])
  const [loading, setLoading] = useState(false)
  const [locating, setLocating] = useState(false)
  const [advanced, setAdvanced] = useState(() => !!coords && !place)
  const [near, setNear] = useState<{ lat: number; lng: number } | null>(null)
  const [active, setActive] = useState(-1)
  const [typed, setTyped] = useState(false)
  const ll = coords.trim() ? parseLatLng(coords) : null

  // Nếu đã cho phép định vị từ trước: ưu tiên gợi ý gần chỗ mình (không hỏi quyền bất ngờ)
  useEffect(() => { void positionIfAllowed().then(setNear) }, [])

  useEffect(() => {
    const q = place.trim()
    if (!typed || q.length < 3) return
    const ctl = new AbortController()
    const t = setTimeout(() => {
      setLoading(true)
      searchPlaces(q, near ?? ll, ctl.signal)
        .then((r) => { setItems(r); setActive(-1); setOpen(true) })
        .catch(() => { if (!ctl.signal.aborted) setItems([]) })
        .finally(() => { if (!ctl.signal.aborted) setLoading(false) })
    }, 350)
    return () => { clearTimeout(t); ctl.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ tìm lại khi chữ gõ đổi
  }, [place, near, typed])

  const pick = (p: Place) => {
    setTyped(false)
    onPlace(p.name.slice(0, 120))
    onCoords(`${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`)
    setOpen(false)
  }

  const locate = async () => {
    setLocating(true)
    try {
      const p = await currentPosition()
      setNear(p)
      onCoords(`${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`)
      const r = await reversePlace(p.lat, p.lng).catch(() => null)
      if (r && !place.trim()) { setTyped(false); onPlace(r.name.slice(0, 120)) }
      toast.success(r ? `Đã lấy vị trí: ${r.name}` : 'Đã lấy vị trí hiện tại')
    } catch {
      toast.error('Không lấy được vị trí. Hãy bật định vị cho ứng dụng hoặc gõ tên địa điểm.')
    } finally { setLocating(false) }
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
            <Input id={id} value={place} maxLength={120} placeholder="Tìm: Công viên Thống Nhất, Hồ Gươm…" className="pl-9"
              role="combobox" aria-expanded={open && items.length > 0} aria-controls={`${id}-list`} aria-autocomplete="list" autoComplete="off"
              onChange={(e) => { setTyped(true); onPlace(e.target.value) }}
              onFocus={() => items.length && setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              onKeyDown={(e) => {
                if (!open || !items.length) return
                if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
                else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(items[active]) }
                else if (e.key === 'Escape') setOpen(false)
              }} />
            {loading && <span className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin rounded-full border-2 border-fg-subtle border-t-transparent" aria-hidden />}
          </div>
          <Button variant="secondary" className="shrink-0" onClick={locate} loading={locating} aria-label="Dùng vị trí hiện tại">
            <LocateFixed className="size-4" aria-hidden /><span className="hidden min-[380px]:inline">Vị trí của tôi</span>
          </Button>
        </div>
        {open && typed && place.trim().length >= 3 && !loading && (
          <ul id={`${id}-list`} role="listbox" aria-label="Gợi ý địa điểm"
            className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-lg">
            {items.length ? items.map((p, i) => (
              <li key={`${p.name}-${p.lat}-${p.lng}`} role="option" aria-selected={i === active}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)}
                  className={cn('flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-surface-2', i === active && 'bg-surface-2')}>
                  <MapPin className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{p.name}</span>
                    {p.address && <span className="block truncate text-xs text-fg-subtle">{p.address}</span>}
                  </span>
                </button>
              </li>
            )) : <li className="px-3 py-2.5 text-sm text-fg-subtle">Không thấy địa điểm. Thử tên khác, hoặc bấm “Vị trí của tôi”.</li>}
          </ul>
        )}
      </div>

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
