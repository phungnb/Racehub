import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb } from './load-schema'

// Migration 017300: việc quét Strava tự tạo cho thành viên CLB đã nối Strava
const U1 = '00000000-0000-0000-0000-0000000173a1' // đã nối Strava + đã là thành viên trước migration
const U2 = '00000000-0000-0000-0000-0000000173a2' // chưa nối Strava
const U3 = '00000000-0000-0000-0000-0000000173a3' // nối Strava nhưng chưa vào CLB
const U4 = '00000000-0000-0000-0000-0000000173a4' // chủ nhiệm CLB mới lập, nối Strava
const CLUB = '00000000-0000-0000-0000-0000000173c1'
const CLUB2 = '00000000-0000-0000-0000-0000000173c2'
type Row = Record<string, any>

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${U1}', 'a173@x.vn'), ('${U2}', 'b173@x.vn'), ('${U3}', 'c173@x.vn'), ('${U4}', 'd173@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ('${U1}', 'U1', 0, 0, 1, now()), ('${U2}', 'U2', 0, 0, 1, now()), ('${U3}', 'U3', 0, 0, 1, now()), ('${U4}', 'U4', 0, 0, 1, now()) on conflict do nothing;
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'CLB Auto', '${U1}', 'auto173');
    insert into public.club_members (club_id, user_id, role, status) values ('${CLUB}', '${U1}', 'OWNER', 'APPROVED'), ('${CLUB}', '${U2}', 'MEMBER', 'APPROVED') on conflict do nothing;
    insert into public.connected_accounts (user_id, provider, provider_user_id) values ('${U1}', 'STRAVA', 's1'), ('${U3}', 'STRAVA', 's3'), ('${U4}', 'STRAVA', 's4');
  `)
}

const jobs = async (db: PGlite) => (await db.query<Row>(`select user_id, status, next_page from public.strava_scan_jobs order by user_id`)).rows

describe('Quét Strava tự chạy (017300)', () => {
  let db: PGlite
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 240_000)

  it('thành viên hiện có đã nối Strava có việc ngay sau migrate; người chưa nối / chưa vào CLB thì không', async () => {
    expect((await jobs(db)).map((j) => j.user_id)).toEqual([U1])
  })

  it('được duyệt vào CLB sau khi đã nối Strava, hoặc nối Strava sau khi đã vào CLB → tự có việc', async () => {
    await db.exec(`insert into public.club_members (club_id, user_id, role, status) values ('${CLUB}', '${U3}', 'MEMBER', 'PENDING')`)
    expect((await jobs(db)).map((j) => j.user_id)).toEqual([U1])
    await db.exec(`update public.club_members set status = 'APPROVED' where club_id = '${CLUB}' and user_id = '${U3}'`)
    await db.exec(`insert into public.connected_accounts (user_id, provider, provider_user_id) values ('${U2}', 'STRAVA', 's2')`)
    expect((await jobs(db)).map((j) => j.user_id)).toEqual([U1, U2, U3])
  })

  it('CLB mới lập: chủ nhiệm đã nối Strava tự có việc', async () => {
    await db.exec(`
      insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB2}', 'CLB Mới', '${U4}', 'moi173');
      insert into public.club_members (club_id, user_id, role, status) values ('${CLUB2}', '${U4}', 'OWNER', 'APPROVED')`)
    expect((await jobs(db)).map((j) => j.user_id)).toContain(U4)
  })

  it('việc đã DONE giữ nguyên khi nối lại; việc FAILED về PENDING trang 1', async () => {
    await db.exec(`update public.strava_scan_jobs set status = 'DONE', next_page = 7 where user_id = '${U1}';
                   update public.strava_scan_jobs set status = 'FAILED', next_page = 4, note = 'STRAVA_REAUTH_REQUIRED' where user_id = '${U2}'`)
    await db.exec(`update public.connected_accounts set provider_user_id = provider_user_id || 'x' where user_id in ('${U1}', '${U2}')`)
    const by = Object.fromEntries((await jobs(db)).map((j) => [j.user_id, j]))
    expect(by[U1]).toMatchObject({ status: 'DONE', next_page: 7 })
    expect(by[U2]).toMatchObject({ status: 'PENDING', next_page: 1 })
  })
})
