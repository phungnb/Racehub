import { createECDH } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/shared/lib/supabase-server'

// Trang Quản trị → Kiểm tra hệ thống: biến môi trường trên máy chủ (chỉ trả có / không, KHÔNG BAO GIỜ trả giá trị),
// cặp khóa VAPID khớp nhau, Strava client secret còn dùng được + webhook đã đăng ký. Chỉ admin hệ thống gọi được.
export const dynamic = 'force-dynamic'
export const maxDuration = 20

type Status = 'ok' | 'warn' | 'fail'
interface Item { key: string; label: string; status: Status; detail: string }

const env = (name: string) => process.env[name]?.trim() || ''

function vapidPairOk(pub: string, priv: string) {
  try {
    const ecdh = createECDH('prime256v1')
    ecdh.setPrivateKey(Buffer.from(priv, 'base64url'))
    return ecdh.getPublicKey('base64url') === pub
  } catch {
    return false
  }
}

async function stravaCheck(origin: string): Promise<Item[]> {
  const id = env('NEXT_PUBLIC_STRAVA_CLIENT_ID'), secret = env('STRAVA_CLIENT_SECRET')
  if (!id || !secret) return [{ key: 'strava_api', label: 'Strava: client secret', status: 'fail', detail: 'Thiếu NEXT_PUBLIC_STRAVA_CLIENT_ID hoặc STRAVA_CLIENT_SECRET.' }]
  try {
    const url = `https://www.strava.com/api/v3/push_subscriptions?client_id=${encodeURIComponent(id)}&client_secret=${encodeURIComponent(secret)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(6000), cache: 'no-store' })
    if (res.status === 401 || res.status === 403) {
      return [{ key: 'strava_api', label: 'Strava: client secret', status: 'fail', detail: 'Strava từ chối client secret — kiểm tra lại giá trị vừa đổi trong Vercel.' }]
    }
    if (!res.ok) return [{ key: 'strava_api', label: 'Strava: client secret', status: 'warn', detail: `Strava trả mã ${res.status}, thử lại sau.` }]
    const subs = (await res.json()) as { id: number; callback_url: string }[]
    const want = env('STRAVA_WEBHOOK_SUBSCRIPTION_ID')
    const sub = subs[0]
    const hook: Item = !sub
      ? { key: 'strava_webhook', label: 'Strava: webhook', status: 'fail', detail: 'Chưa đăng ký webhook — bài chạy mới sẽ không tự về app. Xem HUONG_DAN_TRIEN_KHAI mục Strava webhook.' }
      : !sub.callback_url.startsWith(origin)
        ? { key: 'strava_webhook', label: 'Strava: webhook', status: 'warn', detail: `Webhook trỏ tới ${new URL(sub.callback_url).host}, không phải tên miền đang chạy.` }
        : want && String(sub.id) !== want
          ? { key: 'strava_webhook', label: 'Strava: webhook', status: 'warn', detail: `STRAVA_WEBHOOK_SUBSCRIPTION_ID khác mã webhook thật (${sub.id}).` }
          : { key: 'strava_webhook', label: 'Strava: webhook', status: 'ok', detail: `Đã đăng ký (mã ${sub.id}).` }
    return [{ key: 'strava_api', label: 'Strava: client secret', status: 'ok', detail: 'Strava chấp nhận client secret.' }, hook]
  } catch {
    return [{ key: 'strava_api', label: 'Strava: client secret', status: 'warn', detail: 'Không gọi được Strava (mạng / hết giờ).' }]
  }
}

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { data: isAdmin } = await supabase.rpc('is_system_admin')
  if (!isAdmin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const need = (name: string, label: string, min = 1, hint = ''): Item => {
    const v = env(name)
    if (!v) return { key: name, label, status: 'fail', detail: `Thiếu ${name}.${hint ? ' ' + hint : ''}` }
    if (v.length < min) return { key: name, label, status: 'fail', detail: `${name} quá ngắn (cần ≥ ${min} ký tự).` }
    return { key: name, label, status: 'ok', detail: 'Đã đặt.' }
  }
  const pub = env('NEXT_PUBLIC_VAPID_PUBLIC_KEY'), priv = env('VAPID_PRIVATE_KEY')
  const items: Item[] = [
    need('SUPABASE_SERVICE_ROLE_KEY', 'Supabase service role key'),
    need('CRON_SECRET', 'CRON_SECRET (việc tự chạy hằng ngày)', 16, 'Tạo chuỗi ngẫu nhiên ≥ 16 ký tự trong Vercel.'),
    need('OAUTH_STATE_SECRET', 'OAUTH_STATE_SECRET (kết nối Strava)', 32),
    need('STRAVA_WEBHOOK_VERIFY_TOKEN', 'Strava webhook verify token'),
    !pub || !priv
      ? { key: 'vapid', label: 'Khóa thông báo đẩy (VAPID)', status: 'warn', detail: 'Chưa đặt cặp khóa VAPID — thông báo đẩy đang tắt.' }
      : vapidPairOk(pub, priv)
        ? { key: 'vapid', label: 'Khóa thông báo đẩy (VAPID)', status: 'ok', detail: 'Cặp khóa khớp nhau.' }
        : { key: 'vapid', label: 'Khóa thông báo đẩy (VAPID)', status: 'fail', detail: 'Khóa công khai và bí mật không cùng một cặp — tạo lại bằng npx web-push generate-vapid-keys.' },
    ...(await stravaCheck(req.nextUrl.origin)),
  ]
  return NextResponse.json({ items, origin: req.nextUrl.origin })
}
