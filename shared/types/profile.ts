// Kiểu tối thiểu của hồ sơ. Sẽ thay bằng type sinh tự động:
//   npx supabase gen types typescript --linked > shared/types/database.ts
export interface Profile {
  id: string
  display_name: string | null
  avatar_url: string | null
  xu: number | string | null
  xp: number | null
  level: number | null
  role?: string | null
  strava_connected?: boolean | null
  /** null = chưa qua màn chào mừng (migration 001800) */
  onboarded_at?: string | null
  [key: string]: unknown
}
