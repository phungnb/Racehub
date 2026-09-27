import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 008800: tóm tắt chất lượng GPS của bài chạy ghi bằng app + danh sách kiểm thử thực địa cho admin
const [RUN, OTHER, ADM] = ['00000000-0000-0000-0000-0000000088a1', '00000000-0000-0000-0000-0000000088a2', '00000000-0000-0000-0000-0000000088a3']

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${RUN}', 'r@gps.vn'), ('${OTHER}', 'o@gps.vn'), ('${ADM}', 'a@gps.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ('${RUN}', 'Runner', 0, 0, 1, now()), ('${OTHER}', 'Khác', 0, 0, 1, now()), ('${ADM}', 'Admin', 0, 0, 1, now());
    update public.profiles set role = 'SYSTEM_ADMIN' where id = '${ADM}';
  `)
}
const rpc = async <T,>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0].r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }

describe('chất lượng GPS (008800)', () => {
  let db: PGlite
  const start = new Date(Date.now() - 5 * 3600_000)
  let activityId = ''
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    const pts = Array.from({ length: 121 }, (_, i) => ({ latitude: 21.03 + (i * 15) / 111_320, longitude: 105.85, accuracy: 5,
      recorded_at: new Date(start.getTime() + i * 5000).toISOString() }))
    const r = await rpc<{ activity_id: string }>(db, RUN,
      `select public.submit_and_process_activity(p_title => 'Chạy', p_source => 'DIRECT_GPS', p_started_at => $1, p_ended_at => $2,
         p_elapsed_s => 600, p_moving_s => 600, p_distance_m => 1800, p_avg_pace_s => 333, p_track_points => $3::jsonb) as r`,
      [start.toISOString(), new Date(start.getTime() + 600_000).toISOString(), JSON.stringify(pts)])
    activityId = r.activity_id
  }, 240_000)

  it('gắn tóm tắt theo giờ bắt đầu; chỉ bài của chính mình; gắn lần hai không ghi đè', async () => {
    const q = { v: 1, fixes: 600, accepted: 120, rejected: { JITTER: 400 }, platform: 'android', qa: { scenario: 'CLEAR', ref_m: 1800 } }
    expect(await rpc<boolean>(db, OTHER, `select public.activity_attach_gps_quality($1, $2::jsonb) as r`, [start.toISOString(), JSON.stringify(q)])).toBe(false)
    expect(await rpc<boolean>(db, RUN, `select public.activity_attach_gps_quality($1, $2::jsonb) as r`, [start.toISOString(), JSON.stringify(q)])).toBe(true)
    await rpc(db, RUN, `select public.activity_attach_gps_quality($1, $2::jsonb) as r`, [start.toISOString(), JSON.stringify({ ...q, fixes: 1 })])
    expect(await rpc(db, RUN, `select public.activity_gps_quality($1) as r`, [activityId])).toMatchObject({ fixes: 600, platform: 'android' })
  })

  it('riêng tư: người khác không đọc được, không đọc thẳng bảng; admin đọc được', async () => {
    expect(await fails(rpc(db, OTHER, `select public.activity_gps_quality($1) as r`, [activityId]))).toContain('FORBIDDEN')
    expect(await fails(asUser(db, RUN, '/rest', `select * from public.activity_gps_quality`))).toContain('permission denied')
    expect(await rpc(db, ADM, `select public.activity_gps_quality($1) as r`, [activityId])).toMatchObject({ fixes: 600 })
  })

  it('chặn dữ liệu quá lớn / sai kiểu', async () => {
    expect(await fails(rpc(db, RUN, `select public.activity_attach_gps_quality($1, $2::jsonb) as r`, [start.toISOString(), JSON.stringify({ x: 'a'.repeat(9000) })]))).toContain('PAYLOAD_TOO_LARGE')
    expect(await fails(rpc(db, RUN, `select public.activity_attach_gps_quality($1, '[1]'::jsonb) as r`, [start.toISOString()]))).toContain('INVALID_INPUT')
  })

  it('admin xem danh sách kiểm thử + thống kê; người thường bị chặn', async () => {
    expect(await fails(rpc(db, RUN, `select public.admin_gps_qa_list(30) as r`))).toContain('FORBIDDEN')
    const r = await rpc<{ runs: { activity_id: string; name: string; data: { qa: { scenario: string } } }[]; all: { runs: number; by_platform: Record<string, number> } }>(
      db, ADM, `select public.admin_gps_qa_list(30) as r`)
    expect(r.runs).toHaveLength(1)
    expect(r.runs[0]).toMatchObject({ activity_id: activityId, name: 'Runner', data: { qa: { scenario: 'CLEAR' } } })
    expect(r.all).toMatchObject({ runs: 1, by_platform: { android: 1 } })
  })
})
