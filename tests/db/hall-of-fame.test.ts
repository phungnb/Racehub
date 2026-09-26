import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser, sanitize } from './load-schema'

// Migration 007800: cột mốc tự đăng bảng tin CLB + Đại sảnh danh vọng
const A = '00000000-0000-0000-0000-0000000078a1'
const B = '00000000-0000-0000-0000-0000000078a2'
const OUT = '00000000-0000-0000-0000-0000000078a3'
const CLUB = '00000000-0000-0000-0000-0000000078c1'
type Row = Record<string, any>
const FILE = path.join(__dirname, '../../supabase/migrations/20261001007800_hall_of_fame_milestones.sql')

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${A}', 'a78@x.vn'), ('${B}', 'b78@x.vn'), ('${OUT}', 'x78@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ('${A}', 'Minh Anh', 0, 0, 1, now()), ('${B}', 'Quốc Bảo', 0, 0, 1, now()), ('${OUT}', 'Người ngoài', 0, 0, 1, now()) on conflict do nothing;
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'CLB Đại Sảnh', '${A}', 'sanh781');
    insert into public.club_members (club_id, user_id, role, status) values ('${CLUB}', '${A}', 'OWNER', 'APPROVED'), ('${CLUB}', '${B}', 'MEMBER', 'APPROVED')
      on conflict do nothing;
  `)
}
const run = (db: PGlite, uid: string, km: number, min: number, daysAgo = 1) =>
  db.query(`insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_time_s, validation_status, status)
            values ($1, 'Chạy', 'DIRECT_GPS', now() - make_interval(days => $4::int), now() - make_interval(days => $4::int) + make_interval(mins => $3::int),
                    $2::numeric, $3::int * 60, 'APPROVED', 'READY')`, [uid, km * 1000, min, daysAgo])
const posts = async (db: PGlite) => (await db.query<Row>(`select title, meta from public.club_posts where club_id = $1 and kind = 'MILESTONE' order by created_at`, [CLUB])).rows

describe('Đại sảnh danh vọng + cột mốc (007800)', () => {
  let db: PGlite
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 240_000)

  it('Half Marathon đầu tiên + 100 km → đăng bảng tin CLB đúng một lần mỗi mốc', async () => {
    await run(db, B, 21.3, 115, 10)
    expect((await posts(db)).map((p) => p.title)).toEqual(['Quốc Bảo hoàn thành Half Marathon đầu tiên'])
    await run(db, B, 21.2, 110, 9)                                     // HM lần 2: không đăng lại
    for (let i = 0; i < 6; i++) await run(db, B, 10, 55, 8 - i)
    const p = await posts(db)
    expect(p.map((x) => x.meta.code)).toEqual(['FIRST_HM', 'KM_100'])
    expect(Number(p[1].meta.total_km)).toBeGreaterThanOrEqual(100)
  })

  it('Đại sảnh: Full / Half, kỷ lục ước tính, BXH năm; người ngoài CLB không xem được', async () => {
    await run(db, A, 42.4, 230, 5)
    await run(db, A, 5.1, 25, 3)
    const h = (await asUser<{ r: Row }>(db, B, '/rpc', `select public.club_hall_of_fame($1) as r`, [CLUB])).rows[0].r
    expect(h.marathon.map((x: Row) => x.name)).toEqual(['Minh Anh'])
    expect(h.half.map((x: Row) => x.name).sort()).toEqual(['Minh Anh', 'Quốc Bảo'])
    const fk = h.records.find((r: Row) => r.label === '5K' && r.rank === 1)
    expect(fk).toMatchObject({ name: 'Minh Anh', best_s: Math.round(1500 * 5000 / 5100) })
    expect(h.year[0]).toMatchObject({ rank: 1, name: 'Quốc Bảo' })
    expect(h.milestones.map((m: Row) => m.code)).toEqual(expect.arrayContaining(['FIRST_FM', 'FIRST_HM', 'KM_100']))
    await expect(asUser(db, OUT, '/rpc', `select public.club_hall_of_fame($1) as r`, [CLUB])).rejects.toThrow(/NOT_A_MEMBER/)
  })

  it('chạy lại migration: ghi nhận lặng lẽ, không đăng bài dồn', async () => {
    const before = (await posts(db)).length
    await db.query(`delete from public.user_milestones where user_id = $1`, [B])
    await db.exec(sanitize(fs.readFileSync(FILE, 'utf8')))
    expect((await db.query(`select code from public.user_milestones where user_id = $1`, [B])).rows.length).toBeGreaterThanOrEqual(2)
    expect((await posts(db)).length).toBe(before)
  })
})
