import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/shared/lib/supabase-server'

// Quản trị → Kiểm tra hệ thống → "Đăng ký webhook Strava": thay cho lệnh curl trong hướng dẫn triển khai.
// Máy chủ gọi Strava push_subscriptions bằng client secret (không bao giờ trả secret về trình duyệt).
// Callback = tên miền đang chạy + /api/webhooks/strava; webhook cũ trỏ tên miền khác bị xoá rồi tạo lại (mỗi app Strava chỉ có 1).
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const env = (name: string) => process.env[name]?.trim() || ''
const API = 'https://www.strava.com/api/v3/push_subscriptions'

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { data: isAdmin } = await supabase.rpc('is_system_admin')
  if (!isAdmin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const id = env('NEXT_PUBLIC_STRAVA_CLIENT_ID'), secret = env('STRAVA_CLIENT_SECRET'), verify = env('STRAVA_WEBHOOK_VERIFY_TOKEN')
  if (!id || !secret) return NextResponse.json({ error: 'Thiếu NEXT_PUBLIC_STRAVA_CLIENT_ID hoặc STRAVA_CLIENT_SECRET trên Vercel.' }, { status: 400 })
  if (!verify) {
    return NextResponse.json({ error: 'Thiếu STRAVA_WEBHOOK_VERIFY_TOKEN: vào Vercel → Settings → Environment Variables, thêm biến này với một chuỗi ngẫu nhiên bất kỳ (VD 32 ký tự), Redeploy rồi bấm lại.' }, { status: 400 })
  }
  const callback = `${new URL(req.url).origin}/api/webhooks/strava`
  const auth = `client_id=${encodeURIComponent(id)}&client_secret=${encodeURIComponent(secret)}`

  try {
    const list = await fetch(`${API}?${auth}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
    if (!list.ok) return NextResponse.json({ error: `Strava từ chối (mã ${list.status}) — kiểm tra client secret.` }, { status: 502 })
    const subs = (await list.json()) as { id: number; callback_url: string }[]
    const same = subs.find((s) => s.callback_url === callback)
    if (same) return NextResponse.json({ id: same.id, callback, already: true })
    for (const s of subs) {   // webhook cũ trỏ tên miền khác
      await fetch(`${API}/${s.id}?${auth}`, { method: 'DELETE', signal: AbortSignal.timeout(8000) })
    }
    // Strava gọi ngược GET callback?hub.verify_token=… để xác minh trước khi trả kết quả
    const body = new URLSearchParams({ client_id: id, client_secret: secret, callback_url: callback, verify_token: verify })
    const res = await fetch(API, { method: 'POST', body, signal: AbortSignal.timeout(20000) })
    const j = (await res.json().catch(() => null)) as { id?: number; message?: string; errors?: { field?: string; code?: string }[] } | null
    if (!res.ok || !j?.id) {
      const why = j?.errors?.map((e) => [e.field, e.code].filter(Boolean).join(' ')).join(', ') || j?.message || `mã ${res.status}`
      return NextResponse.json({ error: `Strava chưa nhận webhook: ${why}. Kiểm tra STRAVA_WEBHOOK_VERIFY_TOKEN đã Redeploy chưa.` }, { status: 502 })
    }
    return NextResponse.json({ id: j.id, callback, already: false })
  } catch {
    return NextResponse.json({ error: 'Không gọi được Strava (mạng / hết giờ), thử lại sau.' }, { status: 504 })
  }
}
