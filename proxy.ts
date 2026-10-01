import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// Làm mới token Supabase trong cookie ở mỗi request để Server Component/Route Handler
// luôn thấy phiên hợp lệ. Không chặn truy cập ở đây — phân quyền thật nằm ở RLS/RPC.
// Chỉ chạy ở trang công khai dựng phía máy chủ (xem matcher), khi mở trang trực tiếp (gõ link / tải lại / quay về từ OAuth) và đã có phiên: getUser() là một lượt gọi mạng
// tới Supabase Auth, chạy ở MỌI lượt chuyển trang / tải trước thì trang nào cũng chậm thêm. Chuyển trang trong app,
// gọi API: trình duyệt tự làm mới phiên (supabase-js autoRefreshToken), Route Handler tự đọc phiên của nó.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return response
  const dest = request.headers.get('sec-fetch-dest')
  if (dest && dest !== 'document') return response
  if (!request.cookies.getAll().some((c) => c.name.startsWith('sb-'))) return response

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
  // CHỈ chạy ở các trang dựng phía máy chủ có đọc phiên (Server Component không ghi cookie được, nên phiên được làm mới ở đây).
  // Các tab trong app (/feed, /clubs, /me…) là trang tĩnh, phiên do trình duyệt tự làm mới (supabase-js autoRefreshToken):
  // không chạy proxy để trang được trả thẳng từ CDN, không phải chờ hàm máy chủ khởi động + 1 lượt gọi Supabase Auth.
  matcher: [
    { source: '/', missing: [{ type: 'header', key: 'next-router-prefetch' }, { type: 'header', key: 'purpose', value: 'prefetch' }] },
    { source: '/goi', missing: [{ type: 'header', key: 'next-router-prefetch' }, { type: 'header', key: 'purpose', value: 'prefetch' }] },
    { source: '/help/:path*', missing: [{ type: 'header', key: 'next-router-prefetch' }, { type: 'header', key: 'purpose', value: 'prefetch' }] },
    { source: '/c/:path*', missing: [{ type: 'header', key: 'next-router-prefetch' }, { type: 'header', key: 'purpose', value: 'prefetch' }] },
    { source: '/v/:path*', missing: [{ type: 'header', key: 'next-router-prefetch' }, { type: 'header', key: 'purpose', value: 'prefetch' }] },
    { source: '/doanh-nghiep', missing: [{ type: 'header', key: 'next-router-prefetch' }, { type: 'header', key: 'purpose', value: 'prefetch' }] },
    { source: '/privacy', missing: [{ type: 'header', key: 'next-router-prefetch' }, { type: 'header', key: 'purpose', value: 'prefetch' }] },
    { source: '/terms', missing: [{ type: 'header', key: 'next-router-prefetch' }, { type: 'header', key: 'purpose', value: 'prefetch' }] },
  ],
}
