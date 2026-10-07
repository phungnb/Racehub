import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 013700: bài trùng giờ dài hơn nhưng nghi vấn → chờ duyệt; duyệt hợp lệ thì loại bài trùng giờ
const id = (n: number) => `00000000-0000-0000-0000-0000000137${String(n).padStart(2, '0')}`
const RUNNER = id(1)
const CAPTAIN = id(2)
const CLB = '00000000-0000-0000-0000-0000000137c1'

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${RUNNER}', 'r@q137.vn'), ('${CAPTAIN}', 'c@q137.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ('${RUNNER}', 'Runner', 0, 0, 1, now()), ('${CAPTAIN}', 'Chủ nhiệm', 0, 0, 1, now()) on conflict do nothing;
  `)
}
// Bài bắt đầu `h` giờ trước, kéo dài 2 giờ, `km` km
const run = async (db: PGlite, km: number, validation: 'APPROVED' | 'PENDING', h = 5) =>
  (await db.query<{ id: string }>(`
    insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
    values ($1, 'Chạy', 'DIRECT_GPS', now() - make_interval(hours => $2), now() - make_interval(hours => $2) + interval '2 hours', $3, $3, 7200, 360, $4, $5) returning id`,
    [RUNNER, h, km * 1000, validation, validation === 'APPROVED' ? 'READY' : 'PENDING'])).rows[0].id
const get = async (db: PGlite, aid: string) =>
  (await db.query<{ validation_status: string; review_detail: string | null }>(`select validation_status, review_detail from public.activities where id = $1`, [aid])).rows[0]

describe('bài trùng giờ dài hơn nghi vấn (013700)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.exec(`
      insert into public.clubs (id, name, owner_id, invite_code) values ('${CLB}', 'CLB 137', '${CAPTAIN}', 'q137');
      insert into public.club_members (club_id, user_id, role, status) values ('${CLB}', '${CAPTAIN}', 'OWNER', 'APPROVED'), ('${CLB}', '${RUNNER}', 'MEMBER', 'APPROVED') on conflict do nothing;
    `)
  }, 240_000)

  it('bài dài hơn hẳn nhưng nghi vấn: chờ duyệt (không bị loại); bài ngắn hơn: bị loại', async () => {
    const counted = await run(db, 5, 'APPROVED')
    const longer = await run(db, 8, 'PENDING')
    const shorter = await run(db, 4, 'PENDING')
    expect((await get(db, longer)).validation_status).toBe('PENDING')
    expect((await get(db, longer)).review_detail).toContain('Trùng giờ')
    expect((await get(db, shorter)).validation_status).toBe('REJECTED')
    expect((await get(db, counted)).validation_status).toBe('APPROVED')

    // Người chạy không tự duyệt qua "chỉ tính phần có GPS" khi còn bài trùng giờ
    const ok = (await db.query<{ r: boolean }>(`select private.can_accept_verified(a) as r from public.activities a where a.id = $1`, [longer])).rows[0].r
    expect(ok).toBe(false)

    // Chủ nhiệm CLB duyệt hợp lệ → bài đang tính bị loại cùng lúc, bài mới được tính
    await asUser(db, CAPTAIN, '/rpc', `select public.review_activity($1, 'APPROVED') as r`, [longer])
    expect((await get(db, longer)).validation_status).toBe('APPROVED')
    const old = await get(db, counted)
    expect(old.validation_status).toBe('REJECTED')
    expect(old.review_detail).toContain('duyệt hợp lệ')
  })

  it('duyệt "không hợp lệ" thì bài đang tính giữ nguyên', async () => {
    const counted = await run(db, 5, 'APPROVED', 20)
    const longer = await run(db, 8, 'PENDING', 20)
    await asUser(db, CAPTAIN, '/rpc', `select public.review_activity($1, 'REJECTED') as r`, [longer])
    expect((await get(db, longer)).validation_status).toBe('REJECTED')
    expect((await get(db, counted)).validation_status).toBe('APPROVED')
  })
})
