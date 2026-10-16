import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 017200: sai số cự ly Full / Half nới (98,5%–106%), đủ mọi thành tích, thành tích cá nhân
const A = '00000000-0000-0000-0000-0000000172a1'
const B = '00000000-0000-0000-0000-0000000172a2'
const CLUB = '00000000-0000-0000-0000-0000000172c1'
type Row = Record<string, any>

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${A}', 'a172@x.vn'), ('${B}', 'b172@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ('${A}', 'Hà Full', 0, 0, 1, now()), ('${B}', 'Bình Half', 0, 0, 1, now()) on conflict do nothing;
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'CLB Bests', '${A}', 'best172');
    insert into public.club_members (club_id, user_id, role, status) values ('${CLUB}', '${A}', 'OWNER', 'APPROVED'), ('${CLUB}', '${B}', 'MEMBER', 'APPROVED')
      on conflict do nothing;
  `)
}
const run = (db: PGlite, uid: string, km: number, min: number, daysAgo: number) =>
  db.query(`insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_time_s, validation_status, status)
            values ($1, 'Chạy', 'DIRECT_GPS', now() - make_interval(days => $4::int), now() - make_interval(days => $4::int) + make_interval(mins => $3::int),
                    $2::numeric, $3::int * 60, 'APPROVED', 'READY')`, [uid, km * 1000, min, daysAgo])

describe('Thành tích Full/Half đầy đủ + sai số (017200)', () => {
  let db: PGlite
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 240_000)

  it('42,129 km và 42,7 km đều là Full; 41 km và 45 km thì không; bấm tên thấy MỌI thành tích', async () => {
    await run(db, A, 42.129, 240, 20)
    await run(db, A, 42.7, 250, 15)
    await run(db, A, 42.3, 235, 10)
    await run(db, A, 42.2, 245, 6)
    await run(db, A, 41.0, 230, 4)   // thiếu quá 1,5%: không tính
    await run(db, A, 45.0, 230, 3)   // dài quá 6%: đếm lần hoàn thành nhưng không xếp thành tích
    const h = (await asUser<{ r: Row }>(db, B, '/rpc', `select public.club_hall_of_fame($1) as r`, [CLUB])).rows[0].r
    const a = h.marathon.find((x: Row) => x.name === 'Hà Full')
    expect(a.bests.map((b: Row) => b.km)).toEqual(expect.arrayContaining([42.13, 42.7, 42.3, 42.2]))
    expect(a.bests).toHaveLength(4)
    const secs = a.bests.map((b: Row) => b.best_s)
    expect(secs).toEqual([...secs].sort((x, y) => x - y))
    expect(a.times).toBe(5)
  })

  it('thành tích cá nhân: chỉ của chính mình, nhanh nhất trước', async () => {
    await run(db, B, 21.3, 110, 9)
    await run(db, B, 21.0, 100, 7)
    const mine = (await asUser<{ r: Row }>(db, B, '/rpc', `select public.my_long_bests() as r`)).rows[0].r
    expect(mine.fm).toEqual([])
    expect(mine.hm).toHaveLength(2)
    expect(mine.hm[0].best_s).toBeLessThanOrEqual(mine.hm[1].best_s)
    await expect(asUser(db, null, '/rpc', `select public.my_long_bests() as r`)).rejects.toThrow()
  })
})
