import { NextResponse, after } from 'next/server'
import { createSupabaseAdminClient } from '@/shared/lib/supabase-server'
import { handleStravaWebhookEvent } from '@/features/integrations/strava/strava.server'

// Strava Webhook Events API: https://developers.strava.com/docs/webhooks/
// Đăng ký: xem docs/HUONG_DAN_TRIEN_KHAI.md (Bước "Webhook Strava").
export const maxDuration = 60

// Strava xác nhận URL khi đăng ký subscription
export async function GET(request: Request) {
  const url = new URL(request.url)
  const expected = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN
  if (!expected || url.searchParams.get('hub.verify_token') !== expected) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }
  return NextResponse.json({ 'hub.challenge': url.searchParams.get('hub.challenge') })
}

interface StravaEvent {
  object_type: string
  aspect_type: string
  object_id: number
  owner_id: number
  subscription_id?: number
  updates?: Record<string, string>
}

export async function POST(request: Request) {
  const event = (await request.json().catch(() => null)) as StravaEvent | null
  if (!event || typeof event.object_id !== 'number' || typeof event.owner_id !== 'number') {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }
  // Chỉ nhận sự kiện của đúng subscription của RaceHub (nếu đã cấu hình)
  const subId = process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID
  if (subId && String(event.subscription_id) !== subId) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  // Strava yêu cầu trả lời trong 2 giây → xử lý sau khi đã phản hồi.
  // Nội dung bài chạy luôn được lấy lại từ API Strava, không tin dữ liệu trong request.
  after(async () => {
    try {
      const result = await handleStravaWebhookEvent(createSupabaseAdminClient(), event)
      console.info('[webhooks/strava]', event.aspect_type, event.object_type, event.object_id, JSON.stringify(result))
    } catch (err) {
      console.error('[webhooks/strava]', event.object_id, err instanceof Error ? err.message : err)
    }
  })
  return NextResponse.json({ ok: true })
}
