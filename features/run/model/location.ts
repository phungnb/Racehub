// Nguồn vị trí cho bộ ghi bài chạy.
// - App cài (iOS / Android): plugin background-geolocation — vẫn ghi khi tắt màn hình / bỏ túi
//   (Android hiện thông báo cố định "RaceHub đang ghi bài chạy", iOS hiện chấm xanh vị trí).
// - Trình duyệt: navigator.geolocation — chỉ ghi khi màn hình còn bật.
import { registerPlugin } from '@capacitor/core'
import type { BackgroundGeolocationPlugin, Location } from '@capacitor-community/background-geolocation'
import { isNativeApp } from '@/shared/lib/native'

export interface LocationFix {
  latitude: number
  longitude: number
  accuracy: number
  altitude: number | null
  speed: number | null
  /** ms since epoch */
  time: number
}
export interface LocationError { denied: boolean; message: string }

/** Bắt đầu theo dõi vị trí; trả về hàm dừng. */
export type LocationWatch = (onFix: (f: LocationFix) => void, onError: (e: LocationError) => void) => () => void

let plugin: BackgroundGeolocationPlugin | null = null
const bg = () => (plugin ??= registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation'))

/** Điểm từ plugin native → LocationFix; điểm do app giả lập GPS tạo ra thì bỏ (chống gian lận) */
export function fromNative(l: Location): LocationFix | null {
  if (l.simulated) return null
  return { latitude: l.latitude, longitude: l.longitude, accuracy: l.accuracy, altitude: l.altitude, speed: l.speed, time: l.time || Date.now() }
}

const watchNative: LocationWatch = (onFix, onError) => {
  let id: string | null = null
  let stopped = false
  bg().addWatcher({
    backgroundTitle: 'RaceHub đang ghi bài chạy',
    backgroundMessage: 'Bấm để mở RaceHub. Kết thúc bài chạy trong app để dừng ghi.',
    requestPermissions: true,
    stale: false,
    distanceFilter: 0,
  }, (loc, err) => {
    if (err) { onError({ denied: err.code === 'NOT_AUTHORIZED', message: err.message }); return }
    const f = loc ? fromNative(loc) : null
    if (f) onFix(f)
  }).then((wid) => {
    if (stopped) void bg().removeWatcher({ id: wid })
    else id = wid
  }, (e: unknown) => onError({ denied: false, message: String((e as Error)?.message ?? e) }))
  return () => {
    stopped = true
    if (id) void bg().removeWatcher({ id })
    id = null
  }
}

const watchWeb: LocationWatch = (onFix, onError) => {
  const id = navigator.geolocation.watchPosition(
    (p) => onFix({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy,
      altitude: p.coords.altitude, speed: p.coords.speed, time: p.timestamp || Date.now() }),
    (e) => onError({ denied: e.code === e.PERMISSION_DENIED, message: e.message }),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 })
  return () => navigator.geolocation.clearWatch(id)
}

export const watchLocation: LocationWatch = (onFix, onError) => (isNativeApp() ? watchNative : watchWeb)(onFix, onError)
export const canTrackLocation = () => isNativeApp() || (typeof navigator !== 'undefined' && 'geolocation' in navigator)
/** Có ghi được khi tắt màn hình không (chỉ trong app cài) */
export const tracksInBackground = () => isNativeApp()

/** Mở trang cài đặt quyền của app (khi người dùng đã từ chối quyền vị trí) */
export const openLocationSettings = () => { if (isNativeApp()) void bg().openSettings() }
