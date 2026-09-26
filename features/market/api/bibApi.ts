// Chợ BIB (migration 006400): nhượng / tìm BIB giải chạy thật. RaceHub không giữ tiền, không bán cao hơn giá gốc.
import { supabase } from '@/shared/lib/supabase'
import { systemErrorMessage } from '@/shared/lib/errors'

export type BibKind = 'SELL' | 'BUY'
export type BibDistance = '5K' | '10K' | '21K' | '42K' | 'ULTRA' | 'OTHER'
export type BibStatus = 'OPEN' | 'RESERVED' | 'DONE' | 'CANCELLED' | 'HIDDEN'
export interface BibContacts { phone?: string; zalo?: string; facebook?: string }
export interface BibListing {
  id: string; kind: BibKind; race_name: string; race_date: string; city: string | null; distance: BibDistance; distance_note: string | null
  original_price: number | null; price: number | null; transfer: 'OFFICIAL' | 'ASK'; shirt_size: string | null; note: string | null
  status: BibStatus; created_at: string; mine: boolean; revealed: boolean; contacts?: BibContacts
  seller: { id: string; name: string; avatar_url: string | null; level: number | null; runs: number; since: string }
  views?: number; reveals?: number; hidden_reason?: string | null
}
export interface BibFilters { kind?: BibKind | null; q?: string; city?: string | null; distance?: BibDistance | null; mine?: boolean }
export interface BibPage { items: BibListing[]; total: number; eligible: boolean; valid_runs: number; open_count: number }
export type BibInput = Partial<Omit<BibListing, 'seller' | 'mine' | 'revealed' | 'status' | 'created_at'>> & { contacts: BibContacts }

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}

export const listBibs = (f: BibFilters, offset = 0) => call<BibPage>('bib_listings', { p: { ...f, offset } })
export const saveBib = (p: BibInput) => call<string>('save_bib_listing', { p })
export const setBibStatus = (id: string, status: Exclude<BibStatus, 'HIDDEN'>) => call<void>('set_bib_status', { p_id: id, p_status: status })
export const revealBibContact = (id: string) => call<BibContacts>('bib_contact', { p_id: id })
export const reportBib = (id: string, reason: string, note: string | null) => call<void>('report_bib', { p_id: id, p_reason: reason, p_note: note })

export const BIB_DISTANCES: Record<BibDistance, string> = { '5K': '5 km', '10K': '10 km', '21K': 'Half 21 km', '42K': 'Full 42 km', ULTRA: 'Ultra / Trail', OTHER: 'Khác' }
export const BIB_STATUS: Record<BibStatus, { label: string; tone: string }> = {
  OPEN: { label: 'Đang mở', tone: 'bg-brand/15 text-brand' },
  RESERVED: { label: 'Đang giao dịch', tone: 'bg-warning/15 text-warning' },
  DONE: { label: 'Đã xong', tone: 'bg-surface-2 text-fg-muted' },
  CANCELLED: { label: 'Đã gỡ', tone: 'bg-surface-2 text-fg-subtle' },
  HIDDEN: { label: 'Bị ẩn', tone: 'bg-danger/15 text-danger' },
}
export const formatVnd = (n: number | null | undefined) => (n == null ? '' : `${n.toLocaleString('vi-VN')}đ`)

const MESSAGES: Record<string, string> = {
  NOT_ELIGIBLE: 'Cần ít nhất 3 bài chạy hợp lệ để đăng tin BIB (chống tài khoản ảo, lừa đảo).',
  PRICE_ABOVE_ORIGINAL: 'Chợ BIB không cho bán cao hơn giá gốc — giúp runner mua đúng giá.',
  PRICE_REQUIRED: 'Nhập giá gốc và giá nhượng.',
  CONTACT_REQUIRED: 'Nhập ít nhất một cách liên hệ hợp lệ (số điện thoại, Zalo hoặc link Facebook).',
  RACE_DATE_PAST: 'Ngày giải đã qua.',
  RACE_REQUIRED: 'Nhập tên giải.',
  INVALID_DISTANCE: 'Chọn cự ly.',
  NO_LINKS: 'Ghi chú không được chứa link (trừ Facebook).',
  TOO_MANY_LISTINGS: 'Mỗi runner tối đa 5 tin đang mở. Đóng bớt tin cũ nhé.',
  TOO_MANY_REVEALS: 'Bạn đã xem liên hệ của nhiều tin trong 24 giờ. Thử lại sau.',
  LISTING_NOT_FOUND: 'Tin không còn tồn tại.',
  LISTING_HIDDEN: 'Tin đang bị ẩn — chờ quản trị viên xem xét.',
  RATE_LIMITED: 'Bạn đăng hơi nhiều trong hôm nay. Thử lại sau.',
  FORBIDDEN: 'Bạn không có quyền làm việc này.',
}
export function bibErrorMessage(e: unknown): string {
  const msg = (e as { message?: string } | null)?.message ?? ''
  const key = Object.keys(MESSAGES).find((k) => msg.includes(k))
  return key ? MESSAGES[key] : systemErrorMessage(e, 'Không thực hiện được. Hãy thử lại.')
}
