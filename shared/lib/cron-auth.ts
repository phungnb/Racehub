import 'server-only'
import { timingSafeEqual } from 'node:crypto'
import { serverEnv } from '@/shared/config/env.server'

/** Vercel Cron gửi "Authorization: Bearer <CRON_SECRET>". So sánh hằng thời gian. */
export function isCronAuthorized(authorization: string | null) {
  const got = Buffer.from(authorization ?? '')
  const want = Buffer.from(`Bearer ${serverEnv.cronSecret}`)
  return got.length === want.length && timingSafeEqual(got, want)
}
