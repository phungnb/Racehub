// RaceHub Doanh nghiệp / Liên CLB (migration 008300). Mọi thao tác qua RPC — máy chủ kiểm tra quyền.
import { supabase } from '@/shared/lib/supabase'
import { systemErrorMessage } from '@/shared/lib/errors'

export type OrgKind = 'COMPANY' | 'FEDERATION' | 'SCHOOL' | 'OTHER'
export type OrgRole = 'OWNER' | 'ADMIN' | 'MEMBER'
export type OrgTheme = 'AURORA' | 'SUNSET' | 'OCEAN' | 'FOREST' | 'GOLD' | 'NIGHT'
export type CampaignMetric = 'DISTANCE' | 'RUNS' | 'ACTIVE_DAYS'

export interface Org {
  id: string
  name: string
  kind: OrgKind
  description: string | null
  logo_url: string | null
  cover_url: string | null
  cover_position: number
  tagline: string | null
  theme: OrgTheme | null
  join_policy: 'OPEN' | 'APPROVAL'
  unit_label: string
  allow_self_unit: boolean
  status: 'ACTIVE' | 'SUSPENDED'
  active_until: string | null
  active: boolean
  seat_limit: number
  seats_used: number
  club_limit: number
  include_club_pro: boolean
  club_count: number
  created_at: string
}
export interface MyOrg extends Org { my_role: OrgRole; my_status: 'PENDING' | 'APPROVED' }
export interface OrgUnit { id: string; name: string; members: number }
export interface OrgClub { id: string; name: string; avatar_url: string | null; accent_color: string | null; member_count: number; status: 'PENDING' | 'APPROVED'; pro_granted: boolean }
export interface OrgBilling { legal_name: string | null; tax_code: string | null; contact_name: string | null; contact_phone: string | null; contact_email: string | null }
export interface OrgDetail extends Org {
  my_role: OrgRole
  is_admin: boolean
  is_system_admin: boolean
  my_unit_id: string | null
  is_real_member: boolean
  units: OrgUnit[]
  clubs: OrgClub[]
  pending_members: number | null
  invite_code: string | null
  billing: OrgBilling | null
}
export interface OrgMember {
  user_id: string; name: string; avatar_url: string | null; role: OrgRole; status: 'PENDING' | 'APPROVED'
  unit_id: string | null; unit_name: string | null; joined_at: string; employee_code: string | null
}
export interface OrgInvitePreview {
  id: string; name: string; kind: OrgKind; logo_url: string | null; cover_url: string | null; cover_position: number; theme: OrgTheme | null
  tagline: string | null; description: string | null; join_policy: 'OPEN' | 'APPROVAL'; unit_label: string; allow_self_unit: boolean
  active: boolean; full: boolean; member_count: number; units: { id: string; name: string }[]; my_status: 'PENDING' | 'APPROVED' | null
}
export interface Campaign {
  id: string; org_id: string; title: string; description: string | null; metric: CampaignMetric
  starts_at: string; ends_at: string; goal_total: number | null; goal_per_person: number | null; min_run_km: number
  status: 'ACTIVE' | 'CANCELLED'; created_at: string
}
export interface CampaignSummary extends Campaign { total: number; participants: number; active: number; my_value: number | null }
export interface BoardPerson {
  rank: number; user_id: string; name: string; avatar_url: string | null; unit_name: string | null
  value: number; km: number; runs: number; active_days: number; completed: boolean
}
export interface BoardGroup { id: string; name: string; members: number; active: number; total: number; avg: number; avatar_url?: string | null; accent_color?: string | null }
export interface CampaignBoard {
  campaign: Campaign & { org_name: string }
  is_admin: boolean
  total: number; total_km: number; participants: number; active: number; completed: number
  me: { rank: number; value: number; km: number; runs: number; active_days: number } | null
  people: BoardPerson[]
  units: BoardGroup[]
  clubs: BoardGroup[]
}
export interface ReportRow {
  user_id: string; name: string; direct: boolean; unit_name: string | null; employee_code: string | null; clubs: string | null
  km: number; runs: number; active_days: number
}
export interface ClubOrgs { is_staff: boolean; current: (Org & { pro_granted: boolean; granted_until: string | null }) | null; invites: Org[] }
export interface OrgLead {
  id: string; contact_name: string; org_name: string; kind: OrgKind; size: number | null; phone: string; email: string | null; note: string | null
  status: 'NEW' | 'CONTACTED' | 'WON' | 'LOST'; admin_note: string | null; org_id: string | null; org_name_linked: string | null; created_at: string
}
export interface AdminOrg extends Org, OrgBilling { owner_name: string | null }

const call = async <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}

// Báo giá (không cần đăng nhập)
export const requestQuote = (p: { contact_name: string; org_name: string; kind: OrgKind; size?: number | null; phone: string; email?: string; note?: string }) =>
  call<{ id: string }>('request_enterprise_quote', { p })

// Tổ chức của tôi / chi tiết
export const listMyOrgs = () => call<MyOrg[]>('my_orgs')
export const getOrg = (orgId: string) => call<OrgDetail>('org_detail', { p_org: orgId })
export const previewOrgInvite = (code: string) => call<OrgInvitePreview | null>('org_invite_preview', { p_code: code })
export const joinOrg = (code: string, unitId?: string | null, employeeCode?: string) =>
  call<{ org_id: string; status: 'PENDING' | 'APPROVED'; duplicate?: boolean }>('join_org', { p_code: code, p_unit: unitId ?? null, p_employee_code: employeeCode?.trim() || null })
export const leaveOrg = (orgId: string) => call<void>('leave_org', { p_org: orgId })
export const rotateOrgInvite = (orgId: string) => call<string>('rotate_org_invite', { p_org: orgId })
export const updateOrg = (orgId: string, p: Partial<Pick<Org, 'name' | 'description' | 'logo_url' | 'cover_url' | 'cover_position' | 'tagline' | 'theme' | 'join_policy' | 'unit_label' | 'allow_self_unit'>> & Partial<OrgBilling>) =>
  call<OrgDetail>('update_org', { p_org: orgId, p })

// Đơn vị + thành viên
export const saveOrgUnit = (orgId: string, id: string | null, name: string) => call<string>('save_org_unit', { p_org: orgId, p_id: id, p_name: name })
export const deleteOrgUnit = (id: string) => call<void>('delete_org_unit', { p_id: id })
export const listOrgMembers = (orgId: string) => call<OrgMember[]>('org_members_list', { p_org: orgId })
export const setOrgMember = (orgId: string, userId: string, p: { status?: 'APPROVED'; role?: 'ADMIN' | 'MEMBER'; unit_id?: string | null; employee_code?: string; action?: 'REMOVE' }) =>
  call<void>('set_org_member', { p_org: orgId, p_user: userId, p })
export const setMyOrgUnit = (orgId: string, unitId: string | null) => call<void>('set_my_org_unit', { p_org: orgId, p_unit: unitId })

// CLB thuộc tổ chức
export const inviteClubToOrg = (orgId: string, clubId: string) => call<void>('org_invite_club', { p_org: orgId, p_club: clubId })
export const respondOrgInvite = (orgId: string, clubId: string, accept: boolean) => call<void>('respond_org_invite', { p_org: orgId, p_club: clubId, p_accept: accept })
export const removeOrgClub = (orgId: string, clubId: string) => call<void>('remove_org_club', { p_org: orgId, p_club: clubId })
export const getClubOrgs = (clubId: string) => call<ClubOrgs>('club_orgs', { p_club: clubId })

// Chiến dịch + báo cáo
export interface CampaignInput {
  title: string; description?: string | null; metric: CampaignMetric; starts_at: string; ends_at: string
  goal_total?: number | null; goal_per_person?: number | null; min_run_km?: number
}
export const saveCampaign = (orgId: string, id: string | null, p: CampaignInput) => call<string>('save_org_campaign', { p_org: orgId, p_id: id, p })
export const cancelCampaign = (id: string) => call<void>('cancel_org_campaign', { p_id: id })
export const listCampaigns = (orgId: string) => call<CampaignSummary[]>('org_campaigns', { p_org: orgId })
export const getCampaignBoard = (id: string) => call<CampaignBoard>('org_campaign_board', { p_id: id })
export const getOrgReport = (orgId: string, from: string, to: string) => call<ReportRow[]>('org_report', { p_org: orgId, p_from: from, p_to: to })

// Admin hệ thống
export const adminOrgLeads = (status?: OrgLead['status'] | null) => call<OrgLead[]>('admin_org_leads', { p_status: status ?? null })
export const adminSetOrgLead = (id: string, status: OrgLead['status'], note?: string) => call<void>('admin_set_org_lead', { p_id: id, p_status: status, p_note: note ?? null })
export const adminListOrgs = () => call<AdminOrg[]>('admin_list_orgs')
export interface AdminOrgInput {
  name: string; kind: OrgKind; owner_email: string; seat_limit: number; club_limit: number; include_club_pro: boolean
  active_until: string | null; legal_name?: string; tax_code?: string; contact_name?: string; contact_phone?: string; contact_email?: string; lead_id?: string | null
}
export const adminCreateOrg = (p: AdminOrgInput) => call<{ id: string; invite_code: string }>('admin_create_org', { p })
export const adminUpdateOrg = (orgId: string, p: Partial<Pick<AdminOrgInput, 'seat_limit' | 'club_limit' | 'include_club_pro' | 'active_until' | 'kind'>> & { status?: 'ACTIVE' | 'SUSPENDED' }, reason: string) =>
  call<Org>('admin_update_org', { p_org: orgId, p, p_reason: reason })

/** Ảnh logo / bìa: thu nhỏ rồi tải vào org-media/<org_id>/… (≤ 2 MB) */
export async function uploadOrgImage(orgId: string, file: File, kind: 'logo' | 'cover'): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('IMAGE_TYPE')
  const bmp = await createImageBitmap(file)
  const max = kind === 'logo' ? 512 : 1600
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob>((ok, bad) => canvas.toBlob((b) => (b ? ok(b) : bad(new Error('IMAGE_TYPE'))), 'image/jpeg', 0.85))
  if (blob.size > 2 * 1024 * 1024) throw new Error('IMAGE_SIZE')
  const path = `${orgId}/${kind}-${Date.now()}.jpg`
  const { error } = await supabase.storage.from('org-media').upload(path, blob, { cacheControl: '3600', upsert: false, contentType: 'image/jpeg' })
  if (error) throw error
  return supabase.storage.from('org-media').getPublicUrl(path).data.publicUrl
}

const MESSAGES: Record<string, string> = {
  NAME_REQUIRED: 'Hãy nhập tên người liên hệ.',
  ORG_NAME_REQUIRED: 'Hãy nhập tên tổ chức (ít nhất 2 ký tự).',
  INVALID_PHONE: 'Số điện thoại chưa đúng.',
  RATE_LIMITED: 'Bạn đã gửi nhiều yêu cầu hôm nay. Chúng tôi sẽ liên hệ sớm.',
  OWNER_NOT_FOUND: 'Không tìm thấy tài khoản với email này. Người quản trị cần đăng ký RaceHub trước.',
  ORG_NOT_FOUND: 'Không tìm thấy tổ chức.',
  NOT_A_MEMBER: 'Bạn chưa là thành viên tổ chức này.',
  INVALID_CODE: 'Mã mời không đúng hoặc đã được đổi.',
  ORG_INACTIVE: 'Gói của tổ chức đã hết hạn hoặc tạm dừng. Liên hệ quản trị tổ chức.',
  ORG_FULL: 'Tổ chức đã đủ số chỗ theo hợp đồng. Quản trị tổ chức cần nâng số chỗ.',
  OWNER_CANNOT_LEAVE: 'Người sở hữu tổ chức không thể rời. Liên hệ RaceHub để chuyển quyền.',
  UNIT_EXISTS: 'Tên đơn vị đã có.',
  UNIT_LIMIT: 'Tối đa 500 đơn vị.',
  INVALID_NAME: 'Tên không hợp lệ.',
  INVALID_UNIT_LABEL: 'Tên gọi đơn vị dài 2–30 ký tự.',
  TAGLINE_TOO_LONG: 'Khẩu hiệu tối đa 80 ký tự.',
  INVALID_URL: 'Link ảnh phải bắt đầu bằng https://',
  CLUB_NOT_FOUND: 'Không tìm thấy CLB.',
  CLUB_IN_ORG: 'CLB này đang thuộc một tổ chức khác.',
  ALREADY_INVITED: 'Đã mời CLB này rồi.',
  ORG_CLUB_LIMIT: 'Đã đủ số CLB theo hợp đồng.',
  INVITE_NOT_FOUND: 'Lời mời không còn hiệu lực.',
  TITLE_REQUIRED: 'Tên chiến dịch cần 3–120 ký tự.',
  INVALID_METRIC: 'Cách tính không hợp lệ.',
  INVALID_TIME_RANGE: 'Thời gian không hợp lệ (tối đa 1 năm).',
  REASON_REQUIRED: 'Hãy ghi lý do (ít nhất 3 ký tự).',
  MEMBER_NOT_FOUND: 'Không tìm thấy thành viên.',
  IMAGE_TYPE: 'Chỉ nhận ảnh JPG, PNG hoặc WebP.',
  IMAGE_SIZE: 'Ảnh quá lớn, hãy chọn ảnh khác.',
  FORBIDDEN: 'Bạn không có quyền làm việc này.',
}

export function orgErrorMessage(e: unknown): string {
  const raw = (e as { message?: string } | null)?.message ?? ''
  const key = Object.keys(MESSAGES).find((k) => raw.includes(k))
  return key ? MESSAGES[key] : systemErrorMessage(e, 'Không thực hiện được. Hãy thử lại.')
}
