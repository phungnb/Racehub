import 'server-only'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { serverEnv } from '@/shared/config/env.server'

/** Client theo phiên người dùng (tôn trọng RLS). Dùng trong Route Handler / Server Component. */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies()
  return createServerClient(serverEnv.supabaseUrl, serverEnv.supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // Gọi từ Server Component (không ghi cookie được) — proxy.ts sẽ làm mới phiên.
        }
      },
    },
  })
}

/** Client quyền service role — BỎ QUA RLS. Chỉ dùng cho tích hợp phía server, không bao giờ trả dữ liệu thô cho client. */
export function createSupabaseAdminClient() {
  return createClient(serverEnv.supabaseUrl, serverEnv.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
