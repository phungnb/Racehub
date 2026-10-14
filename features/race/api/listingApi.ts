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
      SEARCH_URL: 'Đây là link trang kết quả tìm kiếm nên không đọc được. Mở một kết quả rồi dán link giải đó, hoặc dùng "Tìm bằng từ khóa" ở Duyệt giải tự tìm.',
      BAD_URL: 'Link không hợp lệ hoặc không truy cập được.', FETCH_FAILED: 'Không tải được trang này.',
      NOT_HTML: 'Link này không phải trang web.', FORBIDDEN: 'Chỉ admin dùng được.', AUTH_REQUIRED: 'Cần đăng nhập.',
    }
    throw new Error(m[j.error ?? ''] ?? 'Không đọc được trang này.')
  }
  return { source_url: j.source_url ?? url, draft: j.draft }
}

// ── Quét giải tự động: nguồn + hàng chờ duyệt (migration 016100). Chỉ admin (RLS). ──
export interface RaceSource { id: string; kind: 'PAGE' | 'SEARCH'; url: string | null; query: string | null; label: string | null; active: boolean; last_scanned_at: string | null; last_error: string | null }
export type CandidateState = 'PENDING' | 'FILTERED' | 'APPROVED' | 'REJECTED'
export interface RaceCandidate {
  id: string; url: string; title: string; race_date: string | null; end_date: string | null; location: string | null
  organizer: string | null; image_url: string | null; description: string | null; distances: string[]
  score: number; status: CandidateState; filter_reason: string | null
}
const CAND = 'id,url,title,race_date,end_date,location,organizer,image_url,description,distances,score,status,filter_reason'

export async function listSources(): Promise<RaceSource[]> {
  const { data, error } = await supabase.from('race_sources').select('id,kind,url,query,label,active,last_scanned_at,last_error').order('created_at')
  if (error) throw error
  return data as RaceSource[]
}
export async function addSource(v: { kind: 'PAGE' | 'SEARCH'; value: string; label: string | null }) {
  const { error } = await supabase.from('race_sources').insert(v.kind === 'SEARCH' ? { kind: 'SEARCH', query: v.value, label: v.label } : { kind: 'PAGE', url: v.value, label: v.label })
  if (error) throw error
}
export async function setSourceActive(id: string, active: boolean) {
  const { error } = await supabase.from('race_sources').update({ active }).eq('id', id)
  if (error) throw error
}
export async function deleteSource(id: string) {
  const { error } = await supabase.from('race_sources').delete().eq('id', id)
  if (error) throw error
}
export async function scanNow(sourceId: string): Promise<{ found: number; pending: number; filtered: number; error: string | null }> {
  const res = await fetch('/api/admin/race-scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source_id: sourceId }) })
  const j = (await res.json().catch(() => ({}))) as { result?: { found: number; pending: number; filtered: number; error: string | null } }
  if (!res.ok || !j.result) throw new Error('Không quét được nguồn này.')
  return j.result
}
export async function listCandidates(status: CandidateState): Promise<RaceCandidate[]> {
  const { data, error } = await supabase.from('race_candidates').select(CAND).eq('status', status)
    .order('score', { ascending: false }).order('race_date', { ascending: true }).limit(100)
  if (error) throw error
  return data as RaceCandidate[]
}
export async function getCandidate(id: string): Promise<RaceCandidate | null> {
  const { data, error } = await supabase.from('race_candidates').select(CAND).eq('id', id).maybeSingle()
  if (error) throw error
  return data as RaceCandidate | null
}
export async function setCandidateStatus(id: string, status: CandidateState, listingId?: string) {
  const { error } = await supabase.from('race_candidates')
    .update({ status, reviewed_at: new Date().toISOString(), ...(listingId ? { listing_id: listingId } : {}) }).eq('id', id)
  if (error) throw error
}
export async function countPending(): Promise<number> {
  const { count, error } = await supabase.from('race_candidates').select('id', { count: 'exact', head: true }).eq('status', 'PENDING')
  if (error) throw error
  return count ?? 0
}
