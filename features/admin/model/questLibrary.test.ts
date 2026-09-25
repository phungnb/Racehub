import { describe, expect, it } from 'vitest'
import { QUEST_TEMPLATES, occasionWindow, suggestFromInsights, templateWindow, upcomingOccasions, vnToday } from './questLibrary'
import type { QuestInsights } from '../api/commerceApi'

const at = (iso: string) => Date.parse(iso)

describe('thư viện nhiệm vụ', () => {
  it('mẫu hợp lệ: bậc tăng dần, mục tiêu = bậc cuối, không vượt trần Xu ngày / tuần', () => {
    for (const t of QUEST_TEMPLATES) {
      const d = t.draft
      if (d.tiers) {
        d.tiers.forEach((x, i) => i && expect(x.target).toBeGreaterThan(d.tiers![i - 1].target))
        expect(d.target).toBe(d.tiers.at(-1)!.target)
        expect(d.reward_xu).toBe(d.tiers.reduce((s, x) => s + x.xu, 0))
      }
      if (d.period === 'DAILY') expect(d.reward_xu).toBeLessThanOrEqual(5)
      if (d.period === 'WEEKLY') expect(d.reward_xu).toBeLessThanOrEqual(25)
      if (d.metric === 'COMMUNITY_KM') expect(['WEEKLY', 'MONTHLY', 'EVENT']).toContain(d.period)
      expect(t.draft).not.toHaveProperty('reward_xp')
    }
    expect(new Set(QUEST_TEMPLATES.map((t) => t.key)).size).toBe(QUEST_TEMPLATES.length)
  })

  it('dịp sắp tới theo giờ VN: 25/9/2026 là Trung thu; 2/9 sắp tới khi đang cuối tháng 8', () => {
    expect(vnToday(at('2026-09-24T18:00:00Z'))).toBe('2026-09-25')
    const sep = upcomingOccasions(at('2026-09-25T03:00:00Z'), 45).map((o) => [o.key, o.inDays])
    expect(sep[0]).toEqual(['midautumn', 0])
    expect(sep.map((x) => x[0])).toContain('season')      // 1/10
    expect(sep.map((x) => x[0])).toContain('women2010')
    const aug = upcomingOccasions(at('2026-08-25T03:00:00Z'), 10)
    expect(aug.map((o) => o.key)).toEqual(['national'])
    expect(upcomingOccasions(at('2026-12-20T03:00:00Z'), 20).map((o) => o.key)).toEqual(['xmas', 'yearend', 'newyear'])
  })

  it('khung giờ: bắt đầu 00:00 giờ VN; Weekend Warrior bắt đầu thứ Sáu tới', () => {
    expect(occasionWindow('2026-04-30', 0, 5)).toEqual({ starts_at: '2026-04-29T17:00:00.000Z', ends_at: '2026-05-04T17:00:00.000Z' })
    const w = templateWindow(QUEST_TEMPLATES.find((t) => t.key === 'e_weekend')!.draft, at('2026-09-23T03:00:00Z'))   // thứ Tư
    expect(w.starts_at).toBe('2026-09-24T17:00:00.000Z')                                                           // 00:00 thứ Sáu 25/9
  })

  it('gợi ý theo số liệu: bậc km tuần quanh trung vị, cảnh báo runner nghỉ và Xu nhiệm vụ cao', () => {
    const ins = {
      users_total: 500, new_users_14d: 12, runners_7d: 120, runners_30d: 200, inactive_14_60: 35,
      week_km: { p40: 11, p50: 16, p75: 27, n: 300 }, week_days: { p40: 2, p50: 3, p75: 4 }, month_km: {}, month_days: {}, run_km: {},
      early_share: 0.42, weekend_share: 0.2, community_km_30d: 12000, quest_xu_30d: 900, run_xu_30d: 1200,
      limits: { dailyXuCap: 5, weeklyXuCap: 25, maxDaily: 3, maxWeekly: 4, maxMonthly: 5, maxEvent: 6, maxOnce: 6 },
    } as QuestInsights
    const s = suggestFromInsights(ins)
    const wk = s.find((x) => x.key === 'week_km')!
    expect(wk.draft!.tiers!.map((t) => t.target)).toEqual([10, 15, 25])
    expect(s.find((x) => x.key === 'week_days')!.draft!.tiers!.map((t) => t.target)).toEqual([2, 3, 4])
    expect(s.map((x) => x.key)).toEqual(expect.arrayContaining(['comeback', 'weekend', 'early', 'community', 'newbie', 'inflation']))
    expect(s.find((x) => x.key === 'community')!.draft!.target).toBe(3350)
    expect(suggestFromInsights({ ...ins, runners_30d: 0 }).map((x) => x.key)).toEqual(['nodata'])
  })
})
