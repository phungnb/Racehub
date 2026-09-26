import { createBrowserClient } from '@supabase/ssr'
import { publicEnv } from '@/shared/config/env'

// Client cho trình duyệt. Phiên đăng nhập lưu trong cookie (không phải localStorage)
// để Route Handler / Server Component đọc được người dùng hiện tại.
// Thiếu biến môi trường thì dùng giá trị giữ chỗ: createBrowserClient throw ngay khi nạp module,
// làm hỏng cả bước build (Vercel "Failed to collect page data"). Env.ts đã ghi lỗi rõ ràng.
export const supabase = createBrowserClient(
  publicEnv.supabaseUrl || 'https://missing-env.supabase.co',
  publicEnv.supabaseAnonKey || 'missing-anon-key',
)
