import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 007000 + 007400: kết nối Strava = đồng ý hiện bài cho CLB / BXH; runner tắt được; admin đổi chính sách chung
const OWN = '00000000-0000-0000-0000-0000000070a1'      // chủ nhiệm CLB, không dùng Strava
const RUN = '00000000-0000-0000-0000-0000000070a2'      // runner dùng Strava
const ADM = '00000000-0000-0000-0000-0000000070a3'
const CLUB = '00000000-0000-0000-0000-0000000070c1'

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${OWN}', 'o70@x.vn'), ('${RUN}', 'r70@x.vn'), ('${ADM}', 'a70@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ('${OWN}', 'Chủ nhiệm', 0, 0, 1, now()), ('${RUN}', 'Runner Strava', 0, 0, 1, now()), ('${ADM}', 'Admin', 0, 0, 1, now())
      on conflict do nothing;
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'CLB B+', '${OWN}', 'bplus1');
    insert into public.club_members (club_id, user_id, role, status) values ('${CLUB}', '${OWN}', 'OWNER', 'APPROVED'), ('${CLUB}', '${RUN}', 'MEMBER', 'APPROVED')
      on conflict do nothing;
  `)
}
const rpc = async <T,>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0].r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }

describe('chia sẻ bài Strava (007000, 007400)', () => {
  let db: PGlite
  let stravaRun: string
  const ingest = async (ext: string, hoursAgo: number) => {
    await db.exec('set role service_role')
    const r = (await db.query<{ r: { activity_id: string } }>(`select public.ingest_provider_activity($1, 'STRAVA', $2, $3::jsonb) as r`, [RUN, ext, JSON.stringify({
      title: 'Chạy Hồ Tây ' + ext, sport_type: 'Run', started_at: new Date(Date.now() - hoursAgo * 3600_000).toISOString(),
      elapsed_s: 1900, moving_s: 1800, distance_m: 6000, has_gps: true,
    })])).rows[0].r
    await db.exec('reset role')
    return r.activity_id
  }
  const posts = async () => (await db.query(`select 1 from public.club_posts where club_id = $1 and kind = 'AUTO_RUN' and deleted_at is null`, [CLUB])).rows.length
  const board = async () => (await asUser<{ user_id: string; distance_m: string }>(db, OWN, '/rpc',
    `select user_id, distance_m from public.club_leaderboard($1, 'WEEK')`, [CLUB])).rows.find((x) => x.user_id === RUN)

  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADM])
    await db.exec('set role service_role')
    await db.query(`select public.link_provider_connection($1, 'STRAVA', 'ath-70', 't', 'r', now() + interval '6 hours')`, [RUN])
    await db.exec('reset role')
    await db.query(`update public.connected_accounts set created_at = now() - interval '1 day' where user_id = $1`, [RUN])
  }, 240_000)

  it('kết nối Strava = đồng ý (007400): bài lên bảng tin + BXH ngay, người khác chỉ xem số tổng', async () => {
    stravaRun = await ingest('s-1', 2)
    const a = (await db.query<{ shared: boolean; earned_xp: string; validation_status: string }>(
      `select shared, earned_xp, validation_status from public.activities where id = $1`, [stravaRun])).rows[0]
    expect(a).toMatchObject({ shared: true, validation_status: 'APPROVED' })
    expect(Number(a.earned_xp)).toBeGreaterThan(0)
    expect(await posts()).toBe(1)
    expect(Number((await board())?.distance_m)).toBe(6000)
    expect(await rpc(db, OWN, `select public.activity_detail($1) as r`, [stravaRun])).toMatchObject({ shared: true, strava_limited: true })
    expect(await rpc(db, RUN, `select public.my_strava_sharing() as r`)).toMatchObject({ policy: 'OPT_IN', consent: true, connected: true, hidden_runs: 0 })
  })

  it('runner TẮT → gỡ khỏi bảng tin, BXH, người khác không xem được (vẫn thưởng cho chính runner); bật lại → hiện lại', async () => {
    expect(await rpc(db, RUN, `select public.set_strava_sharing(false) as r`)).toMatchObject({ consent: false, hidden_runs: 1, changed: 1 })
    expect(await posts()).toBe(0)
    expect(Number((await board())?.distance_m ?? 0)).toBe(0)
    expect(await fails(rpc(db, OWN, `select public.activity_detail($1) as r`, [stravaRun]))).toContain('ACTIVITY_NOT_FOUND')
    expect(await rpc<unknown[]>(db, OWN, `select public.list_athlete_activities($1) as r`, [RUN])).toHaveLength(0)
    expect(await rpc<unknown[]>(db, RUN, `select public.list_athlete_activities($1) as r`, [RUN])).toHaveLength(1)   // chính mình vẫn thấy
    expect((await asUser(db, OWN, '/activities', `select 1 from public.activities where id = $1`, [stravaRun])).rows).toHaveLength(0)
    // bài mới khi đang tắt → cũng ẩn
    const second = await ingest('s-2', 1)
    expect((await db.query<{ shared: boolean }>(`select shared from public.activities where id = $1`, [second])).rows[0].shared).toBe(false)

    expect(await rpc(db, RUN, `select public.set_strava_sharing(true) as r`)).toMatchObject({ consent: true, hidden_runs: 0, changed: 2 })
    expect(await posts()).toBe(2)
    expect(Number((await board())?.distance_m)).toBe(12000)
  })

  it('admin đổi chính sách chung: OWNER_ONLY (hướng A) ẩn tất cả; người thường không đổi được', async () => {
    expect(await fails(rpc(db, OWN, `select public.admin_set_strava_policy('ALL', 'thử') as r`))).toMatch(/FORBIDDEN|ADMIN/)
    expect(await rpc(db, ADM, `select public.admin_set_strava_policy('OWNER_ONLY', 'Strava yêu cầu') as r`)).toMatchObject({ policy: 'OWNER_ONLY', changed: 2 })
    expect(await posts()).toBe(0)
    expect(await rpc(db, ADM, `select public.admin_strava_sharing_stats() as r`)).toMatchObject({ policy: 'OWNER_ONLY', connected: 1, opted_in: 1, opted_out: 0, hidden_runs: 2 })
    await rpc(db, ADM, `select public.admin_set_strava_policy('OPT_IN', 'quay lại mặc định') as r`)
    expect(await posts()).toBe(2)
  })

  it('bài ghi bằng app RaceHub luôn được chia sẻ', async () => {
    await db.query(`insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_time_s, validation_status, status)
                    values ($1, 'GPS app', 'DIRECT_GPS', now() - interval '30 minutes', now() - interval '5 minutes', 3000, 1200, 'APPROVED', 'READY')`, [OWN])
    expect((await db.query<{ shared: boolean }>(`select shared from public.activities where user_id = $1 and source = 'DIRECT_GPS'`, [OWN])).rows[0].shared).toBe(true)
  })
})
