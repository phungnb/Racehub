import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 009600: bảng điều khiển ban quản trị + tổng kết tuần / tháng
const [OWN, CAP, MEM, IDLE, NEWBIE] = ['00000000-0000-0000-0000-0000000096a1', '00000000-0000-0000-0000-0000000096a2',
  '00000000-0000-0000-0000-0000000096a3', '00000000-0000-0000-0000-0000000096a4', '00000000-0000-0000-0000-0000000096a5']
const CLUB = '00000000-0000-0000-0000-0000000096c1'
type Row = Record<string, any>

async function seed(db: PGlite) {
  const all = [OWN, CAP, MEM, IDLE, NEWBIE]
  await db.exec(`
    insert into auth.users (id, email) values ${all.map((u, i) => `('${u}', 'u${i}@d96.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${all.map((u, i) => `('${u}', 'Người ${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
  `)
}
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r as T
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
// Bài chạy lúc 06:00 giờ VN, n ngày trước
const run = (db: PGlite, uid: string, km: number, daysAgo: number) =>
  db.query(`insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_time_s, validation_status, status)
            values ($1, 'Chạy', 'DIRECT_GPS', (((now() at time zone 'Asia/Ho_Chi_Minh')::date - $3::int) + time '06:00') at time zone 'Asia/Ho_Chi_Minh',
                    (((now() at time zone 'Asia/Ho_Chi_Minh')::date - $3::int) + time '07:00') at time zone 'Asia/Ho_Chi_Minh', $2::numeric, 3600, 'APPROVED', 'READY')`,
  [uid, km * 1000, daysAgo])

describe('bảng điều khiển ban quản trị + tổng kết (009600)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.exec(`
      insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'CLB 96', '${OWN}', 'dash961');
      insert into public.club_members (club_id, user_id, role, status, joined_at) values
        ('${CLUB}', '${OWN}', 'OWNER', 'APPROVED', now() - interval '90 days'), ('${CLUB}', '${CAP}', 'CAPTAIN', 'APPROVED', now() - interval '90 days'),
        ('${CLUB}', '${MEM}', 'MEMBER', 'APPROVED', now() - interval '90 days'), ('${CLUB}', '${IDLE}', 'MEMBER', 'APPROVED', now() - interval '90 days'),
        ('${CLUB}', '${NEWBIE}', 'MEMBER', 'PENDING', now()) on conflict do nothing;
    `)
    await run(db, MEM, 10, 8)
    await run(db, MEM, 5, 9)
    await run(db, CAP, 8, 10)
    await run(db, IDLE, 5, 60)
    await run(db, MEM, 3, 40)
  }, 240_000)

  it('chỉ ban quản trị xem bảng điều khiển: đơn chờ, người lâu không chạy, quỹ, cài đặt tổng kết', async () => {
    expect(await fails(rpc(db, MEM, `select public.club_admin_dashboard($1) as r`, [CLUB]))).toContain('FORBIDDEN')
    const d = await rpc(db, CAP, `select public.club_admin_dashboard($1) as r`, [CLUB])
    expect(d).toMatchObject({ members: 4, recap: { weekly: true, monthly: true }, finance: { balance: 0, claims: 0 }, draws: { ready: 0, live: 0 } })
    expect(d.pending.map((p: Row) => p.user_id)).toEqual([NEWBIE])
    expect(d.inactive.map((p: Row) => p.user_id).sort()).toEqual([OWN, IDLE].sort())
    expect(d.this_week).toMatchObject({ run_count: expect.any(Number) })
  })

  it('tổng kết: đăng một lần mỗi kỳ; tắt thì không đăng; ban quản trị bấm "Đăng ngay"', async () => {
    await rpc(db, OWN, `select public.set_club_recap($1, false, false) as r`, [CLUB])
    expect((await db.query<{ n: number }>(`select public.post_weekly_club_recaps() as n`)).rows[0].n).toBe(0)
    expect((await db.query<{ n: number }>(`select public.post_monthly_club_recaps() as n`)).rows[0].n).toBe(0)
    expect(await fails(rpc(db, MEM, `select public.set_club_recap($1, true, true) as r`, [CLUB]))).toContain('FORBIDDEN')
    await rpc(db, OWN, `select public.set_club_recap($1, true, true) as r`, [CLUB])
    // tuần trước có bài (8–10 ngày trước có thể rơi vào tuần trước hoặc trước nữa) → dùng tháng / tuần theo dữ liệu thật
    const w1 = (await db.query<{ n: number }>(`select public.post_weekly_club_recaps() as n`)).rows[0].n
    const w2 = (await db.query<{ n: number }>(`select public.post_weekly_club_recaps() as n`)).rows[0].n
    expect(w2).toBe(0)
    const posts = await db.query<{ meta: Row; title: string }>(`select meta, title from public.club_posts where club_id = $1 and kind = 'RECAP'`, [CLUB])
    expect(posts.rows).toHaveLength(w1)
    // đăng ngay kỳ tháng trước (bài 40 ngày trước luôn thuộc tháng trước hoặc xa hơn; nếu tháng trước trống thì báo không đăng)
    const r = await fails(rpc(db, CAP, `select public.club_post_recap_now($1, 'MONTH') as r`, [CLUB]))
    expect(r === 'OK' || r.includes('RECAP_NOT_POSTED')).toBe(true)
    expect(await fails(rpc(db, CAP, `select public.club_post_recap_now($1, 'MONTH') as r`, [CLUB]))).toContain('RECAP_NOT_POSTED')   // không đăng trùng
  })

  it('nội dung tổng kết một kỳ: km, top km, top điểm CLB, buổi và lượt điểm danh', async () => {
    await rpc(db, OWN, `select public.save_club_point_rules($1, $2::jsonb, 'ALL') as r`, [CLUB, JSON.stringify({ rules: [{ name: 'Mỗi km', per: 'KM', points: 1 }] })])
    const m = await db.query<{ m: Row }>(`select private.club_recap_meta($1, now() - interval '20 days', now()) as m`, [CLUB])
    const meta = m.rows[0].m
    expect(meta).toMatchObject({ run_count: 3, active_members: 2 })
    expect(Number(meta.distance_m)).toBe(23000)
    expect(meta.top[0]).toMatchObject({ user_id: MEM })
    expect(meta.points_top[0]).toMatchObject({ user_id: MEM, points: 15 })
  })
})
