import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/shared/lib/supabase-server'
import { normalizeVnPhone, phoneEmail } from '@/features/auth/server'

// Đăng ký bằng số điện thoại. Tài khoản là email nội bộ <số>@phone.racehub.vn — địa chỉ này không nhận được thư,
// nên không thể đi qua signUp thường (Supabase gửi thư xác nhận → lỗi giới hạn gửi email / không bao giờ xác nhận được).
// Máy chủ tạo sẵn tài khoản đã xác nhận bằng khóa service role (chỉ ở máy chủ, không trả gì ra ngoài),
// rồi trình duyệt tự đăng nhập bằng số + mật khẩu. Chưa có OTP SMS: số điện thoại chưa được xác minh là của người đăng ký.
export const dynamic = 'force-dynamic'

// Chống spam đơn giản theo IP (mỗi máy chủ một bộ đếm; đủ để chặn bấm liên tục)
const hits = new Map<string, number[]>()
const WINDOW_MS = 60 * 60 * 1000
const MAX_PER_WINDOW = 5

function tooMany(ip: string) {
  const now = Date.now()
  const list = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS)
  if (list.length >= MAX_PER_WINDOW) { hits.set(ip, list); return true }
  list.push(now)
  hits.set(ip, list)
  if (hits.size > 5000) hits.clear()
  return false
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { phone?: string; password?: string; displayName?: string }
  const phone = normalizeVnPhone(String(body.phone ?? ''))
  if (!phone) return NextResponse.json({ error: 'INVALID_PHONE' }, { status: 400 })
  const password = String(body.password ?? '')
  if (password.length < 6 || password.length > 72) return NextResponse.json({ error: 'WEAK_PASSWORD' }, { status: 400 })
  const displayName = String(body.displayName ?? '').trim().slice(0, 60) || phone

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (tooMany(ip)) return NextResponse.json({ error: 'RATE_LIMIT' }, { status: 429 })

  const admin = createSupabaseAdminClient()
  const { error } = await admin.auth.admin.createUser({
    email: phoneEmail(phone),
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  })
  if (error) {
    if (/already|exists|registered/i.test(error.message)) return NextResponse.json({ error: 'PHONE_TAKEN' }, { status: 409 })
    return NextResponse.json({ error: 'SIGNUP_FAILED' }, { status: 400 })
  }
  return NextResponse.json({ ok: true, phone })
}
