// Chính sách vận hành (migration 009100, khoá 'ops_policy'): admin đổi trong Quản trị → Hệ thống → Chính sách vận hành,
// app đọc qua RPC ops_policy() — không phải sửa code / dựng lại app. Bản mặc định dưới đây GIỐNG private.ops_defaults()
// và chỉ dùng khi chưa đọc được máy chủ (mất mạng / chưa chạy migration).

export type FeatureKey = 'nearby' | 'market' | 'bibMarket' | 'knowledge' | 'races' | 'cups' | 'orgs'

export interface TrackingRules { autoPauseAfterS: number; longStopAskMin: number; longStopAutoStopMin: number; trimTailMin: number }
export interface AntiCheatRules {
  dailyRunLimit: number; minPaceMin: number; vehicleKmh: number; vehicleS: number; severeKmh: number; severeS: number
  highKmh: number; highS: number; spikeKmh: number; spikeMax: number
}
export interface EnterpriseContent { title: string; subtitle: string; features: { title: string; text: string }[] }
export interface OpsPolicy {
  version: number
  features: Record<FeatureKey, boolean>
  tracking: TrackingRules
  /** chỉ admin / máy chủ nhận được */
  antiCheat?: AntiCheatRules
  content: { enterprise: EnterpriseContent }
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
  dailyRunLimit: 20, minPaceMin: 3, vehicleKmh: 25, vehicleS: 30, severeKmh: 20, severeS: 120, highKmh: 17, highS: 180, spikeKmh: 43, spikeMax: 3,
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
export const DEFAULT_OPS: OpsPolicy = {
  version: 0,
  features: { nearby: true, market: true, bibMarket: true, knowledge: true, races: true, cups: true, orgs: true },
  tracking: DEFAULT_TRACKING,
  content: { enterprise: DEFAULT_ENTERPRISE },
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
    },
  }
}

/** Giới hạn hợp lệ (khớp private.valid_ops) — để form báo lỗi trước khi gửi */
export const TRACKING_LIMITS: Record<keyof TrackingRules, [number, number]> = {
  autoPauseAfterS: [5, 60], longStopAskMin: [3, 60], longStopAutoStopMin: [10, 240], trimTailMin: [1, 30],
}
export const ANTI_CHEAT_LIMITS: Record<keyof AntiCheatRules, [number, number]> = {
  dailyRunLimit: [3, 100], minPaceMin: [2, 5], vehicleKmh: [20, 60], vehicleS: [10, 600], severeKmh: [15, 40], severeS: [30, 1800],
  highKmh: [12, 35], highS: [30, 3600], spikeKmh: [30, 150], spikeMax: [1, 100],
}

export function validateOps(o: Pick<OpsPolicy, 'tracking' | 'content'> & { antiCheat?: AntiCheatRules }): string | null {
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
