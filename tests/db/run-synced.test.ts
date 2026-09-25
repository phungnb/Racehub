import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb } from './load-schema'

// Migration 004500: bài từ Strava được cộng thưởng → thông báo "Bài chạy … km đã về RaceHub"
const U = '00000000-0000-0000-0000-0000000045a1'

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${U}', 'u@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values ('${U}', 'U', 0, 0, 1, now() - interval '30 days');
  `)
}
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()
const run = (over: Record<string, unknown> = {}) => ({
  title: 'Morning Run', sport_type: 'Run', started_at: hoursAgo(1), elapsed_s: 3100, moving_s: 3000,
  distance_m: 10000, elevation_gain_m: 12, avg_speed_mps: 3.33, max_speed_mps: 4.1, avg_heartrate: 152,
  manual: false, has_gps: true, device_name: 'Garmin Forerunner 255', ...over,
})

describe('Bài chạy đã về (004500)', () => {
  let db: PGlite
  const ingest = async (ext: string, act: Record<string, unknown>) => {
    await db.exec('set role service_role')
    try {
      return (await db.query<{ r: Record<string, unknown> }>(
        `select public.ingest_provider_activity($1, 'STRAVA', $2, $3::jsonb) as r`, [U, ext, JSON.stringify(act)])).rows[0].r
    } finally { await db.exec('reset role') }
  }
  const notes = async () => (await db.query<{ title: string; body: string; link: string }>(
    `select title, body, link from public.notifications where user_id = $1 and kind = 'RUN_SYNCED' order by created_at`, [U])).rows

  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.exec('set role service_role')
    await db.query(`select public.link_provider_connection($1, 'STRAVA', 'ath-45', 't', 'r', now() + interval '6 hours')`, [U])
    await db.exec('reset role')
    await db.query(`update public.connected_accounts set created_at = now() - interval '10 days' where user_id = $1`, [U])
  }, 300_000)

  it('bài mới từ Strava: 1 thông báo có km, pace, Xu, XP; gửi lại không báo lần 2', async () => {
    expect(await ingest('45001', run())).toMatchObject({ validation_status: 'APPROVED' })
    await ingest('45001', run())
    const n = await notes()
    expect(n).toHaveLength(1)
    expect(n[0].title).toBe('Bài chạy 10,00 km đã về RaceHub')
    expect(n[0].body).toMatch(/^Pace 5:00\/km · \+[\d,]+ Xu · \+100 XP/)
    expect(n[0].link).toBe('/feed?rewards=1')
  })

  it('nhập lại bài cũ (> 2 ngày) không báo', async () => {
    await ingest('45002', run({ started_at: hoursAgo(24 * 5) }))
    expect(await notes()).toHaveLength(1)
  })
})
