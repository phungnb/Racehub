// Biến môi trường công khai (được nhúng vào bundle trình duyệt).
// Next.js chỉ thay thế process.env.NEXT_PUBLIC_* khi viết đầy đủ tên, nên không dùng truy cập động.
export const publicEnv = {
  supabaseUrl: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim(),
  supabaseAnonKey: (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim(),
  stravaClientId: (process.env.NEXT_PUBLIC_STRAVA_CLIENT_ID ?? '').trim(),
}

if (!publicEnv.supabaseUrl || !publicEnv.supabaseAnonKey) {
  // Không throw ở đây để trang lỗi vẫn render được; client Supabase sẽ báo lỗi rõ ràng khi gọi.
  console.error('[RaceHub] Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc NEXT_PUBLIC_SUPABASE_ANON_KEY (xem .env.example).')
}
