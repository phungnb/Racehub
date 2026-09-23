import 'server-only'
import { publicEnv } from './env'

// Đọc biến bí mật khi cần — ném lỗi rõ ràng thay vì âm thầm dùng giá trị thay thế.
function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`[RaceHub] Thiếu biến môi trường bắt buộc: ${name} (xem .env.example)`)
  }
  return value
}

export const serverEnv = {
  ...publicEnv,
  get supabaseServiceRoleKey() {
    return required('SUPABASE_SERVICE_ROLE_KEY')
  },
  get stravaClientSecret() {
    return required('STRAVA_CLIENT_SECRET')
  },
  get stravaClientIdRequired() {
    return required('NEXT_PUBLIC_STRAVA_CLIENT_ID')
  },
  get cronSecret() {
    const secret = required('CRON_SECRET')
    if (secret.length < 16) throw new Error('[RaceHub] CRON_SECRET phải dài ít nhất 16 ký tự')
    return secret
  },
  get oauthStateSecret() {
    const secret = required('OAUTH_STATE_SECRET')
    if (secret.length < 32) throw new Error('[RaceHub] OAUTH_STATE_SECRET phải dài ít nhất 32 ký tự')
    return secret
  },
}
