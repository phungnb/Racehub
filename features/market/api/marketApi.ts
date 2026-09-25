// Chợ Runner (migration 005300): hồ sơ HLV / Shop / Dịch vụ đã xác minh. RaceHub không giữ tiền — liên hệ trực tiếp đối tác.
import { supabase } from '@/shared/lib/supabase'
import { systemErrorMessage } from '@/shared/lib/errors'
import { prepareImage } from '@/shared/lib/image'

export type PartnerKind = 'COACH' | 'SHOP' | 'SERVICE'
export type PartnerStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'HIDDEN'
export interface PartnerService { name: string; price: string | null; unit: string | null; description: string | null }
export interface PartnerContacts { phone?: string; zalo?: string; facebook?: string; website?: string; email?: string }
export interface Partner {
  id: string
  kind: PartnerKind
  name: string
  tagline: string | null
  avatar_url: string | null
  cover_url: string | null
  area: string | null
  specialties: string[]
  verified: boolean
  status: PartnerStatus
  is_mine: boolean
  services_count: number
  owner: { id: string; display_name: string; avatar_url: string | null }
  // hồ sơ đầy đủ
  bio?: string | null
  address?: string | null
  services?: PartnerService[]
  contacts?: PartnerContacts
  review_note?: string | null
  stats?: { level: number | null; km_12m: number; runs_12m: number; member_since: string | null } | null
  updated_at?: string
}
export type PartnerInput = Partial<Pick<Partner, 'id' | 'kind' | 'name' | 'tagline' | 'bio' | 'avatar_url' | 'cover_url' | 'area' | 'address' | 'specialties'>> & {
  services?: Partial<PartnerService>[]; contacts?: PartnerContacts
}

export const PARTNER_KIND: Record<PartnerKind, { label: string; hint: string }> = {
  COACH: { label: 'Huấn luyện viên', hint: 'Giáo án, kèm tập, luyện marathon / trail' },
  SHOP: { label: 'Cửa hàng', hint: 'Giày, quần áo, đồ dinh dưỡng, phụ kiện chạy' },
  SERVICE: { label: 'Dịch vụ', hint: 'Massage, vật lý trị liệu, chụp ảnh giải, pacer…' },
}

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}
export const listPartners = (f: { kind?: PartnerKind | null; area?: string | null; query?: string | null } = {}) =>
  call<Partner[]>('list_partners', { p_kind: f.kind ?? null, p_area: f.area ?? null, p_query: f.query?.trim() || null }).then((x) => x ?? [])
export const getPartner = (id: string) => call<Partner | null>('get_partner', { p_id: id }).then((p) => {
  if (!p) throw new Error('PARTNER_NOT_FOUND')
  return p
})
export const myPartners = () => call<Partner[]>('my_partners').then((x) => x ?? [])
export const savePartner = (p: PartnerInput) => call<Partner>('save_partner', { p })
export const adminListPartners = (status: PartnerStatus | 'ALL') => call<Partner[]>('admin_list_partners', { p_status: status }).then((x) => x ?? [])
export const reviewPartner = (id: string, action: 'APPROVE' | 'REJECT' | 'HIDE', note?: string | null) =>
  call<Partner>('admin_review_partner', { p_id: id, p_action: action, p_note: note ?? null })

/** Ảnh hồ sơ: kho market-media/<user_id>/… */
export async function uploadPartnerImage(file: File): Promise<string> {
  const blob = await prepareImage(file, { maxSide: 1600, maxBytes: 1.5 * 1024 * 1024 })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('AUTH_REQUIRED')
  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${user.id}/${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('market-media').upload(path, blob, { contentType: blob.type, upsert: false })
  if (error) throw error
  return supabase.storage.from('market-media').getPublicUrl(path).data.publicUrl
}

/** Link liên hệ an toàn (chỉ https / tel / mailto / Zalo) */
export function contactLinks(c: PartnerContacts | undefined) {
  if (!c) return []
  const out: { key: keyof PartnerContacts; label: string; value: string; href: string }[] = []
  if (c.phone) out.push({ key: 'phone', label: 'Gọi điện', value: c.phone, href: `tel:${c.phone}` })
  if (c.zalo) out.push({ key: 'zalo', label: 'Zalo', value: c.zalo, href: c.zalo.startsWith('https://') ? c.zalo : `https://zalo.me/${c.zalo.replace(/^\+84/, '0')}` })
  if (c.facebook) out.push({ key: 'facebook', label: 'Facebook', value: c.facebook, href: c.facebook })
  if (c.website) out.push({ key: 'website', label: 'Website', value: c.website, href: c.website })
  if (c.email) out.push({ key: 'email', label: 'Email', value: c.email, href: `mailto:${c.email}` })
  return out.filter((x) => /^(https:\/\/|tel:|mailto:)/.test(x.href))
}

const MESSAGES: Record<string, string> = {
  PARTNER_EXISTS: 'Bạn đã có hồ sơ loại này — hãy sửa hồ sơ hiện có.',
  PARTNER_NOT_FOUND: 'Không tìm thấy hồ sơ (có thể chưa được xác minh hoặc đã bị ẩn).',
  INVALID_PARTNER_IMAGE: 'Ảnh phải tải lên từ RaceHub.',
  INVALID_PARTNER: 'Nhập tên hồ sơ (ít nhất 2 ký tự) và chọn loại.',
  INVALID_CONTACT: 'Liên hệ chưa đúng: điện thoại 8–16 số; Facebook / website bắt đầu bằng https://; email hợp lệ.',
  TOO_MANY_SERVICES: 'Tối đa 12 dịch vụ.',
  REASON_REQUIRED: 'Nhập lý do (ít nhất 3 ký tự) để chủ hồ sơ biết cần sửa gì.',
  FORBIDDEN: 'Bạn không có quyền sửa hồ sơ này.',
}
export function marketErrorMessage(e: unknown): string {
  const raw = (e as { message?: string } | null)?.message ?? ''
  const k = Object.keys(MESSAGES).find((x) => raw.includes(x))
  return k ? MESSAGES[k] : systemErrorMessage(e, 'Không thực hiện được. Hãy thử lại.')
}
