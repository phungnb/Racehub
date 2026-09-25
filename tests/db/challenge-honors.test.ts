import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 004900: vinh danh thử thách (CLB Pro / VIP)
const id = (n: number) => `00000000-0000-0000-0000-0000000049${String(n).padStart(2, '0')}`
const [ORG, R1, R2, R3, R4, OUT] = [1, 2, 3, 4, 5, 6].map(id)
const CLUB = '00000000-0000-0000-0000-0000000049c1'
const CH = '00000000-0000-0000-0000-0000000049d1'
const CH2 = '00000000-0000-0000-0000-0000000049d2'
const RUNNERS = [R1, R2, R3, R4]

async function seed(db: PGlite) {
  const users = [ORG, R1, R2, R3, R4, OUT]
  await db.exec(`
    insert into auth.users (id, email) values ${users.map((u, i) => `('${u}', 'h${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${users.map((u, i) => `('${u}', 'Runner ${i}', 0, 0, 1, now() - interval '90 days')`).join(', ')} on conflict do nothing;
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'Hồ Tây', '${ORG}', 'hn0001');
    insert into public.club_members (club_id, user_id, role, status) values ('${CLUB}', '${ORG}', 'OWNER', 'APPROVED') on conflict do nothing;
  `)
}
const rpc = async <T,>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0].r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
type Honor = { enabled: boolean; status: string; allowed: boolean; can_manage: boolean; preview: boolean
  honorees: { category: string; rank: number; user_id: string; value: number; display_name: string; hidden: boolean; photo_url: string | null }[] }
const url = (uid: string, ch = CH) => `https://x.supabase.co/storage/v1/object/public/honor-media/${ch}/${uid}/a.png`
const save = (db: PGlite, uid: string, p: object, ch = CH) => rpc<Honor>(db, uid, `select public.save_challenge_honor($1, $2::jsonb) as r`, [ch, JSON.stringify(p)])
const honor = (db: PGlite, uid: string, ch = CH) => rpc<Honor>(db, uid, `select public.challenge_honor($1) as r`, [ch])

describe('vinh danh thử thách (004900)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.exec(`
    insert into public.challenges (id, title, start_date, end_date, target_value, target_km, min_km, status, created_by, target_club_id, target_audience)
      values ('${CH}', 'Tháng 9 chạy đều', now() - interval '12 days', now() - interval '2 days', 100, 100, 1, 'ACTIVE', '${ORG}', '${CLUB}', 'PUBLIC'),
             ('${CH2}', 'Vừa xong', now() - interval '5 days', now() - interval '1 hour', 10, 10, 1, 'ACTIVE', '${ORG}', '${CLUB}', 'PUBLIC');
    insert into public.challenge_participants (challenge_id, profile_id, status, current_progress, distance_m, streak_days) values
      ('${CH}', '${R1}', 'JOINED', 80, 80000, 5), ('${CH}', '${R2}', 'JOINED', 120, 120000, 3),
      ('${CH}', '${R3}', 'JOINED', 60, 60000, 8), ('${CH}', '${R4}', 'JOINED', 10, 10000, 1),
      ('${CH2}', '${R1}', 'JOINED', 5, 5000, 1);
  `)
    // chuỗi ngày liên tiếp: R3 chạy 4 ngày liền, R1 2 ngày liền
    for (const [u, days] of [[R3, [9, 8, 7, 6, 2]], [R1, [5, 4]]] as const) {
      const pid = (await db.query<{ id: string }>(`select id from public.challenge_participants where challenge_id = $1 and profile_id = $2`, [CH, u])).rows[0].id
      for (const d of days) {
        const a = (await db.query<{ id: string }>(`insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
          values ($1, 'Chạy', 'STRAVA', now() - make_interval(days => $2), now() - make_interval(days => $2) + interval '30 minutes', 5000, 5000, 1650, 330, 'APPROVED', 'READY') returning id`, [u, d])).rows[0].id
        await db.query(`delete from public.challenge_progress_events where activity_id = $1`, [a])
        await db.query(`insert into public.challenge_progress_events (challenge_id, participant_id, activity_id, day, distance_m, counted_m) values ($1, $2, $3, (now() - make_interval(days => $4))::date, 5000, 5000) on conflict do nothing`, [CH, pid, a, d])
      }
    }
    // số liệu cố định cho test (trigger bài chạy đã tính lại tiến độ)
    for (const [u, prog, dist, days] of [[R1, 80, 80000, 5], [R2, 120, 120000, 3], [R3, 60, 60000, 8], [R4, 10, 10000, 1]] as const) {
      await db.query(`update public.challenge_participants set current_progress = $3, distance_m = $4, streak_days = $5 where challenge_id = $1 and profile_id = $2`, [CH, u, prog, dist, days])
    }
  }, 240_000)

  it('chỉ CLB Pro / VIP được bật; chỉ BTC lưu; hạng mục sai bị từ chối', async () => {
    const cfg = { categories: [{ key: 'TOP', title: 'Top thành tích', count: 3 }, { key: 'STREAK', count: 2 }, { key: 'CUSTOM1', title: 'Tinh thần thép', users: [R4] }] }
    expect(await fails(save(db, ORG, cfg))).toContain('HONOR_PRO_REQUIRED')
    expect((await honor(db, ORG)).allowed).toBe(false)
    await db.query(`update public.clubs set plan = 'PRO', pro_until = now() + interval '30 days' where id = $1`, [CLUB])
    expect(await fails(save(db, R1, cfg))).toContain('FORBIDDEN')
    expect(await fails(save(db, ORG, { categories: [{ key: 'HACK' }] }))).toContain('INVALID_HONOR_CATEGORIES')
    expect(await fails(save(db, ORG, { categories: [{ key: 'TOP' }, { key: 'TOP' }] }))).toContain('INVALID_HONOR_CATEGORIES')
    const h = await save(db, ORG, cfg)
    expect(h).toMatchObject({ allowed: true, can_manage: true, status: 'DRAFT', preview: true })
    // bản nháp: BTC xem trước, người ngoài không thấy danh sách
    expect(h.honorees.filter((x) => x.category === 'TOP').map((x) => x.user_id)).toEqual([R2, R1, R3])
    expect(h.honorees.filter((x) => x.category === 'STREAK').map((x) => [x.user_id, Number(x.value)])).toEqual([[R3, 4], [R1, 2]])
    expect(h.honorees.find((x) => x.category === 'CUSTOM1')?.user_id).toBe(R4)
    expect((await honor(db, OUT)).honorees).toEqual([])
  })

  it('thiết kế: khung ảnh runner hợp lệ; ảnh ngoài kho / khổ lạ bị chặn', async () => {
    const design = { format: 'square', template: 'podium', layers: [
      { id: 'p1', type: 'photo', bind: 'r1', shape: 'hex', zoom: 9, border: 99 },
      { id: 't1', type: 'text', bind: 'r1_name', fx: 'gold' },
      { id: 'bg', type: 'image', src: url(ORG) }] }
    const base = { categories: [{ key: 'TOP', count: 3 }] }
    expect(await fails(save(db, ORG, { ...base, design: { ...design, format: 'A3' } }))).toContain('INVALID_BIB_DESIGN')
    expect(await fails(save(db, ORG, { ...base, design: { ...design, layers: [{ type: 'photo', src: 'https://evil.com/a.png' }] } }))).toContain('INVALID_HONOR_IMAGE')
    const h = await rpc<{ design: { layers: Record<string, unknown>[] } }>(db, ORG, `select public.save_challenge_honor($1, $2::jsonb) as r`, [CH, JSON.stringify({ ...base, design })])
    expect(h.design.layers[0]).toMatchObject({ type: 'photo', bind: 'r1', shape: 'hex', zoom: 4, border: 40 })
    expect(h.design.layers[1]).toMatchObject({ bind: 'r1_name', fx: 'gold' })
  })

  it('công bố sau 24 giờ; người được vinh danh nhận thông báo + huy hiệu; người ngoài xem được', async () => {
    await save(db, ORG, { categories: [{ key: 'TOP', count: 3 }, { key: 'KM', count: 1 }, { key: 'CUSTOM1', title: 'Tinh thần thép', users: [R4] }] })
    await save(db, ORG, { categories: [{ key: 'TOP', count: 1 }] }, CH2)
    expect(await fails(rpc(db, ORG, `select public.publish_challenge_honor($1) as r`, [CH2]))).toContain('HONOR_REVIEW_PENDING')
    expect(await fails(rpc(db, R1, `select public.publish_challenge_honor($1) as r`, [CH]))).toContain('FORBIDDEN')
    const h = await rpc<Honor>(db, ORG, `select public.publish_challenge_honor($1) as r`, [CH])
    expect(h).toMatchObject({ status: 'PUBLISHED', preview: false })
    expect(h.honorees.map((x) => `${x.category}:${x.rank}`)).toEqual(['CUSTOM1:1', 'KM:1', 'TOP:1', 'TOP:2', 'TOP:3'])
    const pub = await honor(db, OUT)
    expect(pub.honorees).toHaveLength(5)
    const notes = (await db.query(`select user_id from public.notifications where kind = 'HONOR'`)).rows.map((r) => (r as { user_id: string }).user_id).sort()
    expect(notes).toEqual([R1, R2, R3, R4].sort())
    const badge = (await db.query(`select u.user_id from public.user_achievements u join public.achievements a on a.id = u.achievement_id where a.code = 'HONORED'`)).rows
    expect(badge).toHaveLength(4)
    // công bố lại: không báo trùng
    await rpc(db, ORG, `select public.publish_challenge_honor($1) as r`, [CH])
    expect((await db.query(`select 1 from public.notifications where kind = 'HONOR'`)).rows).toHaveLength(4)
  })

  it('runner tự đổi ảnh / ẩn mình; BTC chỉ đổi ảnh, không ẩn thay được', async () => {
    const q = `select public.set_honor_pref($1, $2, $3::jsonb) as r`
    expect(await fails(rpc(db, R1, q, [CH, R1, JSON.stringify({ photo_url: 'https://evil.com/x.png' })]))).toContain('INVALID_HONOR_IMAGE')
    await rpc(db, R1, q, [CH, R1, JSON.stringify({ photo_url: url(R1) })])
    expect((await honor(db, OUT)).honorees.find((x) => x.user_id === R1)?.photo_url).toBe(url(R1))
    expect(await fails(rpc(db, ORG, q, [CH, R2, JSON.stringify({ hidden: true })]))).toContain('FORBIDDEN')
    expect(await fails(rpc(db, R3, q, [CH, R2, JSON.stringify({ photo_url: url(R3) })]))).toContain('FORBIDDEN')
    await rpc(db, ORG, q, [CH, R2, JSON.stringify({ photo_url: url(ORG) })])
    expect((await db.query(`select 1 from public.notifications where kind = 'HONOR' and user_id = $1`, [R2])).rows).toHaveLength(2)
    await rpc(db, R2, q, [CH, R2, JSON.stringify({ hidden: true })])
    const r2 = (await honor(db, OUT)).honorees.find((x) => x.user_id === R2)!
    expect(r2).toMatchObject({ hidden: true, display_name: 'VĐV ẩn danh', photo_url: null })
    expect(await fails(rpc(db, OUT, q, [CH, OUT, JSON.stringify({ hidden: true })]))).toContain('NOT_A_PARTICIPANT')
  })
})
