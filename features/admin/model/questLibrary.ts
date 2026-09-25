// Thư viện gợi ý nhiệm vụ cho admin: mẫu dùng ngay, dịp trong năm (Việt Nam), gợi ý theo số liệu thật.
// Nguyên tắc (docs/HUONG_DAN… & đặc tả): nhiệm vụ không cho XP; Xu nhỏ, có trần ngày / tuần; nhiệm vụ bậc thay cho
// nhiều nhiệm vụ trùng nhau; phần thưởng lớn là vật phẩm / huy hiệu giới hạn, không phải Xu.
import type { AdminQuest, QuestCategory, QuestInsights, QuestMetric, QuestPeriod } from '../api/commerceApi'

export type QuestDraft = Omit<AdminQuest, 'is_active' | 'starts_at' | 'ends_at' | 'min_vip_tier'> & { days?: number }

export interface QuestTemplate {
  key: string
  /** Vì sao nên dùng — hiện dưới tên mẫu */
  why: string
  draft: QuestDraft
}

const T = (key: string, why: string, d: Partial<QuestDraft> & Pick<QuestDraft, 'title' | 'period' | 'metric'>): QuestTemplate => ({
  key, why,
  draft: { description: null, target: d.tiers?.at(-1)?.target ?? 1, reward_xu: d.tiers ? d.tiers.reduce((s, t) => s + t.xu, 0) : 0, category: 'RUN', params: {}, tiers: null, icon: 'Target', ...d },
})

export const QUEST_TEMPLATES: QuestTemplate[] = [
  // ------------------ Hằng ngày (trần 5 Xu/ngày) ------------------
  T('d_steps', 'Một nhiệm vụ bậc thay cho 3 nhiệm vụ 3K / 5K / 10K — ai cũng có mức vừa sức',
    { title: 'Xỏ giày hôm nay', period: 'DAILY', metric: 'RUN_KM', icon: 'Footprints', tiers: [{ target: 3, xu: 1 }, { target: 5, xu: 1 }, { target: 10, xu: 2 }] }),
  T('d_1k', 'Hạ rào cản: chỉ cần ra đường 1 km', { title: 'Chạy ít nhất 1 km', period: 'DAILY', metric: 'RUN_COUNT', target: 1, reward_xu: 1, params: { min_km: 1 }, icon: 'Footprints', category: 'CONSISTENCY' }),
  T('d_early', 'Tạo thói quen chạy sáng', { title: 'Chim sớm', description: 'Chạy trước 7 giờ sáng', period: 'DAILY', metric: 'EARLY_RUNS', target: 1, reward_xu: 1, params: { before_hour: 7, min_km: 2 }, icon: 'Sunrise', category: 'CONSISTENCY' }),
  T('d_5k', 'Mốc quen thuộc của runner phong trào', { title: 'Một bài 5K', period: 'DAILY', metric: 'RUN_KM', target: 5, reward_xu: 2, icon: 'Route' }),
  // ------------------ Hằng tuần (trần 25 Xu/tuần) ------------------
  T('w_days', 'Nhất quán quan trọng hơn quãng đường — không ép chạy mỗi ngày',
    { title: 'Chạy đều trong tuần', period: 'WEEKLY', metric: 'ACTIVE_DAYS', icon: 'CalendarDays', category: 'CONSISTENCY', params: { min_km: 1 }, tiers: [{ target: 2, xu: 2 }, { target: 3, xu: 2 }, { target: 4, xu: 2 }] }),
  T('w_km', 'Mục tiêu tuần theo bậc: người mới và người chạy lâu năm đều có động lực',
    { title: 'Tích lũy km tuần', period: 'WEEKLY', metric: 'TOTAL_KM', icon: 'Route', tiers: [{ target: 10, xu: 2 }, { target: 20, xu: 3 }, { target: 30, xu: 5 }] }),
  T('w_weekend', 'Cuối tuần là lúc runner rảnh nhất', { title: 'Cuối tuần năng động', period: 'WEEKLY', metric: 'WEEKEND_RUNS', target: 1, reward_xu: 2, params: { min_km: 3 }, icon: 'Sun', category: 'CONSISTENCY' }),
  T('w_long', 'Mỗi tuần một bài dài — nền tảng cho 21K / 42K', { title: 'Bài chạy dài của tuần', period: 'WEEKLY', metric: 'RUN_KM', target: 10, reward_xu: 5, icon: 'Mountain' }),
  T('w_10k2', 'Cho nhóm chạy nhiều', { title: 'Hai bài từ 10 km', period: 'WEEKLY', metric: 'RUN_COUNT', target: 2, reward_xu: 6, params: { min_km: 10 }, icon: 'Flame' }),
  T('w_challenge', 'Kéo runner vào thử thách', { title: 'Về đích một thử thách', period: 'WEEKLY', metric: 'CHALLENGE_FINISHES', target: 1, reward_xu: 5, icon: 'Trophy', category: 'CHALLENGE' }),
  T('w_early', 'Duy trì chạy sáng', { title: 'Hai buổi chạy sớm', period: 'WEEKLY', metric: 'EARLY_RUNS', target: 2, reward_xu: 3, params: { before_hour: 7, min_km: 2 }, icon: 'Sunrise', category: 'CONSISTENCY' }),
  T('w_community', 'Cả cộng đồng cùng một mục tiêu — ai góp ≥ 3 km cũng nhận',
    { title: 'Cả RaceHub cùng chạy', period: 'WEEKLY', metric: 'COMMUNITY_KM', target: 1000, reward_xu: 3, params: { min_km: 3 }, icon: 'Users', category: 'COMMUNITY' }),
  // ------------------ Hằng tháng ------------------
  T('m_km', '100 km/tháng là mốc nhiều runner đặt ra',
    { title: 'Tháng này chạy bao xa?', period: 'MONTHLY', metric: 'TOTAL_KM', icon: 'Route', tiers: [{ target: 50, xu: 5 }, { target: 100, xu: 10 }, { target: 200, xu: 15 }] }),
  T('m_days', 'Thói quen: 12 ngày chạy/tháng ≈ 3 buổi/tuần',
    { title: 'Ngày chạy trong tháng', period: 'MONTHLY', metric: 'ACTIVE_DAYS', icon: 'CalendarCheck', category: 'CONSISTENCY', tiers: [{ target: 8, xu: 3 }, { target: 12, xu: 5 }, { target: 20, xu: 8 }] }),
  T('m_challenges', 'Tăng số người chơi thử thách', { title: 'Ba thử thách trong tháng', period: 'MONTHLY', metric: 'CHALLENGE_FINISHES', target: 3, reward_xu: 8, icon: 'Trophy', category: 'CHALLENGE' }),
  T('m_community', 'Mục tiêu lớn cho cả cộng đồng, thưởng huy hiệu giới hạn',
    { title: 'RaceHub 10.000 km', period: 'MONTHLY', metric: 'COMMUNITY_KM', target: 10000, reward_xu: 0, params: { min_km: 10 }, icon: 'Globe', category: 'COMMUNITY', reward_badge: { title: 'Góp sức 10.000 km', icon: 'Globe' } }),
  // ------------------ Một lần (người mới / cột mốc) ------------------
  T('o_first', 'Người mới: bài chạy đầu tiên trên RaceHub', { title: 'Bài chạy đầu tiên', period: 'ONCE', metric: 'RUN_COUNT', target: 1, reward_xu: 2, params: { min_km: 1 }, icon: 'Sparkles', category: 'NEWBIE' }),
  T('o_10k', 'Người mới: tích 10 km', { title: '10 km đầu tiên', period: 'ONCE', metric: 'TOTAL_KM', target: 10, reward_xu: 3, icon: 'Route', category: 'NEWBIE' }),
  T('o_3days', 'Người mới: tạo thói quen trong tuần đầu', { title: 'Ba ngày chạy đầu tiên', period: 'ONCE', metric: 'ACTIVE_DAYS', target: 3, reward_xu: 3, icon: 'CalendarDays', category: 'NEWBIE' }),
  T('o_challenge', 'Người mới: vào hệ sinh thái thử thách', { title: 'Thử thách đầu tiên về đích', period: 'ONCE', metric: 'CHALLENGE_FINISHES', target: 1, reward_xu: 5, icon: 'Trophy', category: 'NEWBIE' }),
  // ------------------ Sự kiện (admin chọn ngày) ------------------
  T('e_weekend', 'Chạy cả hai ngày cuối tuần', { title: 'Weekend Warrior', period: 'EVENT', days: 3, metric: 'WEEKEND_RUNS', target: 2, reward_xu: 5, params: { min_km: 3 }, icon: 'Sun', category: 'CONSISTENCY' }),
  T('e_7days', '7 ngày chạy trong 10 ngày — thưởng huy hiệu', { title: '7 ngày xỏ giày', period: 'EVENT', days: 10, metric: 'ACTIVE_DAYS', target: 7, reward_xu: 5, icon: 'Flame', category: 'CONSISTENCY', reward_badge: { title: '7 ngày xỏ giày', icon: 'Flame' } }),
  T('e_comeback', 'Kéo runner lâu không chạy quay lại', { title: 'Quay lại đường chạy', period: 'EVENT', days: 7, metric: 'RUN_COUNT', target: 1, reward_xu: 5, params: { min_km: 2 }, icon: 'RotateCcw', category: 'CONSISTENCY' }),
  T('e_community', 'Mục tiêu chung ngắn ngày', { title: 'Cùng nhau 1.000 km', period: 'EVENT', days: 7, metric: 'COMMUNITY_KM', target: 1000, reward_xu: 3, params: { min_km: 3 }, icon: 'Users', category: 'COMMUNITY', reward_badge: { title: 'Cùng nhau 1.000 km', icon: 'Users' } }),
]

export const PERIOD_LABEL: Record<QuestPeriod, string> = { DAILY: 'Hằng ngày', WEEKLY: 'Hằng tuần', MONTHLY: 'Hằng tháng', EVENT: 'Sự kiện', ONCE: 'Một lần' }
export const CATEGORY_LABEL: Record<QuestCategory, string> = {
  RUN: 'Chạy', CONSISTENCY: 'Đều đặn', CHALLENGE: 'Thử thách', COMMUNITY: 'Cộng đồng', NEWBIE: 'Người mới', SOCIAL: 'Kết nối',
}

// ------------------------------------------------------------------------------------------------
// Dịp trong năm
// ------------------------------------------------------------------------------------------------
/** Mùng 1 Tết và Rằm tháng Tám (dương lịch) — âm lịch nên ghi sẵn theo năm */
const TET: Record<number, string> = { 2026: '2026-02-17', 2027: '2027-02-06', 2028: '2028-01-26', 2029: '2029-02-13', 2030: '2030-02-03' }
const TRUNG_THU: Record<number, string> = { 2026: '2026-09-25', 2027: '2027-09-15', 2028: '2028-10-03', 2029: '2029-09-22', 2030: '2030-09-12' }

export interface Occasion {
  key: string
  name: string
  /** Ngày diễn ra (giờ VN, yyyy-mm-dd) */
  date: string
  /** Nhiệm vụ gợi ý: bắt đầu `startOffset` ngày trước dịp, kéo dài `days` ngày */
  ideas: (QuestDraft & { startOffset: number; days: number; note: string })[]
}

const idea = (d: Partial<QuestDraft> & Pick<QuestDraft, 'title' | 'metric' | 'target'>, startOffset: number, days: number, note: string) =>
  ({ description: null, reward_xu: 0, category: 'RUN' as QuestCategory, params: {}, tiers: null, icon: 'PartyPopper', period: 'EVENT' as QuestPeriod, ...d, startOffset, days, note })

function occasionsOf(year: number): Occasion[] {
  const d = (m: number, day: number) => `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const list: Occasion[] = [
    { key: 'newyear', name: 'Năm mới', date: d(1, 1), ideas: [
      idea({ title: `Khai xuân ${year}`, description: 'Chạy trong 3 ngày đầu năm', metric: 'RUN_COUNT', target: 1, reward_xu: 5, params: { min_km: 1 }, icon: 'PartyPopper', reward_badge: { title: `Khởi đầu ${year}`, icon: 'PartyPopper' } }, 0, 3, 'Huy hiệu năm mới — ai cũng muốn có'),
      idea({ title: `${year} km đầu năm cho cả cộng đồng`, metric: 'COMMUNITY_KM', target: year, reward_xu: 3, params: { min_km: 3 }, icon: 'Users', category: 'COMMUNITY' }, 0, 7, 'Con số năm làm mục tiêu chung')] },
    { key: 'valentine', name: 'Valentine', date: d(2, 14), ideas: [
      idea({ title: 'Chạy 14,2 km dịp Valentine', metric: 'TOTAL_KM', target: 14.2, reward_xu: 5, icon: 'Heart' }, -2, 3, 'Con số 14/2')] },
    { key: 'women83', name: 'Quốc tế Phụ nữ 8/3', date: d(3, 8), ideas: [
      idea({ title: 'Chạy 8,3 km mừng 8/3', metric: 'RUN_KM', target: 8.3, reward_xu: 5, icon: 'Flower2', reward_badge: { title: 'Hoa 8/3', icon: 'Flower2' } }, -1, 3, 'Con số 8.3 km, dễ nhớ')] },
    { key: 'sport273', name: 'Ngày Thể thao Việt Nam 27/3', date: d(3, 27), ideas: [
      idea({ title: 'Ngày Thể thao Việt Nam', description: 'Chạy 2,7 km trở lên trong ngày 27/3', metric: 'RUN_KM', target: 2.7, reward_xu: 3, icon: 'Medal' }, 0, 1, 'Nhiệm vụ nhẹ cho mọi người')] },
    { key: 'reunion', name: '30/4 – 1/5', date: d(4, 30), ideas: [
      idea({ title: 'Chạy 30,4 km dịp lễ 30/4 – 1/5', metric: 'TOTAL_KM', target: 30.4, reward_xu: 10, icon: 'Flag', reward_badge: { title: 'Thống nhất 30/4', icon: 'Flag' } }, 0, 5, 'Kỳ nghỉ dài — mục tiêu tổng km vừa sức'),
      idea({ title: 'Cả nước cùng chạy 30.400 km', metric: 'COMMUNITY_KM', target: 30400, reward_xu: 3, params: { min_km: 5 }, icon: 'Users', category: 'COMMUNITY' }, 0, 5, 'Điều chỉnh mục tiêu theo số runner đang hoạt động')] },
    { key: 'children', name: 'Quốc tế Thiếu nhi 1/6', date: d(6, 1), ideas: [
      idea({ title: 'Chạy cùng con', description: 'Một bài chạy nhẹ từ 1 km trong ngày 1/6', metric: 'RUN_COUNT', target: 1, reward_xu: 3, params: { min_km: 1 }, icon: 'Baby' }, 0, 1, 'Gắn kết gia đình')] },
    { key: 'runday', name: 'Global Running Day', date: firstWednesdayOfJune(year), ideas: [
      idea({ title: 'Global Running Day', description: 'Chạy ít nhất 1 km cùng runner khắp thế giới', metric: 'RUN_COUNT', target: 1, reward_xu: 3, params: { min_km: 1 }, icon: 'Globe', reward_badge: { title: `Running Day ${year}`, icon: 'Globe' } }, 0, 1, 'Ngày chạy bộ toàn cầu (thứ Tư đầu tháng 6)')] },
    { key: 'national', name: 'Quốc khánh 2/9', date: d(9, 2), ideas: [
      idea({ title: 'Chạy 2,9 km ngày Quốc khánh', metric: 'RUN_KM', target: 2.9, reward_xu: 3, icon: 'Flag' }, 0, 1, 'Nhẹ nhàng cho mọi người'),
      idea({ title: 'Tuần lễ Quốc khánh 29 km', metric: 'TOTAL_KM', target: 29, reward_xu: 8, icon: 'Flag', reward_badge: { title: 'Tự hào 2/9', icon: 'Flag' } }, -3, 7, 'Cho runner chăm')] },
    { key: 'women2010', name: 'Phụ nữ Việt Nam 20/10', date: d(10, 20), ideas: [
      idea({ title: 'Chạy 20,10 km mừng 20/10', metric: 'TOTAL_KM', target: 20.1, reward_xu: 5, icon: 'Flower2' }, -2, 4, 'Con số 20.10 km')] },
    { key: 'teacher', name: 'Nhà giáo Việt Nam 20/11', date: d(11, 20), ideas: [
      idea({ title: 'Chạy tri ân 20/11', description: 'Chạy 11 km trong tuần lễ', metric: 'TOTAL_KM', target: 11, reward_xu: 5, icon: 'GraduationCap' }, -3, 5, 'Nhắc runner là giáo viên, học sinh')] },
    { key: 'xmas', name: 'Giáng sinh', date: d(12, 24), ideas: [
      idea({ title: 'Chạy Giáng sinh', description: 'Chạy 2 ngày trong dịp Noel', metric: 'ACTIVE_DAYS', target: 2, reward_xu: 5, icon: 'Gift', reward_badge: { title: `Noel ${year}`, icon: 'Gift' } }, -1, 4, 'Huy hiệu mùa lễ')] },
    { key: 'yearend', name: 'Tổng kết năm', date: d(12, 31), ideas: [
      idea({ title: 'Về đích năm cũ', description: 'Chạy ít nhất 3 km trong ngày cuối năm', metric: 'RUN_KM', target: 3, reward_xu: 3, icon: 'Sparkles' }, 0, 1, 'Kết thúc năm trên đường chạy')] },
    { key: 'season', name: 'Mùa giải cuối năm', date: d(10, 1), ideas: [
      idea({ title: 'Chuẩn bị mùa giải: 100 km tháng 10', metric: 'TOTAL_KM', target: 100, reward_xu: 10, icon: 'Mountain', tiers: [{ target: 50, xu: 4 }, { target: 100, xu: 6 }] }, 0, 31, 'Tháng 10–12 dày đặc giải marathon')] },
  ]
  if (TET[year]) list.push({ key: 'tet', name: 'Tết Nguyên đán', date: TET[year], ideas: [
    idea({ title: 'Chạy xông đất', description: 'Chạy trong 3 ngày Tết (mùng 1 – mùng 3)', metric: 'RUN_COUNT', target: 1, reward_xu: 10, params: { min_km: 1 }, icon: 'Sparkles', reward_badge: { title: `Xông đất ${year}`, icon: 'Sparkles' } }, 0, 3, 'Nhiệm vụ được chờ đợi nhất năm'),
    idea({ title: 'Tết khỏe: 3 ngày chạy trong kỳ nghỉ', metric: 'ACTIVE_DAYS', target: 3, reward_xu: 8, icon: 'CalendarDays', category: 'CONSISTENCY' }, -2, 9, 'Giữ thói quen qua kỳ nghỉ dài')] })
  if (TRUNG_THU[year]) list.push({ key: 'midautumn', name: 'Trung thu', date: TRUNG_THU[year], ideas: [
    idea({ title: 'Chạy dưới trăng Rằm', description: 'Chạy ít nhất 3 km trong dịp Trung thu', metric: 'RUN_COUNT', target: 1, reward_xu: 5, params: { min_km: 3 }, icon: 'Moon', reward_badge: { title: `Trăng Rằm ${year}`, icon: 'Moon' } }, -1, 3, 'Chạy tối cùng gia đình')] })
  return list
}

function firstWednesdayOfJune(year: number) {
  const d = new Date(Date.UTC(year, 5, 1))
  const add = (3 - d.getUTCDay() + 7) % 7
  return `${year}-06-${String(1 + add).padStart(2, '0')}`
}

/** Ngày hôm nay theo giờ VN (yyyy-mm-dd) */
export const vnToday = (now: number) => new Date(now + 7 * 3600_000).toISOString().slice(0, 10)
const dayDiff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000)

/** Các dịp trong `horizon` ngày tới (kể cả dịp đang diễn ra hôm nay), gần nhất trước */
export function upcomingOccasions(now: number, horizon = 45): (Occasion & { inDays: number })[] {
  const today = vnToday(now)
  const y = Number(today.slice(0, 4))
  return [...occasionsOf(y), ...occasionsOf(y + 1)]
    .map((o) => ({ ...o, inDays: dayDiff(o.date, today) }))
    .filter((o) => o.inDays >= 0 && o.inDays <= horizon)
    .sort((a, b) => a.inDays - b.inDays)
}

/** Giờ bắt đầu / kết thúc (00:00 giờ VN) cho một ý tưởng theo dịp */
export function occasionWindow(date: string, startOffset: number, days: number) {
  const start = new Date(`${date}T00:00:00+07:00`)
  start.setUTCDate(start.getUTCDate() + startOffset)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + days)
  return { starts_at: start.toISOString(), ends_at: end.toISOString() }
}

/** Khung cho mẫu sự kiện: bắt đầu 00:00 ngày mai (giờ VN), kéo dài `days` ngày; mẫu Weekend bắt đầu thứ Sáu tới */
export function templateWindow(t: QuestDraft, now: number) {
  if (t.period !== 'EVENT') return { starts_at: null, ends_at: null }
  const today = vnToday(now)
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay()        // 0 = CN
  const offset = t.metric === 'WEEKEND_RUNS' ? ((5 - dow + 7) % 7 || 7) : 1
  return occasionWindow(today, offset, t.days ?? 7)
}

// ------------------------------------------------------------------------------------------------
// Gợi ý theo số liệu
// ------------------------------------------------------------------------------------------------
export interface DataSuggestion { key: string; title: string; reason: string; tone: 'info' | 'warn'; draft?: QuestDraft }

const roundTo = (v: number, step: number, min: number) => Math.max(min, Math.round(v / step) * step)
/** 3 bậc tăng dần, không trùng: dưới trung vị / trung vị / nhóm chăm */
function stepTargets(p: { p40?: number; p50?: number; p75?: number }, step: number, min: number) {
  const a = roundTo(p.p40 ?? 0, step, min)
  const b = Math.max(a + step, roundTo(p.p50 ?? 0, step, min))
  const c = Math.max(b + step, roundTo(p.p75 ?? 0, step, min))
  return [a, b, c]
}

export function suggestFromInsights(i: QuestInsights): DataSuggestion[] {
  const out: DataSuggestion[] = []
  if (!i.runners_30d) {
    out.push({ key: 'nodata', tone: 'info', title: 'Chưa đủ dữ liệu', reason: 'Chưa có bài chạy hợp lệ trong 30 ngày — dùng mẫu hoặc dịp bên dưới.' })
    return out
  }
  if ((i.week_km.n ?? 0) >= 5) {
    const [a, b, c] = stepTargets(i.week_km, 5, 5)
    out.push({ key: 'week_km', tone: 'info', title: `Tuần tích lũy ${a} / ${b} / ${c} km`,
      reason: `4 tuần qua, một nửa runner chạy từ ${Math.round(i.week_km.p50 ?? 0)} km/tuần trở lên — đặt 3 bậc quanh mức đó để ai cũng có mục tiêu vừa sức.`,
      draft: { title: 'Tích lũy km tuần', period: 'WEEKLY', metric: 'TOTAL_KM', target: c, reward_xu: 10, description: null, icon: 'Route', category: 'RUN', params: {},
               tiers: [{ target: a, xu: 2 }, { target: b, xu: 3 }, { target: c, xu: 5 }] } })
    const [d1, d2, d3] = stepTargets(i.week_days, 1, 1).map((x) => Math.min(x, 7))
    if (d3 > d2 && d2 > d1) out.push({ key: 'week_days', tone: 'info', title: `Chạy ${d1} / ${d2} / ${d3} ngày trong tuần`,
      reason: `Trung vị ${Math.round(i.week_days.p50 ?? 0)} ngày chạy/tuần — thưởng sự đều đặn thay vì quãng đường.`,
      draft: { title: 'Chạy đều trong tuần', period: 'WEEKLY', metric: 'ACTIVE_DAYS', target: d3, reward_xu: 6, description: null, icon: 'CalendarDays', category: 'CONSISTENCY', params: { min_km: 1 },
               tiers: [{ target: d1, xu: 2 }, { target: d2, xu: 2 }, { target: d3, xu: 2 }] } })
  }
  if (i.inactive_14_60 > 0) out.push({ key: 'comeback', tone: 'warn', title: `${i.inactive_14_60} runner đã nghỉ 2 – 8 tuần`,
    reason: 'Tạo nhiệm vụ sự kiện 7 ngày "Quay lại đường chạy" (1 bài từ 2 km) — kết hợp thưởng Chào mừng trở lại đang có.',
    draft: QUEST_TEMPLATES.find((t) => t.key === 'e_comeback')!.draft })
  if (i.weekend_share < 0.25) out.push({ key: 'weekend', tone: 'info', title: 'Cuối tuần ít người chạy',
    reason: `Chỉ ${Math.round(i.weekend_share * 100)}% bài chạy rơi vào thứ Bảy / Chủ nhật — thử "Weekend Warrior".`,
    draft: QUEST_TEMPLATES.find((t) => t.key === 'e_weekend')!.draft })
  if (i.early_share >= 0.3) out.push({ key: 'early', tone: 'info', title: `${Math.round(i.early_share * 100)}% bài chạy trước 7h`,
    reason: 'Cộng đồng thích chạy sáng — nhiệm vụ "Chim sớm" dễ tạo hứng thú.', draft: QUEST_TEMPLATES.find((t) => t.key === 'd_early')!.draft })
  const weekly = (i.community_km_30d / 30) * 7
  if (weekly >= 50) {
    const target = roundTo(weekly * 1.2, weekly >= 5000 ? 500 : 50, 50)
    out.push({ key: 'community', tone: 'info', title: `Cả RaceHub cùng chạy ${target.toLocaleString('vi-VN')} km tuần này`,
      reason: `Tuần gần đây cộng đồng chạy khoảng ${Math.round(weekly).toLocaleString('vi-VN')} km — đặt mục tiêu chung cao hơn 20%.`,
      draft: { ...QUEST_TEMPLATES.find((t) => t.key === 'w_community')!.draft, target } })
  }
  if (i.new_users_14d > 0) out.push({ key: 'newbie', tone: 'info', title: `${i.new_users_14d} người mới trong 14 ngày`,
    reason: 'Bật bộ nhiệm vụ "Một lần" (bài đầu tiên, 10 km đầu tiên, 3 ngày chạy) để giữ chân người mới.',
    draft: QUEST_TEMPLATES.find((t) => t.key === 'o_first')!.draft })
  if (i.run_xu_30d > 0 && i.quest_xu_30d / i.run_xu_30d > 0.5) out.push({ key: 'inflation', tone: 'warn', title: 'Xu nhiệm vụ đang cao',
    reason: `30 ngày qua Xu từ nhiệm vụ bằng ${Math.round((i.quest_xu_30d / i.run_xu_30d) * 100)}% Xu từ chạy. Nên thưởng bằng vật phẩm / huy hiệu thay vì tăng Xu.` })
  return out
}

/** Chỉ số hiển thị cho người dùng (đơn vị) */
export const METRIC_UNIT: Record<QuestMetric, string> = {
  TOTAL_KM: 'km', WEEK_KM: 'km', RUN_KM: 'km', COMMUNITY_KM: 'km', RUN_COUNT: 'bài', ACTIVE_DAYS: 'ngày', WEEK_RUN_DAYS: 'ngày',
  WEEKEND_RUNS: 'bài', EARLY_RUNS: 'bài', CHALLENGE_FINISHES: 'thử thách', CHALLENGE_JOINS: 'thử thách', CHECKIN: 'lần',
}
