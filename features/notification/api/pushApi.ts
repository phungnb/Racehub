// Web Push: đăng ký thiết bị và cài đặt loại thông báo đẩy (migration 001700)
import { supabase } from '@/shared/lib/supabase'

export interface PushSettings {
  club: boolean
  social: boolean
  challenge: boolean
  game: boolean
  quiet: boolean
  quiet_from: number
  quiet_to: number
  devices: number
  /** Máy chủ đã cấu hình gửi push chưa (private.configure_push) */
  configured: boolean
}
export type PushPrefs = Omit<PushSettings, 'devices' | 'configured'>

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}

export const getPushSettings = () => rpc<PushSettings>('my_push_settings')
export const updatePushSettings = (p: PushPrefs) => rpc<PushSettings>('update_push_settings', { p })
export const sendTestPush = () => rpc<void>('send_test_push')
export const deletePushSubscription = (endpoint: string) => rpc<void>('delete_push_subscription', { p_endpoint: endpoint })

export function savePushSubscription(sub: PushSubscription) {
  const j = sub.toJSON()
  return rpc<void>('save_push_subscription', {
    p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth, p_user_agent: navigator.userAgent.slice(0, 300),
  })
}

export function pushErrorMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (m.includes('TOO_SOON')) return 'Vừa gửi thử rồi, đợi 30 giây nhé.'
  if (m.includes('INVALID_SUBSCRIPTION')) return 'Trình duyệt trả về đăng ký không hợp lệ. Thử lại.'
  if (m.includes('INVALID_SETTINGS')) return 'Giờ yên lặng không hợp lệ.'
  if (m.includes('Failed to fetch') || m.includes('NetworkError')) return 'Mất kết nối mạng. Thử lại sau.'
  return 'Có lỗi xảy ra. Thử lại sau.'
}
