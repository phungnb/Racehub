// Trang Quản trị toàn diện (migration 005600): việc cần xử lý, người dùng, thử thách, nhật ký quản trị
import { supabase } from '@/shared/lib/supabase'

export interface AdminInbox { orders: number; reviews: number; partners: number; cups: number; errors: number; reports?: number; content?: number; new_users_7d: number; active_7d: number; banned: number }
export interface AdminUserDetail {
  id: string; display_name: string; avatar_url: string | null; role: string; level: number | null; xp: number | null; balance: number
  created_at: string; email: string | null; last_sign_in_at: string | null; banned_until: string | null; banned_at: string | null; banned_reason: string | null
  strava_connected: boolean; referral_code: string | null; referred_by: string | null
  plan: { plan_code: string; name: string; tier: number; ends_at: string } | null
  stats: { runs: number; km: number; pending_runs: number; last_run_at: string | null; challenges: number; orders_paid_vnd: number }
  clubs: { id: string; name: string; role: string; status: string }[]
  ledger: { type: string; description: string | null; amount: number; at: string }[]
  audit: { action: string; actor: string | null; reason: string | null; at: string }[]
}
export interface AdminChallenge {
  id: string; title: string; status: string; format: string; audience: string; start_date: string; end_date: string
  reward_xu: number; participants: number; creator: string | null; club: string | null; cancelled_reason: string | null
}
export interface AdminAuditRow {
  id: number; action: string; target: string; actor_id: string | null; actor: string | null
  old_value: unknown; new_value: unknown; reason: string | null; at: string
}

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}
export const adminInbox = () => call<AdminInbox | null>('admin_inbox')
export interface BannedUser { id: string; name: string | null; avatar_url: string | null; email: string | null; banned_at: string; reason: string | null; kind: 'ADMIN' | 'SELF_DELETED'; banned_by: string | null }
/** Tài khoản đang khóa + lý do (migration 014600) */
export const adminBannedUsers = async () => (await call<BannedUser[]>('admin_banned_users')) ?? []
export const adminUserDetail = (id: string) => call<AdminUserDetail>('admin_user_detail', { p_user: id })
export interface AdminAccount { id: string; display_name: string | null; avatar_url: string | null; email: string | null; last_sign_in_at: string | null; granted_at: string | null; is_me: boolean }
/** Quản trị viên hệ thống hiện tại (migration 011400) */
export const adminListAdmins = async () => (await call<AdminAccount[]>('admin_list_admins')) ?? []
export const adminSetUserBan = (id: string, ban: boolean, reason?: string) => call<void>('admin_set_user_ban', { p_user: id, p_ban: ban, p_reason: reason ?? null })
export const adminSetUserRole = (id: string, role: 'SYSTEM_ADMIN' | 'MEMBER', reason?: string) =>
  call<void>('admin_set_user_role', { p_user: id, p_role: role, p_reason: reason ?? null })
/** Đội quản trị (migration 011800): Quản trị chính + admin theo nhóm quyền */
export type AdminScope = 'USERS' | 'ECONOMY' | 'ORDERS' | 'CLUBS' | 'CHALLENGES' | 'SHOP' | 'CONTENT' | 'MODERATION' | 'SYSTEM' | 'AUDIT'
export const ADMIN_SCOPES: Record<AdminScope, { label: string; hint: string }> = {
  USERS: { label: 'Người dùng', hint: 'Tìm tài khoản, xem hồ sơ, khóa / mở khóa, tài khoản bất thường' },
  ECONOMY: { label: 'Kinh tế Xu', hint: 'Cộng / trừ Xu, chính sách kinh tế, gói nạp, quỹ CLB, chỉ số' },
  ORDERS: { label: 'Đơn hàng & gói', hint: 'Xác nhận thanh toán, tặng gói VIP / Pro, bảng giá' },
  CLUBS: { label: 'CLB & doanh nghiệp', hint: 'Gói CLB Pro, xóa CLB, doanh nghiệp; toàn quyền trong mọi CLB' },
  CHALLENGES: { label: 'Thử thách & giải', hint: 'Hủy thử thách, lượt tạo, chợ BIB, đơn vị tổ chức giải' },
  SHOP: { label: 'Cửa hàng & khuyến mãi', hint: 'Vật phẩm, quà, khuyến mãi, nhiệm vụ, voucher, đối tác, quay thưởng' },
  CONTENT: { label: 'Nội dung', hint: 'Knowledge, trang hướng dẫn & chính sách, thông báo hệ thống' },
  MODERATION: { label: 'Kiểm duyệt', hint: 'Báo cáo vi phạm, duyệt bài chạy, kiểm thử GPS' },
  SYSTEM: { label: 'Hệ thống', hint: 'Kiểm tra hệ thống, lỗi, chính sách vận hành, Strava' },
  AUDIT: { label: 'Nhật ký', hint: 'Xem nhật ký quản trị (chỉ đọc)' },
}
export interface TeamMember {
  id: string; display_name: string | null; avatar_url: string | null; email: string | null; last_sign_in_at: string | null; is_me: boolean
  is_owner: boolean; legacy: boolean; scopes: AdminScope[]; expires_at: string | null; expired: boolean; note: string | null; granted_at: string | null
}
export interface AdminTeam {
  owner_exists: boolean
  me: { id: string; is_owner: boolean; legacy: boolean; scopes: AdminScope[]; expires_at: string | null }
  admins: TeamMember[]
}
export const adminTeam = () => call<AdminTeam>('admin_team')
export const adminSetPermissions = (id: string, scopes: AdminScope[], expiresAt: string | null, note: string | null) =>
  call<void>('admin_set_permissions', { p_user: id, p_scopes: scopes, p_expires_at: expiresAt, p_note: note })
export const adminListChallenges = (query: string, status: string) =>
  call<AdminChallenge[]>('admin_list_challenges', { p_query: query, p_status: status }).then((x) => x ?? [])
export const adminCancelChallenge = (id: string, reason: string) => call<void>('admin_cancel_challenge', { p_challenge_id: id, p_reason: reason })
export interface AdminReport {
  id: string; reporter: string; reporter_name: string | null; target: string; target_name: string | null; context: string; reason: string; note: string | null
  status: 'OPEN' | 'RESOLVED' | 'DISMISSED'; resolution: string | null; created_at: string; resolved_at: string | null; target_reports: number; target_suspended: boolean
}
export const adminListReports = (status: 'OPEN' | 'ALL') => call<AdminReport[]>('admin_list_reports', { p_status: status }).then((x) => x ?? [])
export const adminResolveReport = (id: string, action: 'DISMISS' | 'SUSPEND', note: string | null) =>
  call<void>('admin_resolve_report', { p_id: id, p_action: action, p_note: note })
/** Hộp thư góp ý (migration 015100) */
export interface AdminFeedback {
  id: string; user_id: string; name: string | null; email: string | null; kind: 'IDEA' | 'BUG' | 'LOVE' | 'OTHER'; rating: number | null
  body: string; platform: string | null; page: string | null; status: 'NEW' | 'DONE'; admin_note: string | null
  handled_by: string | null; handled_at: string | null; created_at: string
}
export interface AdminFeedbackList { new_count: number; avg_rating: number | null; rating_count: number; items: AdminFeedback[] }
export const adminFeedbackList = (status: 'NEW' | 'DONE' | 'ALL') => call<AdminFeedbackList>('admin_feedback_list', { p_status: status })
export const adminFeedbackSetStatus = (id: string, status: 'NEW' | 'DONE', note: string | null) =>
  call<void>('admin_feedback_set_status', { p_id: id, p_status: status, p_note: note })
export const adminAuditList = (action: string | null, before: number | null) =>
  call<AdminAuditRow[]>('admin_audit_list', { p_action: action || null, p_actor: null, p_before: before }).then((x) => x ?? [])

const MESSAGES: Record<string, string> = {
  CANNOT_TARGET_SELF: 'Không thao tác lên chính tài khoản của bạn.',
  CANNOT_BAN_ADMIN: 'Không khóa được quản trị viên — gỡ quyền admin trước.',
  USER_BANNED: 'Tài khoản đang bị khóa — mở khóa trước khi cấp quyền.',
  REASON_REQUIRED: 'Hãy ghi lý do (ít nhất 3 ký tự) để lưu nhật ký.',
  CHALLENGE_CLOSED: 'Thử thách đã kết thúc hoặc đã hủy.',
  USER_NOT_FOUND: 'Không tìm thấy người dùng.',
  OWNER_REQUIRED: 'Chưa có Quản trị chính. Người giữ key hệ thống chạy lệnh đặt Quản trị chính trong Supabase SQL Editor trước.',
  OWNER_ONLY: 'Chỉ Quản trị chính mới cấp / gỡ quyền và phân quyền admin.',
  CANNOT_TARGET_OWNER: 'Không tác động được Quản trị chính (chỉ đổi được bằng key hệ thống).',
  EMAIL_REQUIRED: 'Tài khoản này chưa có email đăng nhập — không cấp quyền admin được.',
  INVALID_SCOPE: 'Nhóm quyền không hợp lệ.',
  INVALID_EXPIRY: 'Ngày hết hạn phải ở tương lai.',
  NOT_ADMIN: 'Người này chưa là admin.',
  FORBIDDEN: 'Bạn chưa được giao quyền cho việc này.',
  FEEDBACK_NOT_FOUND: 'Không tìm thấy góp ý.',
  INVALID_FEEDBACK_STATUS: 'Trạng thái góp ý không hợp lệ.',
}
export function consoleErrorMessage(e: unknown, fallback = 'Không thực hiện được. Hãy thử lại.'): string {
  const raw = (e as { message?: string } | null)?.message ?? ''
  const k = Object.keys(MESSAGES).sort((a, b) => b.length - a.length).find((x) => raw.includes(x))
  return k ? MESSAGES[k] : fallback
}

/** Nhãn tiếng Việt cho mã hành động trong nhật ký quản trị */
export const AUDIT_LABEL: Record<string, string> = {
  USER_BAN: 'Khóa tài khoản', USER_REPORT_DISMISS: 'Bỏ qua báo cáo', USER_REPORT_SUSPEND: 'Khóa Quanh đây', CONTENT_PUBLISHED: 'Đăng bài Knowledge', CONTENT_SCHEDULED: 'Hẹn giờ bài', CONTENT_ARCHIVED: 'Lưu trữ bài', CONTENT_DRAFT: 'Trả bài về nháp', CONTENT_REVIEW: 'Gửi duyệt bài', CONTENT_EXPERT_APPROVE: 'Duyệt chuyên môn', CONTENT_EXPERT_REJECT: 'Góp ý chuyên môn', CONTENT_STAFF: 'Đổi ban nội dung', BIB_HIDE: 'Ẩn tin BIB', BIB_UNHIDE: 'Hiện lại tin BIB', USER_UNBAN: 'Mở khóa tài khoản', USER_ROLE: 'Đổi quyền admin', ADMIN_SCOPES: 'Phân quyền admin', ADMIN_OWNER_SET: 'Đặt Quản trị chính', ADMIN_OWNER_UNSET: 'Bỏ Quản trị chính', CHALLENGE_CANCEL: 'Hủy thử thách',
  ADMIN_GRANT_XU: 'Cộng / trừ Xu', ADJUST_USER_XU: 'Điều chỉnh Xu', TOPUP_USER_XU: 'Nạp Xu cho người dùng', TOPUP_CLUB_FUND: 'Nạp quỹ CLB',
  PARTNER_APPROVE: 'Xác minh đối tác', PARTNER_REJECT: 'Từ chối đối tác', PARTNER_HIDE: 'Ẩn đối tác',
  CLUB_TRANSFER_OWNER: 'Trao quyền chủ nhiệm', CLUB_SET_BANK: 'Đổi tài khoản quỹ CLB', CLUB_SET_BANK_QR: 'Đổi QR quỹ CLB', SET_CLUB_PLAN: 'Đổi gói CLB',
  CONFIRM_ORDER: 'Xác nhận đơn hàng', GRANT_PLAN: 'Tặng gói VIP / Pro', GRANT_CHALLENGE_PASS: 'Cấp lượt tạo', REVOKE_CHALLENGE_PASS: 'Thu hồi lượt tạo',
  PUBLISH_CONFIG: 'Đổi chính sách kinh tế', SET_PAYMENT_ACCOUNT: 'Đổi tài khoản nhận tiền', REVIEW_ACTIVITY: 'Duyệt bài chạy',
  SAVE_PLAN: 'Sửa gói & giá', SAVE_XU_PACKAGE: 'Sửa gói nạp Xu', SAVE_PROMO: 'Sửa mã khuyến mãi', PROMO_GRANT: 'Tặng quà theo nhóm',
  SAVE_ITEM_PROMO: 'Khuyến mãi vật phẩm', END_ITEM_PROMO: 'Kết thúc KM vật phẩm', SAVE_QUEST: 'Sửa nhiệm vụ', QUEST_LIMITS: 'Giới hạn nhiệm vụ',
  SAVE_GIFT: 'Sửa quà tặng', SAVE_SHINE_ITEM: 'Sửa vật phẩm Tỏa sáng', SHINE_CONFIG: 'Cấu hình Tỏa sáng', SAVE_VOUCHER: 'Voucher tài trợ',
  SYSTEM_NOTICE: 'Bật thông báo hệ thống', SYSTEM_NOTICE_OFF: 'Tắt thông báo hệ thống', RACE_ORGANIZER: 'Quyền tổ chức giải', PUSH_TEST: 'Thử thông báo đẩy',
}
export const auditLabel = (a: string) => AUDIT_LABEL[a] ?? a.replace(/_/g, ' ').toLowerCase()

/** Tài khoản bất thường (migration 010300): dấu hiệu dùng chung tài khoản / nuôi nhiều tài khoản / ăn gian Xu */
export type RiskFlagCode = 'TWO_PLACES' | 'SHARED_DEVICE' | 'OVERLAP' | 'REFERRAL_FARM' | 'SUSPICIOUS'
export interface AccountRisk {
  user_id: string; name: string; avatar_url: string | null; email: string | null; banned: boolean; score: number
  flags: { code: RiskFlagCode; count: number }[]
}
export const adminAccountRisks = (days: number) => call<AccountRisk[]>('admin_account_risks', { p_days: days })
export const RISK_FLAG: Record<RiskFlagCode, { label: string; hint: string }> = {
  TWO_PLACES: { label: 'Hai nơi cùng lúc', hint: 'Hai bài chạy cùng giờ, điểm xuất phát cách nhau hơn 2 km — nhiều khả năng hai người dùng chung tài khoản.' },
  SHARED_DEVICE: { label: 'Chung thiết bị', hint: 'Cùng một điện thoại / trình duyệt đã đăng nhập các tài khoản khác (theo đăng ký thông báo).' },
  OVERLAP: { label: 'Bài trùng giờ', hint: 'Bài bị loại vì trùng giờ với bài khác của chính tài khoản này.' },
  REFERRAL_FARM: { label: 'Nghi nuôi lời mời', hint: 'Người được mời đã mang thưởng giới thiệu về nhưng mỗi người chỉ chạy tối đa 1 bài.' },
  SUSPICIOUS: { label: 'Bài nghi vấn', hint: 'Bài có điểm rủi ro cao (tốc độ đi xe, GPS bất thường…) bị giữ hoặc bị từ chối.' },
}
