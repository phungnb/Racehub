import { NextResponse, type NextRequest } from 'next/server'
import webpush, { WebPushError } from 'web-push'
import { createSupabaseAdminClient } from '@/shared/lib/supabase-server'
import { serverEnv } from '@/shared/config/env.server'

// Gửi Web Push. Supabase gọi route này (pg_net) ngay sau khi có thông báo mới cần đẩy;
// khóa bí mật chỉ nằm trong DB (private.app_settings) và được DB tự kiểm tra ở push_claim_batch.
export const maxDuration = 60

type Item = {
  user_id: string; kind: string; title: string; body: string | null; link: string | null; unread: number
  subscriptions: { endpoint: string; p256dh: string; auth: string }[]
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
  if (!token) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  if (!serverEnv.vapidPublicKey) return NextResponse.json({ error: 'PUSH_NOT_CONFIGURED' }, { status: 503 })

  const db = createSupabaseAdminClient()
  webpush.setVapidDetails(serverEnv.vapidSubject ?? req.nextUrl.origin, serverEnv.vapidPublicKey, serverEnv.vapidPrivateKey)

  let sent = 0
  const dead = new Set<string>()
  // Lấy tối đa 3 lô (900 thông báo) mỗi lần gọi; phần còn lại đi cùng lần gọi kế tiếp
  for (let round = 0; round < 3; round++) {
    const { data, error } = await db.rpc('push_claim_batch', { p_token: token })
    if (error) {
      const unauthorized = error.message.includes('UNAUTHORIZED')
      if (!unauthorized) console.error('[push/dispatch]', error.message)
      return NextResponse.json({ error: unauthorized ? 'UNAUTHORIZED' : 'FAILED' }, { status: unauthorized ? 401 : 500 })
    }
    const items = (data ?? []) as Item[]
    if (items.length === 0) break
    await Promise.all(items.flatMap((it) => it.subscriptions.map(async (s) => {
      const payload = JSON.stringify({ title: it.title, body: it.body ?? '', url: it.link ?? '/notifications', tag: it.kind, unread: it.unread })
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 6 * 3600, urgency: 'normal' })
        sent++
      } catch (e) {
        // 404/410: trình duyệt đã hủy đăng ký (gỡ app, xóa dữ liệu) → xóa thiết bị
        if (e instanceof WebPushError && (e.statusCode === 404 || e.statusCode === 410)) dead.add(s.endpoint)
        else console.warn('[push/dispatch] gửi lỗi', e instanceof WebPushError ? e.statusCode : String(e))
      }
    })))
    if (items.length < 300) break
  }
  if (dead.size) await db.rpc('push_report', { p_token: token, p_dead: [...dead] })
  return NextResponse.json({ sent, removed: dead.size })
}
