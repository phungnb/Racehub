'use client'

import dynamic from 'next/dynamic'
import { useEffect, useId, useMemo, useState } from 'react'
import { Clock, LocateFixed, Map as MapIcon, MapPin, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/shared/lib/cn'
import { matchesSearch } from '@/shared/lib/search'
import { currentPosition, positionIfAllowed, recentPlaces, rememberPlace, reversePlace, searchPlacesCached, type Place } from '@/shared/lib/geocode'
import { Input } from './Field'

const MapPickSheet = dynamic(() => import('./MapPickSheet'), { ssr: false })

type Row = { kind: 'locate' } | { kind: 'map' } | { kind: 'recent'; place: Place } | { kind: 'result'; place: Place }

/**
 * Ô tìm địa điểm dùng chung (kiểu app giao hàng):
 * • chạm vào là có ngay "Vị trí của tôi", "Chọn trên bản đồ" và các nơi đã chọn gần đây (lưu trên máy này);
 * • gõ 2 ký tự là gợi ý — nơi gần đây khớp hiện tức thì, kết quả tìm thêm hiện sau ~0,25 giây, ưu tiên chỗ gần mình;
 * • kết quả đã tìm được nhớ trong phiên, gõ lùi không phải chờ.
 */
export function PlaceSearch({ id, value, onChange, onPick, placeholder = 'Tìm địa điểm: công viên, hồ, đường…', near, locate = true, map = true,
  maxLength = 120, className, inputClassName, autoFocus }: {
  id?: string; value: string; onChange: (v: string) => void; onPick: (p: Place) => void; placeholder?: string
  near?: { lat: number; lng: number } | null; locate?: boolean; map?: boolean; maxLength?: number
  className?: string; inputClassName?: string; autoFocus?: boolean
}) {
  const auto = useId()
  const fid = id ?? `place-${auto}`
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState(false)
  const [results, setResults] = useState<Place[]>([])
  const [loading, setLoading] = useState(false)
  const [locating, setLocating] = useState(false)
  const [active, setActive] = useState(-1)
  const [recent, setRecent] = useState<Place[]>([])
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null)
  const [mapOpen, setMapOpen] = useState(false)
  const bias = near ?? here
  const q = value.trim()

  // Đã cho phép định vị từ trước → gợi ý ưu tiên gần mình (không bật hộp hỏi quyền bất ngờ)
  useEffect(() => { void positionIfAllowed().then(setHere) }, [])

  useEffect(() => {
    if (!typed || q.length < 2) return
    const ctl = new AbortController()
    const t = setTimeout(() => {
      setLoading(true)
      searchPlacesCached(q, bias, ctl.signal)
        .then((r) => { setResults(r); setActive(-1) })
        .catch(() => { if (!ctl.signal.aborted) setResults([]) })
        .finally(() => { if (!ctl.signal.aborted) setLoading(false) })
    }, 250)
    return () => { clearTimeout(t); ctl.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ tìm lại khi chữ gõ đổi
  }, [q, typed, bias?.lat, bias?.lng])

  const rows = useMemo<Row[]>(() => {
    const searching = typed && q.length >= 2
    const rec = recent.filter((p) => !searching || matchesSearch(q, p.name, p.address))
    const out: Row[] = []
    if (!searching && locate) out.push({ kind: 'locate' })
    if (!searching && map) out.push({ kind: 'map' })
    out.push(...rec.slice(0, searching ? 3 : 6).map((place) => ({ kind: 'recent' as const, place })))
    if (searching) {
      const seen = new Set(rec.map((p) => `${p.name}|${p.address}`))
      out.push(...results.filter((p) => !seen.has(`${p.name}|${p.address}`)).map((place) => ({ kind: 'result' as const, place })))
      if (map) out.push({ kind: 'map' })
    }
    return out
  }, [typed, q, recent, results, locate, map])

  const pick = (p: Place) => {
    rememberPlace(p)
    setTyped(false)
    setOpen(false)
    onChange(p.name.slice(0, maxLength))
    onPick(p)
  }

  const locateMe = async () => {
    setLocating(true)
    try {
      const p = await currentPosition()
      setHere(p)
      const r = await reversePlace(p.lat, p.lng).catch(() => null)
      pick({ name: r?.name ?? 'Vị trí của tôi', address: r?.address ?? '', lat: p.lat, lng: p.lng })
      toast.success(r ? `Đã lấy vị trí: ${r.name}` : 'Đã lấy vị trí hiện tại')
    } catch {
      toast.error('Không lấy được vị trí. Hãy bật định vị cho ứng dụng, gõ tên hoặc chọn trên bản đồ.')
    } finally { setLocating(false) }
  }

  const run = (r: Row) => {
    if (r.kind === 'locate') void locateMe()
    else if (r.kind === 'map') { setOpen(false); setMapOpen(true) }
    else pick(r.place)
  }

  const showList = open && rows.length > 0
  const searching = typed && q.length >= 2

  return (
    <div className={cn('relative', showList && 'z-[1000]', className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
        <Input id={fid} value={value} maxLength={maxLength} placeholder={placeholder} autoFocus={autoFocus}
          className={cn('pl-9', value ? 'pr-16' : 'pr-9', inputClassName)}
          role="combobox" aria-expanded={showList} aria-controls={`${fid}-list`} aria-autocomplete="list" autoComplete="off" enterKeyHint="search"
          onChange={(e) => { setTyped(true); setOpen(true); onChange(e.target.value) }}
          onFocus={() => { setRecent(recentPlaces()); setOpen(true) }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!showList) return
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(rows.length - 1, a + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
            else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); run(rows[active]) }
            else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
          }} />
        {(loading || locating) && <span className="absolute right-10 top-1/2 size-4 -translate-y-1/2 animate-spin rounded-full border-2 border-fg-subtle border-t-transparent" aria-hidden />}
        {value && (
          <button type="button" aria-label="Xoá chữ" onMouseDown={(e) => e.preventDefault()}
            onClick={() => { onChange(''); setTyped(true); setResults([]); setOpen(true); document.getElementById(fid)?.focus() }}
            className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-fg-subtle hover:bg-surface-2">
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      {showList && (
        <ul id={`${fid}-list`} role="listbox" aria-label="Gợi ý địa điểm"
          className="absolute inset-x-0 top-full z-[1000] mt-1 max-h-80 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-lg">
          {rows.map((r, i) => {
            const key = r.kind === 'recent' || r.kind === 'result' ? `${r.kind}-${r.place.name}-${r.place.lat}-${r.place.lng}` : `${r.kind}-${i}`
            const Icon = r.kind === 'locate' ? LocateFixed : r.kind === 'map' ? MapIcon : r.kind === 'recent' ? Clock : MapPin
            const title = r.kind === 'locate' ? 'Vị trí của tôi' : r.kind === 'map' ? 'Chọn trên bản đồ' : r.place.name
            const sub = r.kind === 'locate' ? 'Dùng GPS điện thoại, tự điền tên chỗ bạn đang đứng'
              : r.kind === 'map' ? 'Kéo bản đồ, đặt ghim đúng chỗ' : r.place.address
            return (
              <li key={key} role="option" aria-selected={i === active}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => run(r)}
                  className={cn('flex min-h-11 w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-surface-2', i === active && 'bg-surface-2')}>
                  <Icon className={cn('mt-0.5 size-4 shrink-0', r.kind === 'recent' ? 'text-fg-subtle' : 'text-brand')} aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{title}</span>
                    {sub && <span className="block truncate text-xs text-fg-subtle">{sub}</span>}
                  </span>
                </button>
              </li>
            )
          })}
          {searching && !loading && !rows.some((r) => r.kind === 'result' || r.kind === 'recent') && (
            <li className="px-3 py-2 text-xs text-fg-subtle">Chưa thấy “{q}”. Thử tên ngắn hơn (VD “hồ tây”), hoặc chọn trên bản đồ.</li>
          )}
        </ul>
      )}
      {map && <MapPickSheet open={mapOpen} onClose={() => setMapOpen(false)} onPick={pick} start={bias} />}
    </div>
  )
}
