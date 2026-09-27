import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 008700: tổng quan tổ chức (KPI, BXH đơn vị / CLB / cá nhân, km theo ngày)
const id = (n: number) => `00000000-0000-0000-0000-0000000087${String(n).padStart(2, '0')}`
const [ADM, A, B, C, OUT] = [1, 2, 3, 4, 5].map(id)

async function seed(db: PGlite) {
  const users = [ADM, A, B, C, OUT]
  await db.exec(`
    insert into auth.users (id, email) values ${users.map((u, i) => `('${u}', 'ov${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${users.map((u, i) => `('${u}', 'OV${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
    update public.profiles set role = 'SYSTEM_ADMIN' where id = '${ADM}';
  `)
}
const rpc = async <T,>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0].r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
type Ov = { kpi: { people: number; active: number; km: number }; units: { name: string; parent_id: string | null; members: number; active: number; km: number }[];
  top: { name: string; km: number }[]; me: { rank: number; km: number } | null; days: { km: number }[]; hidden: boolean }

describe('tổng quan tổ chức (008700)', () => {
  let db: PGlite
  let org = ''
  const range = [new Date(Date.now() - 7 * 86400_000).toISOString(), new Date(Date.now() + 86400_000).toISOString()]
  const run = async (uid: string, km: number, daysAgo: number) => {
    const r = await db.query<{ id: string }>(`insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m,
        moving_time_s, elapsed_time_s, avg_pace_s, validation_status, status)
      values ($1, 'Chạy', 'STRAVA', now() - make_interval(days => $2), now() - make_interval(days => $2) + interval '1 hour', $3, $3, $4, $4, 360, 'APPROVED', 'READY')
      returning id`, [uid, daysAgo, km * 1000, km * 360])
    await db.query(`update public.activities set shared = true where id = $1`, [r.rows[0].id])
  }
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    org = (await rpc<{ id: string }>(db, ADM, `select public.admin_create_demo_org('{"kind":"COMPANY"}'::jsonb) as r`)).id
    const units = (await db.query<{ id: string; name: string }>(`select id, name from public.org_units where org_id = $1`, [org])).rows
    const u = (n: string) => units.find((x) => x.name === n)!.id
    await db.query(`insert into public.org_members (org_id, user_id, role, status, unit_id) values
      ($1, $2, 'MEMBER', 'APPROVED', $5), ($1, $3, 'MEMBER', 'APPROVED', $5), ($1, $4, 'MEMBER', 'APPROVED', $6)`,
      [org, A, B, C, u('Kinh doanh Miền Bắc'), u('Phòng Kỹ thuật')])
    await run(A, 10, 1); await run(A, 5, 2); await run(C, 8, 1); await run(OUT, 50, 1)
  }, 240_000)

  it('KPI, đơn vị có parent_id, top cá nhân, hạng của mình, km theo ngày; người ngoài tổ chức không tính', async () => {
    const r = await rpc<Ov>(db, A, `select public.org_overview($1, $2, $3) as r`, [org, ...range])
    expect(r.kpi).toMatchObject({ people: 4, active: 2, km: 23 })
    const mb = r.units.find((x) => x.name === 'Kinh doanh Miền Bắc')!
    expect(mb).toMatchObject({ members: 2, active: 1, km: 15 })
    expect(mb.parent_id).not.toBeNull()
    expect(r.top.map((t) => t.name)).toEqual(['OV1', 'OV3'])
    expect(r.me).toMatchObject({ rank: 1, km: 15 })
    expect(r.days.reduce((s, d) => s + Number(d.km), 0)).toBe(23)
  })

  it('chế độ riêng tư: thành viên không thấy danh sách top, vẫn thấy hạng của mình; người ngoài bị chặn', async () => {
    await db.query(`update public.organizations set privacy_mode = true where id = $1`, [org])
    const r = await rpc<Ov>(db, C, `select public.org_overview($1, $2, $3) as r`, [org, ...range])
    expect(r.hidden).toBe(true)
    expect(r.top).toEqual([])
    expect(r.me).toMatchObject({ rank: 2, km: 8 })
    expect(await fails(rpc(db, OUT, `select public.org_overview($1, $2, $3) as r`, [org, ...range]))).toContain('NOT_A_MEMBER')
  })
})
