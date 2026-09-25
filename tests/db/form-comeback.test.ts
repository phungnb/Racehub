import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 004200: nghỉ dài không hạ cấp; phong độ 28 ngày; thưởng "chào mừng trở lại" có giới hạn
const [R, N] = ['00000000-0000-0000-0000-0000000042a1', '00000000-0000-0000-0000-0000000042a2']

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${R}', 'r@x.vn'), ('${N}', 'n@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values ('${R}', 'R', 0, 0, 1, now()), ('${N}', 'N', 0, 0, 1, now());
  `)
}
type Row = Record<string, any>
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0].r
const run = async (db: PGlite, uid: string, daysAgo: number, km = 5) => {
  const id = (await db.query<{ id: string }>(`
    insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
    values ($1, 'Chạy', 'STRAVA', now() - make_interval(days => $2), now() - make_interval(days => $2) + interval '40 minutes', $3::numeric, $3::numeric, $4::int, 330, 'APPROVED', 'READY')
    returning id`, [uid, daysAgo, km * 1000, km * 330])).rows[0].id
  await db.query(`select private.reward_activity($1)`, [id])
  return id
}
const comebacks = async (db: PGlite, uid: string) =>
  (await db.query<{ n: number }>(`select count(*)::int as n from public.game_events where user_id = $1 and kind = 'COMEBACK'`, [uid])).rows[0].n

describe('Phong độ + chào mừng trở lại (004200)', () => {
  let db: PGlite
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 300_000)

  it('chưa chạy: NEW; nghỉ lâu: LONG_BREAK nhưng cấp độ giữ nguyên', async () => {
    expect((await rpc<Row>(db, N, `select public.runner_form() as r`)).status).toBe('NEW')
    await run(db, R, 100, 10)
    const lv = (await db.query<{ level: number; xp: number }>(`select level, xp from public.profiles where id = $1`, [R])).rows[0]
    const f = await rpc<Row>(db, N, `select public.runner_form($1) as r`, [R])
    expect(f).toMatchObject({ status: 'LONG_BREAK', days_since: 100 })
    expect((await db.query<{ level: number; xp: number }>(`select level, xp from public.profiles where id = $1`, [R])).rows[0]).toEqual(lv)
  })

  it('quay lại sau ≥ 28 ngày: +10 Xu một lần; trong 90 ngày không nhận lại; bài sau đó không tính', async () => {
    await run(db, R, 40)                 // cách bài trước 60 ngày → thưởng
    expect(await comebacks(db, R)).toBe(1)
    await run(db, R, 5)                  // cách 35 ngày nhưng còn trong 90 ngày chờ → không thưởng
    await run(db, R, 4)
    expect(await comebacks(db, R)).toBe(1)
    const ev = (await db.query<{ xu: string; xp: number }>(`select xu, xp from public.game_events where user_id = $1 and kind = 'COMEBACK'`, [R])).rows[0]
    expect({ xu: Number(ev.xu), xp: ev.xp }).toEqual({ xu: 10, xp: 0 })
    expect((await rpc<Row>(db, R, `select public.runner_form() as r`)).status).toMatch(/STEADY|RISING/)
  })
})
