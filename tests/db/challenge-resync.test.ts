import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 015700: "Đồng bộ lại dữ liệu" thử thách — quyền + tính lại các bài đã có trong khoảng thời gian thử thách
const [A, B, C, D] = ['1', '2', '3', '4'].map((n) => `00000000-0000-0000-0000-00000000f7a${n}`)
const CH = '00000000-0000-0000-0000-00000000f7c1'

const rpc = async <T,>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<T>(db, uid, '/rpc', sql, params)).rows
const fails = async (db: PGlite, uid: string, sql: string, params: unknown[] = []) => {
  try { await asUser(db, uid, '/rpc', sql, params) } catch (e) { return (e as Error).message }
  return 'OK'
}

describe('đồng bộ lại dữ liệu thử thách (015700)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed: async (d) => {
      await d.exec(`
        insert into auth.users (id, email) values ('${A}', 'a@x.vn'), ('${B}', 'b@x.vn'), ('${C}', 'c@x.vn'), ('${D}', 'd@x.vn');
        insert into public.profiles (id, display_name, xu, xp, level, created_at) values
          ('${A}', 'Chủ', 0, 0, 1, now()), ('${B}', 'Runner B', 0, 0, 1, now()), ('${C}', 'Người ngoài', 0, 0, 1, now()), ('${D}', 'Runner D', 0, 0, 1, now()) on conflict do nothing;
        insert into public.challenges (id, title, start_date, end_date, target_value, target_km, min_km, status, created_by, target_audience)
          values ('${CH}', 'Cả năm', now() - interval '200 days', now() + interval '100 days', 500, 500, 1, 'ACTIVE', '${A}', 'PUBLIC');
        insert into public.connected_accounts (user_id, provider, provider_user_id) values ('${B}', 'STRAVA', 'b-1');
        -- Bài chạy 150 ngày trước (ngoài cửa sổ 30 ngày của đồng bộ thường) đã nhập từ trước khi B vào thử thách
        insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
          values ('${B}', 'Chạy cũ', 'STRAVA', now() - interval '150 days', now() - interval '150 days' + interval '30 minutes', 5000, 5000, 1800, 360, 'APPROVED', 'READY');
        insert into public.challenge_participants (challenge_id, profile_id, status) values ('${CH}', '${B}', 'JOINED'), ('${CH}', '${D}', 'JOINED');
      `)
    } })
  }, 240_000)

  it('chỉ người tạo / admin được xem danh sách và bấm', async () => {
    expect(await fails(db, C, `select public.challenge_resync_targets($1)`, [CH])).toContain('FORBIDDEN')
    expect(await fails(db, C, `select public.challenge_resync_apply($1)`, [CH])).toContain('FORBIDDEN')
    expect(await fails(db, A, `select public.challenge_resync_targets('00000000-0000-0000-0000-000000000000')`)).toContain('CHALLENGE_NOT_FOUND')
  })

  it('targets: chỉ thành viên đã nối Strava, kèm mốc thời gian', async () => {
    const r = (await rpc<{ t: { members: { user_id: string }[]; not_connected: number; start_date: string } }>(db, A, `select public.challenge_resync_targets($1) as t`, [CH]))[0].t
    expect(r.members.map((m) => m.user_id)).toEqual([B])
    expect(r.not_connected).toBe(1)
    expect(Date.parse(r.start_date)).toBeLessThan(Date.now() - 190 * 86400_000)
  })

  it('apply: tính bài cũ vào thử thách, chạy lại không tính hai lần', async () => {
    const prog = async () => Number((await db.query<{ p: string }>(`select current_progress as p from public.challenge_participants where challenge_id = $1 and profile_id = $2`, [CH, B])).rows[0].p)
    // Trigger khi vào thử thách đã tính sẵn bài này → xoá tiến độ để mô phỏng bài chạy được nhập/duyệt sau
    await db.exec(`delete from public.challenge_progress_events; select private.challenge_recompute_participant(id) from public.challenge_participants;`)
    expect(await prog()).toBe(0)
    const first = (await rpc<{ r: { applied: number } }>(db, A, `select public.challenge_resync_apply($1) as r`, [CH]))[0].r
    expect(first.applied).toBe(1)
    expect(await prog()).toBe(5)
    const again = (await rpc<{ r: { applied: number } }>(db, A, `select public.challenge_resync_apply($1) as r`, [CH]))[0].r
    expect(again.applied).toBe(0)
    expect(await prog()).toBe(5)
  })
})
