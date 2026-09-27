import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 009100: chính sách vận hành — admin đổi quy tắc không cần sửa code; có phiên bản, kiểm tra hợp lệ, lịch sử, khôi phục
const [U, ADM] = ['00000000-0000-0000-0000-0000000091a1', '00000000-0000-0000-0000-0000000091a2']
async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${U}', 'u@o.vn'), ('${ADM}', 'a@o.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values ('${U}', 'U', 0, 0, 1, now()), ('${ADM}', 'A', 0, 0, 1, now());
    update public.profiles set role = 'SYSTEM_ADMIN' where id = '${ADM}';
    insert into public.challenges (id, title, start_date, end_date, target_value, target_km, min_km, status, created_by, target_audience)
      values ('00000000-0000-0000-0000-0000000091c9', 'Thử thách', now() - interval '10 days', now() + interval '10 days', 50, 50, 1, 'ACTIVE', '${U}', 'PUBLIC');
    insert into public.challenge_participants (challenge_id, profile_id, status) values ('00000000-0000-0000-0000-0000000091c9', '${U}', 'JOINED');
  `)
}
type Ops = { version: number; features: Record<string, boolean>; tracking: Record<string, number>; antiCheat?: Record<string, number>; content: { enterprise: { title: string; features: unknown[] } } }
const rpc = async <T,>(db: PGlite, uid: string | null, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r as T
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }

describe('chính sách vận hành (009100)', () => {
  let db: PGlite
  let hoursBack = 30
  const submit = async (mps: number, seconds: number) => {
    const start = new Date(Date.now() - (hoursBack -= 3) * 3600_000)
    const pts = Array.from({ length: seconds / 5 + 1 }, (_, i) => ({ latitude: 21.03 + (i * 5 * mps) / 111_320, longitude: 105.85, recorded_at: new Date(start.getTime() + i * 5000).toISOString() }))
    return rpc<{ validation_status: string; validation_reason: string }>(db, U,
      `select public.submit_and_process_activity(p_title => 'Chạy', p_source => 'DIRECT_GPS', p_started_at => $1, p_ended_at => $2,
         p_elapsed_s => $3, p_moving_s => $3, p_distance_m => 0, p_avg_pace_s => 0, p_track_points => $4::jsonb) as r`,
      [start.toISOString(), new Date(start.getTime() + seconds * 1000).toISOString(), seconds, JSON.stringify(pts)])
  }
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 240_000)

  it('mặc định giữ nguyên hành vi cũ; người dùng không thấy ngưỡng chống gian lận, admin thấy', async () => {
    const pub = await rpc<Ops>(db, null, `select public.ops_policy() as r`)
    expect(pub).toMatchObject({ version: 0, features: { nearby: true, market: true }, tracking: { autoPauseAfterS: 10, longStopAskMin: 10 } })
    expect(pub.antiCheat).toBeUndefined()
    expect((await rpc<Ops>(db, U, `select public.ops_policy() as r`)).antiCheat).toBeUndefined()
    expect((await rpc<Ops>(db, ADM, `select public.ops_policy() as r`)).antiCheat).toMatchObject({ vehicleKmh: 25, highKmh: 17 })
    // chạy 14,4 km/h 20 phút: hợp lệ với ngưỡng mặc định
    expect((await submit(4, 1200)).validation_status).toBe('APPROVED')
  })

  it('chỉ admin xuất bản; chặn giá trị phá hệ thống; khoá lạ bị bỏ', async () => {
    expect(await fails(rpc(db, U, `select public.admin_publish_ops_policy('{"features":{"nearby":false}}'::jsonb) as r`))).toContain('FORBIDDEN')
    for (const bad of [
      { tracking: { autoPauseAfterS: 0 } },
      { tracking: { longStopAskMin: 30, longStopAutoStopMin: 20 } },
      { antiCheat: { highKmh: 22 } },                       // ≥ ngưỡng giữ tốc độ nghiêm trọng (20)
      { features: { nearby: 'tắt' } },
      { content: { enterprise: { title: '', features: [] } } },
    ]) expect(await fails(rpc(db, ADM, `select public.admin_publish_ops_policy($1::jsonb) as r`, [JSON.stringify(bad)]))).toContain('INVALID_CONFIG')
    expect(await rpc<number>(db, ADM, `select public.admin_publish_ops_policy($1::jsonb, 'Tắt Quanh đây') as r`,
      [JSON.stringify({ features: { nearby: false }, hacked: { x: 1 } })])).toBe(1)
    const c = await rpc<Ops & { hacked?: unknown }>(db, ADM, `select public.ops_policy() as r`)
    expect(c).toMatchObject({ version: 1, features: { nearby: false, market: true } })
    expect(c.hacked).toBeUndefined()
    expect((await db.query(`select 1 from public.admin_audit_log where action = 'PUBLISH_CONFIG' and target like 'ops_policy v1: Tắt Quanh đây'`)).rows).toHaveLength(1)
  })

  it('ngưỡng chống gian lận đổi được không cần sửa code: hạ ngưỡng giữ tốc độ → bài 14,4 km/h chờ duyệt', async () => {
    await rpc(db, ADM, `select public.admin_publish_ops_policy($1::jsonb, 'Siết ngưỡng') as r`, [JSON.stringify({ antiCheat: { highKmh: 13, highS: 120 } })])
    const r = await submit(4, 1200)
    expect(r.validation_status).toBe('PENDING')
    expect(r.validation_reason).toContain('≥ 13 km/h')
  })

  it('lịch sử + khôi phục phiên bản cũ', async () => {
    const h = await rpc<{ version: number; by: string }[]>(db, ADM, `select public.admin_config_history('ops_policy') as r`)
    expect(h.map((x) => x.version)).toEqual([2, 1])
    expect(h[0].by).toBe('A')
    expect(await rpc<number>(db, ADM, `select public.admin_rollback_config('ops_policy', 1) as r`)).toBe(3)
    expect((await rpc<Ops>(db, ADM, `select public.ops_policy() as r`)).antiCheat).toMatchObject({ highKmh: 17 })
    expect(await fails(rpc(db, U, `select public.admin_config_history('ops_policy') as r`))).toContain('FORBIDDEN')
    expect(await fails(rpc(db, ADM, `select public.admin_rollback_config('ops_policy', 99) as r`))).toContain('VERSION_NOT_FOUND')
  })
})
