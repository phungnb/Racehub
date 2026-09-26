import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 008300: RaceHub Doanh nghiệp / Liên CLB
const ADM = '00000000-0000-0000-0000-0000000083a0'
const OWN = '00000000-0000-0000-0000-0000000083a1'
const EMP = '00000000-0000-0000-0000-0000000083a2'
const EMP2 = '00000000-0000-0000-0000-0000000083a3'
const CAP = '00000000-0000-0000-0000-0000000083a4'   // chủ nhiệm CLB
const RUN = '00000000-0000-0000-0000-0000000083a5'   // thành viên CLB (không vào tổ chức trực tiếp)
const OUT = '00000000-0000-0000-0000-0000000083a6'
const CLUB = '00000000-0000-0000-0000-0000000083c1'
const ALL = [ADM, OWN, EMP, EMP2, CAP, RUN, OUT]
type Row = Record<string, any>
const iso = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ${ALL.map((u, i) => `('${u}', 'org83-${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${ALL.map((u, i) => `('${u}', 'Người ${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'CLB Liên đoàn', '${CAP}', 'lien831');
    insert into public.club_members (club_id, user_id, role, status) values ('${CLUB}', '${CAP}', 'OWNER', 'APPROVED'), ('${CLUB}', '${RUN}', 'MEMBER', 'APPROVED')
      on conflict do nothing;
  `)
}
const rpc = async <T = Row>(db: PGlite, uid: string | null, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const run = async (db: PGlite, uid: string, km: number, hoursAgo = 2, shared = true) => {
  const r = await db.query<{ id: string }>(`insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_time_s, validation_status, status)
            values ($1, 'Chạy', 'DIRECT_GPS', now() - make_interval(hours => $3::int), now() - make_interval(hours => $3::int) + interval '50 minutes',
                    $2::numeric, 3000, 'APPROVED', 'READY') returning id`, [uid, km * 1000, hoursAgo])
  if (!shared) await db.query(`update public.activities set shared = false where id = $1`, [r.rows[0].id])   // người chạy tắt chia sẻ bài này
}
const club = async (db: PGlite) => (await db.query<Row>(`select plan, pro_until from public.clubs where id = $1`, [CLUB])).rows[0]

describe('Doanh nghiệp / Liên CLB (008300)', () => {
  let db: PGlite
  let org: string
  let code: string
  let unitA: string
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADM])
  }, 240_000)

  it('khách chưa đăng nhập gửi yêu cầu báo giá; admin thấy và tạo tổ chức theo hợp đồng', async () => {
    const lead = await rpc(db, null, `select public.request_enterprise_quote($1::jsonb) as r`, [JSON.stringify({
      contact_name: 'Chị Lan', org_name: 'Công ty ABC', kind: 'COMPANY', size: 300, phone: '0901 234 567', note: 'Giải chạy nội bộ quý 4' })])
    expect(lead.id).toBeTruthy()
    expect(await fails(rpc(db, null, `select public.request_enterprise_quote($1::jsonb) as r`, [JSON.stringify({ contact_name: 'A', org_name: 'X', phone: '1' })])))
      .toMatch(/NAME_REQUIRED|INVALID_PHONE/)
    expect(await fails(rpc(db, OWN, `select public.admin_org_leads() as r`))).toMatch(/FORBIDDEN|ADMIN/)
    expect((await rpc<Row[]>(db, ADM, `select public.admin_org_leads() as r`))[0]).toMatchObject({ org_name: 'Công ty ABC', status: 'NEW' })

    const r = await rpc(db, ADM, `select public.admin_create_org($1::jsonb) as r`, [JSON.stringify({
      name: 'Công ty ABC', kind: 'FEDERATION', owner_email: 'org83-1@x.vn', seat_limit: 3, club_limit: 2, include_club_pro: true,
      active_until: iso(24 * 365), lead_id: lead.id })])
    org = r.id; code = r.invite_code
    expect(code).toMatch(/^[0-9A-F]{8}$/)
    expect((await rpc<Row[]>(db, ADM, `select public.admin_org_leads('WON') as r`))[0].org_id).toBe(org)
    expect(await rpc(db, OWN, `select public.org_detail($1) as r`, [org])).toMatchObject({ my_role: 'OWNER', is_admin: true, invite_code: code, seats_used: 1 })
    expect(await fails(rpc(db, OUT, `select public.org_detail($1) as r`, [org]))).toContain('NOT_A_MEMBER')
  })

  it('đơn vị, mã mời, chờ duyệt, giới hạn số chỗ', async () => {
    unitA = await rpc<string>(db, OWN, `select public.save_org_unit($1, null, 'Phòng Kỹ thuật') as r`, [org])
    expect(await fails(rpc(db, OWN, `select public.save_org_unit($1, null, 'phòng kỹ thuật') as r`, [org]))).toContain('UNIT_EXISTS')
    expect(await rpc(db, EMP, `select public.org_invite_preview($1) as r`, [code.toLowerCase()])).toMatchObject({ name: 'Công ty ABC', join_policy: 'APPROVAL', full: false })
    expect(await rpc(db, EMP, `select public.join_org($1, $2, 'NV001') as r`, [code, unitA])).toMatchObject({ status: 'PENDING' })
    expect(await fails(rpc(db, EMP, `select public.org_campaigns($1) as r`, [org]))).toContain('NOT_A_MEMBER')
    await rpc(db, OWN, `select public.set_org_member($1, $2, '{"status":"APPROVED"}'::jsonb) as r`, [org, EMP])
    expect((await rpc<Row[]>(db, EMP, `select public.org_members_list($1) as r`, [org])).find((m) => m.user_id === EMP))
      .toMatchObject({ status: 'APPROVED', unit_name: 'Phòng Kỹ thuật', employee_code: null })

    await rpc(db, OWN, `select public.update_org($1, '{"join_policy":"OPEN"}'::jsonb) as r`, [org])
    expect(await rpc(db, EMP2, `select public.join_org($1) as r`, [code])).toMatchObject({ status: 'APPROVED' })
    expect(await fails(rpc(db, OUT, `select public.join_org($1) as r`, [code]))).toContain('ORG_FULL')     // 3 chỗ đã đủ
    expect(await fails(rpc(db, EMP, `select public.update_org($1, '{"name":"Hack"}'::jsonb) as r`, [org]))).toContain('FORBIDDEN')
    expect(await fails(rpc(db, OWN, `select public.leave_org($1) as r`, [org]))).toContain('OWNER_CANNOT_LEAVE')
  })

  it('CLB vào tổ chức: ban quản trị CLB đồng ý → được tài trợ Pro; rời tổ chức → trả gói cũ', async () => {
    expect((await club(db)).plan).toBe('FREE')
    await rpc(db, OWN, `select public.org_invite_club($1, $2) as r`, [org, CLUB])
    expect(await fails(rpc(db, RUN, `select public.respond_org_invite($1, $2, true) as r`, [org, CLUB]))).toContain('FORBIDDEN')
    expect((await rpc(db, CAP, `select public.club_orgs($1) as r`, [CLUB])).invites).toHaveLength(1)
    await rpc(db, CAP, `select public.respond_org_invite($1, $2, true) as r`, [org, CLUB])
    expect(await club(db)).toMatchObject({ plan: 'PRO' })
    expect((await rpc(db, RUN, `select public.club_orgs($1) as r`, [CLUB])).current).toMatchObject({ id: org, pro_granted: true })

    await rpc(db, ADM, `select public.admin_update_org($1, '{"include_club_pro":false}'::jsonb, 'Hạ gói theo hợp đồng') as r`, [org])
    expect(await club(db)).toMatchObject({ plan: 'FREE', pro_until: null })
    await rpc(db, ADM, `select public.admin_update_org($1, '{"include_club_pro":true}'::jsonb, 'Bật lại') as r`, [org])
    expect((await club(db)).plan).toBe('PRO')
    await rpc(db, CAP, `select public.remove_org_club($1, $2) as r`, [org, CLUB])
    expect((await club(db)).plan).toBe('FREE')
    await rpc(db, OWN, `select public.org_invite_club($1, $2) as r`, [org, CLUB])
    await rpc(db, CAP, `select public.respond_org_invite($1, $2, true) as r`, [org, CLUB])
  })

  it('chiến dịch: BXH cá nhân / đơn vị / CLB, chỉ tính bài hợp lệ đang chia sẻ; báo cáo cho quản trị', async () => {
    await run(db, EMP, 10); await run(db, EMP, 5, 30)
    await run(db, EMP2, 3)
    await run(db, RUN, 21)
    await run(db, RUN, 8, 3, false)               // bài không chia sẻ: không tính
    await run(db, OUT, 50)                         // người ngoài: không tính
    const id = await rpc<string>(db, OWN, `select public.save_org_campaign($1, null, $2::jsonb) as r`, [org, JSON.stringify({
      title: 'Tháng chạy vì sức khoẻ', metric: 'DISTANCE', starts_at: iso(-48), ends_at: iso(24 * 20), goal_total: 100, goal_per_person: 12 })])
    expect(await fails(rpc(db, EMP, `select public.save_org_campaign($1, null, '{"title":"x"}'::jsonb) as r`, [org]))).toContain('FORBIDDEN')
    expect((await db.query(`select 1 from public.notifications where kind = 'ORG_CAMPAIGN' and user_id = $1`, [RUN])).rows).toHaveLength(1)

    const b = await rpc(db, RUN, `select public.org_campaign_board($1) as r`, [id])
    expect(Number(b.total)).toBe(39)
    expect(b).toMatchObject({ participants: 5, active: 3, completed: 2, me: { rank: 1 } })
    expect(b.people.map((p: Row) => [p.user_id, Number(p.value)]).slice(0, 3)).toEqual([[RUN, 21], [EMP, 15], [EMP2, 3]])
    expect(b.units.find((u: Row) => u.id === unitA)).toMatchObject({ members: 1, active: 1 })
    expect(Number(b.clubs[0].total)).toBe(21)
    expect(await fails(rpc(db, OUT, `select public.org_campaign_board($1) as r`, [id]))).toContain('NOT_A_MEMBER')

    const list = await rpc<Row[]>(db, EMP, `select public.org_campaigns($1) as r`, [org])
    expect(list[0]).toMatchObject({ id, participants: 5, active: 3 })
    expect(Number(list[0].my_value)).toBe(15)

    const rep = await rpc<Row[]>(db, OWN, `select public.org_report($1, $2, $3) as r`, [org, iso(-24 * 7), iso(1)])
    expect(rep.find((r) => r.user_id === EMP)).toMatchObject({ runs: 2, active_days: 2, unit_name: 'Phòng Kỹ thuật', employee_code: 'NV001', direct: true })
    expect(rep.find((r) => r.user_id === RUN)).toMatchObject({ clubs: 'CLB Liên đoàn', direct: false })
    expect(await fails(rpc(db, EMP, `select public.org_report($1, $2, $3) as r`, [org, iso(-24), iso(1)]))).toContain('FORBIDDEN')
  })

  it('hết hạn hợp đồng: không tạo chiến dịch mới, cron trả gói cũ cho CLB', async () => {
    await db.query(`update public.organizations set active_until = now() - interval '1 minute' where id = $1`, [org])
    expect(await fails(rpc(db, OWN, `select public.save_org_campaign($1, null, $2::jsonb) as r`, [org, JSON.stringify({
      title: 'Quý mới', starts_at: iso(1), ends_at: iso(48) })]))).toContain('ORG_INACTIVE')
    expect(await fails(rpc(db, OUT, `select public.join_org($1) as r`, [code]))).toContain('ORG_INACTIVE')
    await db.exec('set role service_role')
    const n = (await db.query<{ n: number }>(`select public.expire_org_plans() as n`)).rows[0].n
    await db.exec('reset role')
    expect(n).toBe(1)
    expect((await club(db)).plan).toBe('FREE')
  })
})
