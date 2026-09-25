import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 004600: nhiệm vụ bậc, trần Xu, chỉ số mới (ngày chạy, chạy sớm, km cộng đồng), thưởng vật phẩm / huy hiệu / lượt tạo,
// giới hạn số nhiệm vụ đang bật, gợi ý + ước tính cho admin
const [ADMIN, A, B, C] = ['00000000-0000-0000-0000-0000000046a1', '00000000-0000-0000-0000-0000000046a2',
  '00000000-0000-0000-0000-0000000046a3', '00000000-0000-0000-0000-0000000046a4']
const ALL = [ADMIN, A, B, C]

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ${ALL.map((id, i) => `('${id}', 'v${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values ${ALL.map((id, i) => `('${id}', 'V${i}', 0, 0, 1, now() - interval '60 days')`).join(', ')};
  `)
}
type Row = Record<string, any>
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const DAY = 86_400_000
/** Bài chạy hợp lệ bắt đầu lúc `at` */
const runAt = async (db: PGlite, uid: string, km: number, at: Date) => {
  const id = (await db.query<{ id: string }>(`
    insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
    values ($1, 'Chạy', 'STRAVA', $2::timestamptz, $2::timestamptz + interval '40 minutes', $3::numeric, $3::numeric, $4::int, 330, 'APPROVED', 'READY')
    returning id`, [uid, at.toISOString(), km * 1000, Math.round(km * 330)])).rows[0].id
  await db.query(`select private.reward_activity($1)`, [id])
  return id
}
const save = (db: PGlite, q: Row) => rpc<string>(db, ADMIN, `select public.admin_save_quest($1::jsonb) as r`, [JSON.stringify(q)])
const questXu = async (db: PGlite, uid: string, id: string) =>
  (await db.query<{ xu: string; title: string }>(`select xu, title from public.game_events where user_id = $1 and kind = 'QUEST' and payload->>'quest_id' = $2 order by created_at`, [uid, id])).rows
const mine = async (db: PGlite, uid: string, id: string) => (await rpc<Row[]>(db, uid, `select public.my_quests() as r`)).find((q) => q.id === id)!
const event = (days = 3) => ({ period: 'EVENT', starts_at: new Date(Date.now() - days * DAY).toISOString(), ends_at: new Date(Date.now() + 4 * DAY).toISOString() })

describe('Nhiệm vụ v2 (004600)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADMIN])
    await db.query(`update public.quests set is_active = false`)   // tách khỏi nhiệm vụ mẫu có sẵn
  }, 300_000)

  it('nhiệm vụ bậc "Chạy 3 / 5 / 10 km": chỉ trả tới bậc cao nhất; trần 5 Xu/ngày cắt phần vượt', async () => {
    expect(await fails(save(db, { title: 'Sai bậc', period: 'DAILY', metric: 'RUN_KM', tiers: [{ target: 5, xu: 1 }, { target: 3, xu: 1 }] }))).toContain('INVALID_TIERS')
    const id = await save(db, { title: 'Xỏ giày hôm nay', period: 'DAILY', metric: 'RUN_KM', tiers: [{ target: 3, xu: 1 }, { target: 5, xu: 1 }, { target: 10, xu: 2 }] })
    const q = (await rpc<Row[]>(db, ADMIN, `select public.admin_list_quests() as r`)).find((x) => x.id === id)!
    expect(q).toMatchObject({ target: 10, reward_xu: 4 })
    await runAt(db, A, 4, new Date(Date.now() - 60_000 * 30))
    expect((await questXu(db, A, id)).map((e) => Number(e.xu))).toEqual([1])
    expect(await mine(db, A, id)).toMatchObject({ tier_paid: 1, completed: false })
    await runAt(db, A, 11, new Date(Date.now() - 60_000 * 10))
    const ev = await questXu(db, A, id)
    expect(ev.map((e) => Number(e.xu))).toEqual([1, 3])            // bậc 2 + 3 trả gộp một lần
    expect(await mine(db, A, id)).toMatchObject({ tier_paid: 3, completed: true })

    // Nhiệm vụ ngày thứ hai thưởng 5 Xu: đã nhận 4 Xu hôm nay → chỉ trả 1 (trần ngày 5)
    const id2 = await save(db, { title: 'Hai bài hôm nay', period: 'DAILY', metric: 'RUN_COUNT', target: 2, reward_xu: 5 })
    await runAt(db, A, 3, new Date(Date.now() - 60_000 * 5))
    expect((await questXu(db, A, id2)).map((e) => Number(e.xu))).toEqual([1])
  })

  it('ngày chạy + chạy sớm trong sự kiện; giới hạn số nhiệm vụ đang bật', async () => {
    const days = await save(db, { title: '2 ngày trong sự kiện', metric: 'ACTIVE_DAYS', target: 2, reward_xu: 6, ...event() })
    const early = await save(db, { title: 'Chạy trước 7h', metric: 'EARLY_RUNS', target: 1, reward_xu: 3, params: { before_hour: 7 }, ...event() })
    // 05:30 giờ VN của hôm qua
    const vnYesterday = new Date(Date.now() + 7 * 3600_000 - DAY).toISOString().slice(0, 10)
    await runAt(db, B, 5, new Date(`${vnYesterday}T05:30:00+07:00`))
    expect(await mine(db, B, days)).toMatchObject({ progress: 1, completed: false })
    expect(await mine(db, B, early)).toMatchObject({ completed: true })
    await runAt(db, B, 5, new Date(Date.now() - 60_000))
    expect(await mine(db, B, days)).toMatchObject({ progress: 2, completed: true })

    await rpc(db, ADMIN, `select public.admin_set_quest_limits($1::jsonb) as r`, [JSON.stringify({ maxEvent: 2 })])
    expect(await fails(save(db, { title: 'Sự kiện thứ ba', metric: 'TOTAL_KM', target: 5, reward_xu: 1, ...event() }))).toContain('TOO_MANY_ACTIVE')
    await rpc(db, ADMIN, `select public.admin_set_quest_limits($1::jsonb) as r`, [JSON.stringify({ maxEvent: 10 })])
    expect(await fails(save(db, { title: 'Cộng đồng ngày', metric: 'COMMUNITY_KM', period: 'DAILY', target: 5 }))).toContain('INVALID_METRIC')
  })

  it('km cộng đồng: đạt mục tiêu thì ai góp ≥ min_km đều nhận, người góp ít hơn không', async () => {
    const id = await save(db, { title: 'Cả RaceHub 40 km', metric: 'COMMUNITY_KM', target: 40, reward_xu: 7, params: { min_km: 2 }, ...event(1) })
    // Bài trong 1 ngày qua: A (4 + 11 + 3 = 18 km), B (5 km) đã có ở trên
    await runAt(db, C, 1, new Date(Date.now() - 60_000 * 3))
    expect(await mine(db, C, id)).toMatchObject({ completed: false })
    await runAt(db, C, 1.5, new Date(Date.now() - 60_000 * 2))        // C chỉ góp 2,5 km… vẫn chưa đủ tổng
    const q = await mine(db, C, id)
    expect(Number(q.progress)).toBeLessThan(40)
    await runAt(db, B, 20, new Date(Date.now() - 60_000))               // tổng vượt 40
    const done = (await db.query<{ user_id: string }>(`select user_id from public.user_quest_progress where quest_id = $1 and completed_at is not null order by user_id`, [id])).rows.map((r) => r.user_id)
    expect(done).toEqual([A, B, C].sort())
    expect(await mine(db, C, id)).toMatchObject({ completed: true, mine: 2.5 })
  })

  it('nhiệm vụ một lần thưởng vật phẩm + huy hiệu sự kiện + lượt tạo (không XP)', async () => {
    const item = (await db.query<{ code: string; id: string }>(`select code, id from public.avatar_items where code is not null order by code`)).rows[0]
    expect(item).toBeTruthy()
    expect(await fails(save(db, { title: 'Sai vật phẩm', period: 'ONCE', metric: 'TOTAL_KM', target: 5, reward_item: 'khong_co' }))).toContain('ITEM_NOT_FOUND')
    const id = await save(db, { title: 'Chạy 5 km đầu tiên', period: 'ONCE', category: 'NEWBIE', metric: 'TOTAL_KM', target: 5, reward_xu: 2,
      reward_item: item.code, reward_badge: { title: 'Tân binh RaceHub', icon: 'Sparkles' }, reward_passes: { qty: 1, max_slots: 20, days: 30 } })
    await db.query(`delete from public.user_inventory where user_id = $1 and item_id = $2`, [C, item.id])
    await runAt(db, C, 6, new Date(Date.now() + 1_000))   // một lần: chỉ tính bài bắt đầu sau khi tạo nhiệm vụ
    expect(await mine(db, C, id)).toMatchObject({ completed: true, reward_badge: 'Tân binh RaceHub' })
    expect((await db.query(`select 1 from public.user_inventory where user_id = $1 and item_id = $2`, [C, item.id])).rows).toHaveLength(1)
    expect((await db.query(`select 1 from public.challenge_passes where owner_id = $1 and source_key like 'quest:%'`, [C])).rows).toHaveLength(1)
    const badgesC = await rpc<Row[]>(db, C, `select coalesce(jsonb_agg(to_jsonb(t)), '[]') as r from public.my_achievements() t`)
    expect(badgesC.find((b) => b.title === 'Tân binh RaceHub')).toMatchObject({ category: 'EVENT' })
    const badgesAdmin = await rpc<Row[]>(db, ADMIN, `select coalesce(jsonb_agg(to_jsonb(t)), '[]') as r from public.my_achievements() t`)
    expect(badgesAdmin.find((b) => b.title === 'Tân binh RaceHub')).toBeUndefined()   // huy hiệu giới hạn: chưa nhận thì không hiện
    const ev = (await db.query<{ xp: number; subtitle: string }>(`select xp, subtitle from public.game_events where kind = 'QUEST' and payload->>'quest_id' = $1`, [id])).rows[0]
    expect(ev.xp).toBe(0)
    expect(ev.subtitle).toContain('Huy hiệu: Tân binh RaceHub')
  })

  it('admin: số liệu gợi ý + ước tính số người đạt và Xu chi ra', async () => {
    expect(await fails(rpc(db, A, `select public.admin_quest_insights() as r`))).toContain('FORBIDDEN')
    const ins = await rpc<Row>(db, ADMIN, `select public.admin_quest_insights() as r`)
    expect(ins.runners_30d).toBeGreaterThanOrEqual(3)
    expect(ins.limits).toMatchObject({ dailyXuCap: 5, weeklyXuCap: 25, maxEvent: 10 })
    const est = await rpc<Row>(db, ADMIN, `select public.admin_quest_estimate($1::jsonb) as r`, [JSON.stringify({
      period: 'DAILY', metric: 'RUN_KM', tiers: [{ target: 3, xu: 1 }, { target: 10, xu: 2 }] })])
    expect(est).toMatchObject({ supported: true, samples: 14, open_ended: true })
    expect(est.tiers).toHaveLength(2)
    expect(est.tiers[0].completers).toBeGreaterThanOrEqual(est.tiers[1].completers)
    expect(est.periods).toBeGreaterThanOrEqual(30)
  })
})
