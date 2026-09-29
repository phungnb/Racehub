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
