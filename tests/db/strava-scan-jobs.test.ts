import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 017100: quét Strava nền từ 1/1/2026 cho cả CLB
const OWNER = '00000000-0000-0000-0000-0000000170a1'
const M1 = '00000000-0000-0000-0000-0000000170a2'
const M2 = '00000000-0000-0000-0000-0000000170a3'
const CLUB = '00000000-0000-0000-0000-0000000170c1'
type Row = Record<string, any>

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'o170@x.vn'), ('${M1}', 'm170@x.vn'), ('${M2}', 'n170@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ('${OWNER}', 'Chủ nhiệm', 0, 0, 1, now()), ('${M1}', 'Nối Strava', 0, 0, 1, now()), ('${M2}', 'Chưa nối', 0, 0, 1, now()) on conflict do nothing;
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'CLB Quét', '${OWNER}', 'quet170');
    insert into public.club_members (club_id, user_id, role, status) values ('${CLUB}', '${OWNER}', 'OWNER', 'APPROVED'),
      ('${CLUB}', '${M1}', 'MEMBER', 'APPROVED'), ('${CLUB}', '${M2}', 'MEMBER', 'APPROVED') on conflict do nothing;
  `)
  await db.query(`insert into public.connected_accounts (user_id, provider, provider_user_id) values ($1, 'STRAVA', 'st170')`, [M1])
}

describe('Quét Strava nền (017100)', () => {
  let db: PGlite
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 240_000)

  it('ban quản trị bật quét: chỉ thành viên đã nối Strava có việc (017300 đã tự tạo sẵn); bật lại không tạo trùng', async () => {
    const r = (await asUser<{ r: Row }>(db, OWNER, '/rpc', `select public.club_request_strava_scan($1) as r`, [CLUB])).rows[0].r
    expect(r).toMatchObject({ members: 3, connected: 1, pending: 1, queued: 0 })
    const again = (await asUser<{ r: Row }>(db, OWNER, '/rpc', `select public.club_request_strava_scan($1) as r`, [CLUB])).rows[0].r
    expect(again).toMatchObject({ pending: 1, queued: 0 })
  })

  it('thành viên thường không bật / xem tiến độ được; chỉ đọc việc của mình', async () => {
    await expect(asUser(db, M1, '/rpc', `select public.club_request_strava_scan($1) as r`, [CLUB])).rejects.toThrow(/FORBIDDEN/)
    await expect(asUser(db, M1, '/rpc', `select public.club_strava_scan_status($1) as r`, [CLUB])).rejects.toThrow(/FORBIDDEN/)
    expect((await asUser<Row>(db, M1, '/rest', `select user_id from public.strava_scan_jobs`)).rows.length).toBe(1)
    expect((await asUser<Row>(db, M2, '/rest', `select user_id from public.strava_scan_jobs`)).rows.length).toBe(0)
  })
})
