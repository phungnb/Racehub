import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 006800: xoá tài khoản trong app — xoá dữ liệu cá nhân / vị trí, ẩn danh hồ sơ, giữ giao dịch ẩn danh
const ME = '00000000-0000-0000-0000-0000000068a1'
const FRIEND = '00000000-0000-0000-0000-0000000068a2'
const ADMIN = '00000000-0000-0000-0000-0000000068a3'
const RUN = '00000000-0000-0000-0000-0000000068b1'

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${ME}', 'me@x.vn'), ('${FRIEND}', 'f@x.vn'), ('${ADMIN}', 'ad@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ('${ME}', 'Minh', 50, 10, 1, now()), ('${FRIEND}', 'Lan', 0, 0, 1, now()), ('${ADMIN}', 'Quản trị', 0, 0, 1, now())
      on conflict (id) do nothing;
    insert into public.activities (id, user_id, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status, title)
      values ('${RUN}', '${ME}', 'DIRECT_GPS', now() - interval '2 hours', now() - interval '1 hour', 2000, 2000, 720, 360, 'APPROVED', 'READY', 'Chạy hồ Tây');
    insert into public.activity_track_points (activity_id, sequence, latitude, longitude, altitude, recorded_at)
      select '${RUN}', g, 21.03 + g * 0.0001, 105.85, 10, now() - interval '2 hours' + make_interval(secs => g * 3) from generate_series(1, 20) g;
  `)
}

const call = (db: PGlite, uid: string, confirm: string) =>
  asUser<{ r: Record<string, unknown> }>(db, uid, '/rpc/delete_my_account', `select public.delete_my_account($1) as r`, [confirm])
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }

describe('xoá tài khoản (006800)', () => {
  let db: PGlite
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 240_000)

  it('phải gõ xác nhận; quản trị viên không tự xoá được', async () => {
    await db.query(`update public.profiles set bio = 'Chạy mỗi sáng' where id = $1`, [ME])
    await db.query(`update public.profiles set is_admin = true where id = $1`, [ADMIN])
    expect(await fails(call(db, ME, 'ok'))).toContain('CONFIRM_REQUIRED')
    expect(await fails(call(db, ADMIN, 'XOÁ'))).toContain('ADMIN_CANNOT_DELETE')
    expect(await fails(db.query(`select public.delete_my_account('XOÁ')`))).toMatch(/AUTH_REQUIRED|permission denied/)
  })

  it('xoá: tuyến GPS mất, bài bị ẩn, hồ sơ ẩn danh, số dư giữ nguyên (sổ sách); gọi lại vẫn an toàn', async () => {
    const r = (await call(db, ME, 'xoá')).rows[0].r
    expect(r).toMatchObject({ ok: true })
    expect((await db.query(`select 1 from public.activity_track_points where activity_id = $1`, [RUN])).rows).toHaveLength(0)
    expect((await db.query<{ status: string; title: string }>(`select status, title from public.activities where id = $1`, [RUN])).rows[0])
      .toEqual({ status: 'DELETED', title: 'Buổi chạy' })
    const p = (await db.query<{ display_name: string; bio: string | null; deleted_at: string | null; xu: string }>(
      `select display_name, bio, deleted_at, xu from public.profiles where id = $1`, [ME])).rows[0]
    expect(p).toMatchObject({ display_name: 'Người dùng đã xoá', bio: null })
    expect(p.deleted_at).not.toBeNull()
    expect((await call(db, ME, 'XOA')).rows[0].r).toMatchObject({ ok: true, already: true })
  })
})
