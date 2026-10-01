import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// Làm mới token Supabase trong cookie ở mỗi request để Server Component/Route Handler
// luôn thấy phiên hợp lệ. Không chặn truy cập ở đây — phân quyền thật nằm ở RLS/RPC.
// Chỉ chạy khi mở trang trực tiếp (gõ link / tải lại / quay về từ OAuth) và đã có phiên: getUser() là một lượt gọi mạng
// tới Supabase Auth, chạy ở MỌI lượt chuyển trang / tải trước thì trang nào cũng chậm thêm. Chuyển trang trong app,
// gọi API: trình duyệt tự làm mới phiên (supabase-js autoRefreshToken), Route Handler tự đọc phiên của nó.
/** Thời điểm hết hạn (giây) của phiên trong cookie sb-…-auth-token (có thể chia nhiều mảnh .0 .1 …); không đọc được → null */
function sessionExpiresAt(request: NextRequest): number | null {
  try {
    const parts = request.cookies.getAll().filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name))
      .sort((a, b) => Number(a.name.split('.').pop()) - Number(b.name.split('.').pop()))
    if (!parts.length) return null
    let raw = parts.map((c) => c.value).join('')
    if (raw.startsWith('base64-')) raw = Buffer.from(raw.slice(7), 'base64url').toString('utf8')
    const exp = Number(JSON.parse(raw)?.expires_at)
    return Number.isFinite(exp) ? exp : null
  } catch { return null }
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return response
  const dest = request.headers.get('sec-fetch-dest')
  if (dest && dest !== 'document') return response
  if (!request.cookies.getAll().some((c) => c.name.startsWith('sb-'))) return response
  // Phiên còn hạn ≥ 2 phút: không cần làm mới, bỏ qua lượt gọi Supabase Auth (cookie giữ nguyên như khi gọi getUser)
  const exp = sessionExpiresAt(request)
  if (exp !== null && exp - Date.now() / 1000 > 120) return response

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })
  await supabase.auth.getUser()
  return response
}

export const config = {
  matcher: [{
    // Bỏ qua tệp tĩnh, mọi /api (Route Handler tự kiểm tra phiên) và các lượt tải trước của Link
    source: '/((?!_next/static|_next/image|favicon.ico|api/|sw\\.js|offline\\.html|manifest\\.webmanifest|.*\\.(?:png|jpg|jpeg|svg|webp|glb|gif|ico|css|js|woff2?)$).*)',
    missing: [
      { type: 'header', key: 'next-router-prefetch' },
      { type: 'header', key: 'purpose', value: 'prefetch' },
    ],
  }],
}
