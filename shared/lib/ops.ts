// Chính sách vận hành (migration 009100, khoá 'ops_policy'): admin đổi trong Quản trị → Hệ thống → Chính sách vận hành,
// app đọc qua RPC ops_policy() — không phải sửa code / dựng lại app. Bản mặc định dưới đây GIỐNG private.ops_defaults()
// và chỉ dùng khi chưa đọc được máy chủ (mất mạng / chưa chạy migration).

export type FeatureKey = 'nearby' | 'market' | 'bibMarket' | 'knowledge' | 'races' | 'cups' | 'orgs'

export interface TrackingRules { autoPauseAfterS: number; longStopAskMin: number; longStopAutoStopMin: number; trimTailMin: number }
export interface AntiCheatRules {
  dailyRunLimit: number; minPaceMin: number; vehicleKmh: number; vehicleS: number; severeKmh: number; severeS: number
  highKmh: number; highS: number; spikeKmh: number; spikeMax: number
  /** 009700: ngoài thi đấu chỉ tự duyệt bài nghi vấn có điểm rủi ro ≤ số này (34 = chỉ mức Thấp) */
  autoApproveMaxScore: number
}
export interface EnterpriseContent { title: string; subtitle: string; features: { title: string; text: string }[] }
/** Một thẻ gói trên trang /goi (009200): dòng quyền lợi dùng được biến {freeSlots}, {clubMaxMembers}… (xem PLAN_VARS) */
export interface PlanCardContent { title: string; subtitle: string; perks: string[]; note: string }
export interface PlanContent { free: PlanCardContent; clubFree: PlanCardContent; org: PlanCardContent }
export interface OpsPolicy {
  version: number
  features: Record<FeatureKey, boolean>
  tracking: TrackingRules
  /** chỉ admin / máy chủ nhận được */
  antiCheat?: AntiCheatRules
  content: { enterprise: EnterpriseContent; plans: PlanContent }
}

export const FEATURES: { key: FeatureKey; label: string; hint: string }[] = [
  { key: 'nearby', label: 'Quanh đây', hint: 'Tìm runner, CLB, buổi chạy gần mình' },
  { key: 'market', label: 'Chợ Runner', hint: 'HLV, cửa hàng, dịch vụ đã xác minh' },
  { key: 'bibMarket', label: 'Chợ BIB', hint: 'Nhượng lại / tìm mua BIB giải chạy' },
  { key: 'knowledge', label: 'Kiến thức Runner', hint: 'Bài viết, giáo án' },
  { key: 'races', label: 'Giải chạy ảo', hint: 'Đăng ký, BIB, chứng nhận' },
  { key: 'cups', label: 'Thách đấu CLB', hint: 'CLB đấu CLB, giải nhiều CLB' },
  { key: 'orgs', label: 'Tổ chức / Doanh nghiệp', hint: 'Chiến dịch, BXH phòng ban' },
]

export const DEFAULT_TRACKING: TrackingRules = { autoPauseAfterS: 10, longStopAskMin: 10, longStopAutoStopMin: 30, trimTailMin: 2 }
export const DEFAULT_ANTI_CHEAT: AntiCheatRules = {
  dailyRunLimit: 20, minPaceMin: 3, vehicleKmh: 25, vehicleS: 30, severeKmh: 20, severeS: 120, highKmh: 17, highS: 180, spikeKmh: 43, spikeMax: 3, autoApproveMaxScore: 34,
}
export const DEFAULT_ENTERPRISE: EnterpriseContent = {
  title: 'Phong trào chạy bộ cho cả tổ chức',
  subtitle: 'Chiến dịch, bảng xếp hạng phòng ban, quản lý nhiều CLB và báo cáo cho nhân sự — tự động từ Strava và GPS, không cần bảng tính.',
  features: [
    { title: 'Chiến dịch sức khoẻ', text: 'Tạo chiến dịch theo tổng km, số buổi hoặc số ngày chạy; mục tiêu chung cả tổ chức và mục tiêu mỗi người.' },
    { title: 'Xếp hạng theo đơn vị', text: 'Phòng ban, chi nhánh, lớp hoặc CLB thi đua với nhau — tính cả tổng và bình quân đầu người cho công bằng.' },
    { title: 'Quản lý nhiều CLB', text: 'Liên đoàn mời CLB tham gia; thành viên CLB tự được tính vào chiến dịch. Có thể tài trợ CLB Pro cho cả hệ thống.' },
    { title: 'Báo cáo cho nhân sự', text: 'km, số buổi, số ngày chạy của từng người theo khoảng ngày; mã nhân viên, đơn vị; xuất Excel.' },
    { title: 'Thương hiệu riêng', text: 'Logo, ảnh bìa, màu chủ đề, khẩu hiệu; bảng tin nội bộ như một CLB lớn; chứng nhận hoàn thành thiết kế theo mẫu công ty.' },
    { title: 'Quản lý như phòng nhân sự', text: 'Tự duyệt theo email công ty, nhập danh sách từ Excel, đơn vị nhiều cấp, trưởng đơn vị tự quản lý người của mình.' },
    { title: 'Trao giải minh bạch', text: 'Chốt kết quả, duyệt top trước khi trao, ngày hội ×2 / ×3, quay thưởng may mắn có mã kiểm chứng.' },
    { title: 'Chống gian lận, tôn trọng riêng tư', text: 'Chỉ tính bài chạy hợp lệ (GPS, pace, duyệt); người chạy tắt chia sẻ bài nào thì bài đó không vào bảng.' },
  ],
}
export const DEFAULT_PLAN_CONTENT: PlanContent = {
  free: {
    title: 'Miễn phí', subtitle: '',
    perks: [
      'Ghi bài bằng GPS trong app hoặc tự động từ Strava',
      'Xu, XP, cấp độ, huy hiệu, nhiệm vụ, nhân vật',
      'Tham gia thử thách, CLB, giải chạy ảo, tổ chức không giới hạn',
      'Tạo miễn phí thử thách cá nhân và thử thách nhóm tới {freeSlots} người',
      'Thử thách đông hơn {freeSlots} người: trả Xu theo quy mô',
    ],
    note: 'VIP không tăng km, XP hay thứ hạng — mọi runner thi đấu công bằng.',
  },
  clubFree: {
    title: 'CLB Miễn phí', subtitle: '',
    perks: [
      'Tối đa {clubMaxMembers} thành viên',
      '{clubMaxOpen} thử thách nội bộ miễn phí cùng lúc, mỗi thử thách ≤ {clubMaxSlots} người (cần ≥ {clubMinActive} thành viên có bài chạy trong {activeDays} ngày)',
      'Tối đa {clubCaptains} quản trị viên',
      'Bảng tin, chat, lịch, điểm danh QR, quỹ VietQR, bảng xếp hạng',
      'Ngày hội ×2/×3, đại sảnh danh vọng, cửa hàng CLB, giao lưu CLB',
    ],
    note: 'CLB miễn phí vượt số thành viên vẫn giữ đủ người, chỉ chưa duyệt thêm người mới cho tới khi nâng Pro.',
  },
  org: {
    title: 'RaceHub Doanh nghiệp', subtitle: 'Báo giá riêng theo số người và thời hạn',
    perks: [
      'Chiến dịch sức khoẻ cho cả tổ chức (km, số buổi, số ngày chạy)',
      'Bảng xếp hạng phòng ban / chi nhánh / CLB — tổng và bình quân đầu người',
      'Nhập danh sách nhân viên từ Excel, tự duyệt email công ty, đơn vị nhiều cấp',
      'Báo cáo theo mã nhân viên, xuất Excel',
      'Chốt kết quả, chứng nhận hoàn thành, quay thưởng minh bạch',
      'Quản lý nhiều CLB, tài trợ CLB Pro cho cả hệ thống',
    ],
    note: '',
  },
}

/** Biến dùng trong dòng quyền lợi: app thay bằng số đang áp dụng (Kinh tế / Gói & giá). Biến hideZero = 0 (không có / không giới hạn) thì ẩn cả dòng. */
export const PLAN_VARS = [
  { key: 'freeSlots', label: 'Quy mô thử thách tạo miễn phí', hideZero: true },
  { key: 'clubMaxMembers', label: 'Thành viên tối đa CLB miễn phí', hideZero: true },
  { key: 'clubMaxOpen', label: 'Thử thách CLB miễn phí cùng lúc', hideZero: true },
  { key: 'clubMaxSlots', label: 'Quy mô thử thách CLB miễn phí', hideZero: true },
  { key: 'clubMinActive', label: 'Thành viên đang chạy tối thiểu', hideZero: false },
  { key: 'activeDays', label: 'Số ngày tính "đang chạy"', hideZero: false },
  { key: 'clubCaptains', label: 'Quản trị viên CLB miễn phí', hideZero: true },
  { key: 'proMaxOpen', label: 'Thử thách CLB Pro cùng lúc', hideZero: true },
  { key: 'proMaxSlots', label: 'Quy mô thử thách CLB Pro', hideZero: true },
] as const
export type PlanVars = Record<(typeof PLAN_VARS)[number]['key'], number>

const fmt = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
const HIDE_ZERO = new Set<string>(PLAN_VARS.filter((v) => v.hideZero).map((v) => v.key))
/** Thay biến trong các dòng quyền lợi; dòng có biến hideZero bằng 0 (vd. không giới hạn thành viên) bị ẩn */
export function renderPerks(lines: string[], vars: Partial<PlanVars>): string[] {
  return lines.flatMap((line) => {
    let hide = false
    const out = line.replace(/\{(\w+)\}/g, (m, k: string) => {
      const v = (vars as Record<string, number | undefined>)[k]
      if (v === undefined) return m
      if (!v && HIDE_ZERO.has(k)) hide = true
      return fmt(v)
    })
    return hide ? [] : [out]
  })
}

const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d)
function toCard(raw: unknown, d: PlanCardContent): PlanCardContent {
  const r = (raw ?? {}) as Record<string, unknown>
  const perks = Array.isArray(r.perks) ? r.perks.filter((x): x is string => typeof x === 'string') : []
  return { title: str(r.title, '') || d.title, subtitle: str(r.subtitle, d.subtitle), perks: perks.length ? perks : d.perks, note: str(r.note, d.note) }
}
export function toPlanContent(raw: unknown): PlanContent {
  const r = (raw ?? {}) as Record<string, unknown>
  const d = DEFAULT_PLAN_CONTENT
  return { free: toCard(r.free, d.free), clubFree: toCard(r.clubFree, d.clubFree), org: toCard(r.org, d.org) }
}

export const PLAN_CARD_LABEL: Record<keyof PlanContent, string> = { free: 'Cá nhân · Miễn phí', clubFree: 'CLB Miễn phí', org: 'Doanh nghiệp' }

/** Khớp private.valid_plan_card (009200) */
export function validatePlanContent(p: PlanContent): string | null {
  for (const k of Object.keys(PLAN_CARD_LABEL) as (keyof PlanContent)[]) {
    const c = p[k], name = PLAN_CARD_LABEL[k]
    if (c.title.trim().length < 2 || c.title.length > 60) return `${name}: tên gói cần 2–60 ký tự.`
    if (c.subtitle.length > 200) return `${name}: mô tả tối đa 200 ký tự.`
    if (c.note.length > 300) return `${name}: ghi chú tối đa 300 ký tự.`
    if (!c.perks.length || c.perks.length > 15) return `${name}: cần 1–15 dòng quyền lợi.`
    if (c.perks.some((x) => x.trim().length < 2 || x.length > 200)) return `${name}: mỗi dòng quyền lợi 2–200 ký tự.`
  }
  return null
}

export const DEFAULT_OPS: OpsPolicy = {
  version: 0,
  features: { nearby: true, market: true, bibMarket: true, knowledge: true, races: true, cups: true, orgs: true },
  tracking: DEFAULT_TRACKING,
  content: { enterprise: DEFAULT_ENTERPRISE, plans: DEFAULT_PLAN_CONTENT },
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const pickNums = <T extends object>(raw: unknown, d: T): T => {
  const r = (raw ?? {}) as Record<string, unknown>
  return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, num(r[k], v as number)])) as T
}

/** Chuẩn hoá JSON từ máy chủ (thiếu / sai kiểu → mặc định) */
export function toOps(raw: unknown): OpsPolicy {
  const r = (raw ?? {}) as Record<string, unknown>
  const f = (r.features ?? {}) as Record<string, unknown>
  const ent = ((r.content as Record<string, unknown> | undefined)?.enterprise ?? {}) as Record<string, unknown>
  const feats = Array.isArray(ent.features)
    ? (ent.features as Record<string, unknown>[]).filter((x) => typeof x?.title === 'string').map((x) => ({ title: String(x.title), text: String(x.text ?? '') }))
    : DEFAULT_ENTERPRISE.features
  return {
    version: num(r.version, 0),
    features: Object.fromEntries(FEATURES.map(({ key }) => [key, typeof f[key] === 'boolean' ? f[key] : true])) as Record<FeatureKey, boolean>,
    tracking: pickNums(r.tracking, DEFAULT_TRACKING),
    ...(r.antiCheat ? { antiCheat: pickNums(r.antiCheat, DEFAULT_ANTI_CHEAT) } : {}),
    content: {
      enterprise: {
        title: typeof ent.title === 'string' && ent.title ? ent.title : DEFAULT_ENTERPRISE.title,
        subtitle: typeof ent.subtitle === 'string' ? ent.subtitle : DEFAULT_ENTERPRISE.subtitle,
        features: feats.length ? feats : DEFAULT_ENTERPRISE.features,
      },
      plans: toPlanContent((r.content as Record<string, unknown> | undefined)?.plans),
    },
  }
}

/** Giới hạn hợp lệ (khớp private.valid_ops) — để form báo lỗi trước khi gửi */
export const TRACKING_LIMITS: Record<keyof TrackingRules, [number, number]> = {
  autoPauseAfterS: [5, 60], longStopAskMin: [3, 60], longStopAutoStopMin: [10, 240], trimTailMin: [1, 30],
}
export const ANTI_CHEAT_LIMITS: Record<keyof AntiCheatRules, [number, number]> = {
  dailyRunLimit: [3, 100], minPaceMin: [2, 5], vehicleKmh: [20, 60], vehicleS: [10, 600], severeKmh: [15, 40], severeS: [30, 1800],
  highKmh: [12, 35], highS: [30, 3600], spikeKmh: [30, 150], spikeMax: [1, 100], autoApproveMaxScore: [0, 100],
}

export function validateOps(o: Pick<OpsPolicy, 'tracking'> & { content: Pick<OpsPolicy['content'], 'enterprise'>; antiCheat?: AntiCheatRules }): string | null {
  for (const [k, [lo, hi]] of Object.entries(TRACKING_LIMITS)) {
    const v = o.tracking[k as keyof TrackingRules]
    if (!(v >= lo && v <= hi)) return `Ghi bài chạy: giá trị "${k}" phải từ ${lo} đến ${hi}.`
  }
  if (o.tracking.longStopAutoStopMin <= o.tracking.longStopAskMin) return 'Tự tạm dừng hẳn phải sau mốc hỏi Kết thúc.'
  if (o.antiCheat) {
    for (const [k, [lo, hi]] of Object.entries(ANTI_CHEAT_LIMITS)) {
      const v = o.antiCheat[k as keyof AntiCheatRules]
      if (!(v >= lo && v <= hi)) return `Chống gian lận: giá trị "${k}" phải từ ${lo} đến ${hi}.`
    }
    if (!(o.antiCheat.highKmh < o.antiCheat.severeKmh && o.antiCheat.severeKmh < o.antiCheat.vehicleKmh)) {
      return 'Ngưỡng tốc độ phải tăng dần: giữ tốc độ cao < giữ tốc độ nghiêm trọng < đi xe.'
    }
  }
  const e = o.content.enterprise
  if (e.title.trim().length < 3 || e.title.length > 90) return 'Tiêu đề trang Doanh nghiệp cần 3–90 ký tự.'
  if (e.subtitle.length > 400) return 'Mô tả trang Doanh nghiệp tối đa 400 ký tự.'
  if (!e.features.length || e.features.length > 12) return 'Trang Doanh nghiệp cần 1–12 thẻ tính năng.'
  if (e.features.some((f) => f.title.trim().length < 2 || f.title.length > 60 || f.text.length > 300)) return 'Thẻ tính năng: tiêu đề 2–60 ký tự, nội dung tối đa 300 ký tự.'
  return null
}
