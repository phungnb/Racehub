import { createBrowserClient } from '@supabase/ssr'
import { publicEnv } from '@/shared/config/env'

// Client cho trình duyệt. Phiên đăng nhập lưu trong cookie (không phải localStorage)
// để Route Handler / Server Component đọc được người dùng hiện tại.
export const supabase = createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey)
