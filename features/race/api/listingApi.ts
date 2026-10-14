// Tab Race: tin giải chạy offline do admin đăng (migration 016000)
import { supabase } from '@/shared/lib/supabase'

export type ListingStatus = 'DRAFT' | 'PUBLISHED' | 'HIDDEN'

export interface RaceListing {
  id: string
  title: string
  race_date: string
  end_date: string | null
  location: string | null
  province: string | null
  distances: string[]
  organizer: string | null
  reg_url: string | null
  source_url: string | null
  image_url: string | null
  reg_close_date: string | null
  description: string | null
  status: ListingStatus
}

export type ListingInput = Omit<RaceListing, 'id'>

const COLS = 'id,title,race_date,end_date,location,province,distances,organizer,reg_url,source_url,image_url,reg_close_date,description,status'

/** Người dùng thường chỉ thấy PUBLISHED (RLS); admin thấy cả nháp / đã ẩn. */
export async function listListings(past: boolean, today: string): Promise<RaceListing[]> {
  const q = supabase.from('race_listings').select(COLS)
  const { data, error } = past
    ? await q.lt('race_date', today).order('race_date', { ascending: false }).limit(100)
    : await q.gte('race_date', today).order('race_date', { ascending: true }).limit(200)
  if (error) throw error
  return data as RaceListing[]
}

export async function getListing(id: string): Promise<RaceListing | null> {
  const { data, error } = await supabase.from('race_listings').select(COLS).eq('id', id).maybeSingle()
  if (error) throw error
  return data as RaceListing | null
}

export async function saveListing(id: string | null, v: ListingInput): Promise<string> {
  if (id) {
    const { error } = await supabase.from('race_listings').update(v).eq('id', id)
    if (error) throw error
    return id
  }
  const { data, error } = await supabase.from('race_listings').insert(v).select('id').single()
  if (error) throw error
  return (data as { id: string }).id
}

export async function deleteListing(id: string) {
  const { error } = await supabase.from('race_listings').delete().eq('id', id)
  if (error) throw error
}

export interface ImportDraft {
  title: string; race_date: string; end_date: string; location: string; organizer: string
  image_url: string; description: string; distances: string[]
}

/** Dán link trang giải → gợi ý điền form (máy chủ tải trang; chỉ admin). Không tự lưu. */
export async function importFromUrl(url: string): Promise<{ source_url: string; draft: ImportDraft }> {
  const res = await fetch('/api/admin/race-import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) })
  const j = (await res.json().catch(() => ({}))) as { error?: string; source_url?: string; draft?: ImportDraft }
  if (!res.ok || !j.draft) {
    const m: Record<string, string> = {
      BAD_URL: 'Link không hợp lệ hoặc không truy cập được.', FETCH_FAILED: 'Không tải được trang này.',
      NOT_HTML: 'Link này không phải trang web.', FORBIDDEN: 'Chỉ admin dùng được.', AUTH_REQUIRED: 'Cần đăng nhập.',
    }
    throw new Error(m[j.error ?? ''] ?? 'Không đọc được trang này.')
  }
  return { source_url: j.source_url ?? url, draft: j.draft }
}
