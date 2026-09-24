// Tiện ích Web Push phía trình duyệt (không phụ thuộc React để test được)

/** Khóa VAPID dạng base64url → mảng byte cho pushManager.subscribe */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export type PushSupport =
  | 'ok'
  | 'no-key'             // máy chủ chưa có khóa VAPID
  | 'dev'                // đang chạy next dev (không đăng ký service worker)
  | 'ios-install'        // iPhone: phải cài app lên màn hình chính trước (iOS 16.4+)
  | 'unsupported'        // trình duyệt không hỗ trợ

export function pushSupport(env: {
  hasKey: boolean; production: boolean; hasSW: boolean; hasPush: boolean; ios: boolean; standalone: boolean
}): PushSupport {
  if (!env.hasKey) return 'no-key'
  if (env.ios && !env.standalone) return 'ios-install'
  if (!env.hasSW || !env.hasPush) return 'unsupported'
  if (!env.production) return 'dev'
  return 'ok'
}

export const QUIET_HOURS = Array.from({ length: 24 }, (_, h) => ({ value: h, label: `${String(h).padStart(2, '0')}:00` }))
