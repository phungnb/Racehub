import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 013000: schema ops (view tổng hợp) + role ops_reader chỉ đọc, cho trợ lý vận hành (ADR-018)
const id = (n: number) => `00000000-0000-0000-0000-0000000130${String(n).padStart(2, '0')}`
const [ACTIVE, SILENT, OWNER, CLUB_QUIET, CLUB_LIVE] = [1, 2, 3, 4, 5].map(id)
type Row = Record<string, any>

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email, last_sign_in_at) values
      ('${ACTIVE}', 'Chay.Deu@x.vn', now() - interval '20 days'),
      ('${SILENT}', 'im.lang@x.vn', now() - interval '5 days'),
      ('${OWNER}', 'chu.clb@x.vn', now());
    insert into public.profiles (id, display_name, created_at) values
      ('${ACTIVE}', 'Chạy Đều', now()), ('${SILENT}', 'Im Lặng', now()), ('${OWNER}', 'Chủ CLB', now() - interval '30 days')
      on conflict do nothing;
  `)
}

describe('trợ lý vận hành: schema ops (013000)', () => {
  let db: PGlite
  const asOps = async <T = Row>(sql: string) => {
    await db.exec('begin; set local role ops_reader')
    try { return (await db.query<T>(sql)).rows } finally { await db.exec('rollback') }
  }
  const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }

  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.exec(`
      insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
      values ('${ACTIVE}', 'Chạy', 'DIRECT_GPS', now() - interval '1 day', now() - interval '1 day' + interval '40 minutes', 8000, 8000, 2400, 300, 'APPROVED', 'READY');
      insert into public.clubs (id, name, owner_id, invite_code, created_at) values
        ('${CLUB_QUIET}', 'CLB Ngủ Đông', '${OWNER}', 'ngudong', now() - interval '30 days'),
        ('${CLUB_LIVE}', 'CLB Chạy Sáng', '${OWNER}', 'chaysang', now() - interval '30 days');
      insert into public.club_members (club_id, user_id, role) values ('${CLUB_LIVE}', '${ACTIVE}', 'MEMBER') on conflict do nothing;
      insert into ops.testers (email) values ('chay.deu@x.vn'), ('im.lang@x.vn'), ('chua.co.tk@x.vn');
    `)
  }, 240_000)

  it('tester: khớp email không phân biệt hoa thường, tính số ngày im lặng, báo người chưa có tài khoản', async () => {
    const rows = await asOps(`select email, has_account, runs_7d, km_7d, days_silent from ops.tester_activity order by email`)
    expect(rows).toEqual([
      { email: 'chay.deu@x.vn', has_account: true, runs_7d: 1, km_7d: '8.0', days_silent: 1 },
      { email: 'chua.co.tk@x.vn', has_account: false, runs_7d: 0, km_7d: '0.0', days_silent: null },
      { email: 'im.lang@x.vn', has_account: true, runs_7d: 0, km_7d: '0.0', days_silent: 5 },
    ])
  })

  it('số liệu tuần: đủ 8 tuần, tuần này có runner và km', async () => {
    const rows = await asOps(`select week_start, active_runners, runs, km from ops.weekly_metrics order by week_start`)
    expect(rows).toHaveLength(8)
    expect(rows.reduce((s, r) => s + Number(r.runs), 0)).toBe(1)
  })

  it('việc cần để ý: CLB không ai chạy 14 ngày', async () => {
    const rows = await asOps(`select kind, title from ops.attention where kind = 'CLUB_QUIET'`)
    expect(rows.map((r) => r.title)).toEqual(['CLB Ngủ Đông'])
  })

  it('ops_reader chỉ đọc ops: không đọc được bảng gốc, không ghi được', async () => {
    expect(await fails(asOps(`select count(*) from public.profiles`))).toMatch(/permission denied/i)
    expect(await fails(asOps(`select count(*) from auth.users`))).toMatch(/permission denied/i)
    expect(await fails(asOps(`insert into ops.testers (email) values ('x@x.vn')`))).toMatch(/permission denied|read-only/i)
    expect(await fails(asUser(db, ACTIVE, '/rpc', `select count(*) from ops.tester_activity`))).toMatch(/permission denied/i)
  })
})
