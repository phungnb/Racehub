/**
 * Tìm địa điểm có gợi ý (không cần API key): Photon (dữ liệu OpenStreetMap), giới hạn trong Việt Nam,
 * ưu tiên chỗ gần vị trí hiện tại nếu có. Chỉ gửi đi chữ đang gõ / tọa độ — không gửi thông tin người dùng.
 */
export interface Place { name: string; address: string; lat: number; lng: number }

const API = 'https://photon.komoot.io'
const VN_BBOX = '102.1,8.2,109.6,23.4'

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] }
  properties?: Record<string, string | undefined>
}

/** GeoJSON của Photon → danh sách địa điểm gọn (bỏ trùng, bỏ chỗ ngoài Việt Nam) */
export function toPlaces(json: { features?: PhotonFeature[] } | null | undefined): Place[] {
  const seen = new Set<string>()
  const out: Place[] = []
  for (const f of json?.features ?? []) {
    const c = f.geometry?.coordinates
    const p = f.properties ?? {}
    if (!c || (p.countrycode && p.countrycode !== 'VN')) continue
    const street = [p.housenumber, p.street].filter(Boolean).join(' ')
    const name = p.name ?? street
    if (!name) continue
    const address = [p.name ? street : '', p.district ?? p.locality, p.city ?? p.county, p.state]
      .filter((x, i, a) => x && x !== name && a.indexOf(x) === i).join(', ')
    const key = `${name}|${address}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name, address, lat: c[1], lng: c[0] })
  }
  return out
}

export async function searchPlaces(q: string, near?: { lat: number; lng: number } | null, signal?: AbortSignal): Promise<Place[]> {
  const u = new URL(`${API}/api/`)
  u.searchParams.set('q', q)
  u.searchParams.set('limit', '8')
  u.searchParams.set('bbox', VN_BBOX)
  if (near) { u.searchParams.set('lat', near.lat.toFixed(4)); u.searchParams.set('lon', near.lng.toFixed(4)) }
  const r = await fetch(u, { signal })
  if (!r.ok) throw new Error('GEOCODE_FAILED')
  return toPlaces(await r.json())
}

export async function reversePlace(lat: number, lng: number, signal?: AbortSignal): Promise<Place | null> {
  const u = new URL(`${API}/reverse`)
  u.searchParams.set('lat', String(lat))
  u.searchParams.set('lon', String(lng))
  const r = await fetch(u, { signal })
  if (!r.ok) return null
  const p = toPlaces(await r.json())[0]
  return p ? { ...p, lat, lng } : null
}

/** Vị trí hiện tại (độ chính xác cao) */
export function currentPosition(timeout = 10_000): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { reject(new Error('NO_GEOLOCATION')); return }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) }),
      reject, { enableHighAccuracy: true, timeout, maximumAge: 60_000 },
    )
  })
}

/** Chỉ lấy vị trí khi người dùng ĐÃ cho phép trước đó (không bật hộp hỏi quyền bất ngờ) */
export async function positionIfAllowed(): Promise<{ lat: number; lng: number } | null> {
  try {
    const s = await navigator.permissions?.query({ name: 'geolocation' as PermissionName })
    if (s?.state !== 'granted') return null
    return await currentPosition(8_000)
  } catch { return null }
}

// ---------------------------------------------------------------------
// Gợi ý nhanh kiểu app giao hàng: nơi đã chọn gần đây (chỉ lưu trên máy này) + nhớ kết quả tìm trong phiên
// ---------------------------------------------------------------------
const RECENT_KEY = 'rh.recentPlaces'
const RECENT_MAX = 8

/** Thêm địa điểm lên đầu danh sách gần đây, bỏ bản trùng (cùng tên + gần như cùng chỗ), giữ tối đa `max` */
export function mergeRecent(list: Place[], p: Place, max = RECENT_MAX): Place[] {
  const same = (a: Place) => a.name === p.name && Math.abs(a.lat - p.lat) < 0.0005 && Math.abs(a.lng - p.lng) < 0.0005
  return [p, ...list.filter((a) => !same(a))].slice(0, max)
}

export function recentPlaces(): Place[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((p): p is Place => !!p && typeof p.name === 'string' && Number.isFinite(p.lat) && Number.isFinite(p.lng)).slice(0, RECENT_MAX) : []
  } catch { return [] }
}

export function rememberPlace(p: Place) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(mergeRecent(recentPlaces(), { name: p.name, address: p.address, lat: p.lat, lng: p.lng }))) } catch { /* chế độ riêng tư */ }
}

export function forgetRecentPlaces() {
  try { localStorage.removeItem(RECENT_KEY) } catch { /* bỏ qua */ }
}

const cache = new Map<string, Place[]>()
/** Như searchPlaces nhưng nhớ kết quả trong phiên (gõ lùi / gõ lại không phải chờ mạng) */
export async function searchPlacesCached(q: string, near?: { lat: number; lng: number } | null, signal?: AbortSignal): Promise<Place[]> {
  const key = `${q.trim().toLowerCase()}|${near ? `${near.lat.toFixed(2)},${near.lng.toFixed(2)}` : ''}`
  const hit = cache.get(key)
  if (hit) return hit
  const r = await searchPlaces(q.trim(), near, signal)
  if (cache.size > 100) cache.delete(cache.keys().next().value as string)
  cache.set(key, r)
  return r
}
