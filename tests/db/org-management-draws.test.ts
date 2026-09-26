import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 008400: quản lý doanh nghiệp (tên miền, nhập CSV, đơn vị nhiều cấp, trưởng đơn vị, chốt/duyệt, ngày hội, chứng nhận,
// bảng tin, riêng tư) + quay thưởng dùng chung
const ADM = '00000000-0000-0000-0000-0000000084a0'
const OWN = '00000000-0000-0000-0000-0000000084a1'
const A = '00000000-0000-0000-0000-0000000084a2'    // nhân viên, email công ty
const B = '00000000-0000-0000-0000-0000000084a3'    // nhân viên, được nhập từ danh sách → trưởng đơn vị
const C = '00000000-0000-0000-0000-0000000084a4'    // email gmail
const LATE = '00000000-0000-0000-0000-0000000084a5' // chưa có tài khoản lúc nhập danh sách
const CAP = '00000000-0000-0000-0000-0000000084a6'
const CLUB = '00000000-0000-0000-0000-0000000084c1'
type Row = Record<string, any>
const iso = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()
const vnDay = (daysAgo: number) => new Date(Date.now() + 7 * 3600_000 - daysAgo * 86400_000).toISOString().slice(0, 10)
const USERS: [string, string][] = [[ADM, 'admin84@racehub.vn'], [OWN, 'sep@congty.vn'], [A, 'a@congty.vn'], [B, 'b@congty.vn'], [C, 'c@gmail.com'], [CAP, 'cap84@x.vn']]

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ${USERS.map(([u, e]) => `('${u}', '${e}')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${USERS.map(([u], i) => `('${u}', 'Người ${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'CLB Quay', '${CAP}', 'quay841');
    insert into public.club_members (club_id, user_id, role, status) values ('${CLUB}', '${CAP}', 'OWNER', 'APPROVED'), ('${CLUB}', '${A}', 'MEMBER', 'APPROVED')
      on conflict do nothing;
  `)
}
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const run = (db: PGlite, uid: string, km: number, daysAgo: number) =>
  db.query(`insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_time_s, validation_status, status)
            values ($1, 'Chạy', 'DIRECT_GPS', ($3::date + time '06:00') at time zone 'Asia/Ho_Chi_Minh',
                    ($3::date + time '07:00') at time zone 'Asia/Ho_Chi_Minh', $2::numeric, 3600, 'APPROVED', 'READY')`, [uid, km * 1000, vnDay(daysAgo)])

describe('Quản lý doanh nghiệp + quay thưởng (008400)', () => {
  let db: PGlite
  let org: string
  let code: string
  let camp: string
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADM])
    const r = await rpc(db, ADM, `select public.admin_create_org($1::jsonb) as r`, [JSON.stringify({
      name: 'Công ty Cáo', kind: 'COMPANY', owner_email: 'sep@congty.vn', seat_limit: 10, active_until: iso(24 * 365) })])
    org = r.id; code = r.invite_code
  }, 240_000)

  it('tên miền công ty: tự duyệt; bật "chỉ email công ty" thì chặn gmail; không cho tên miền công cộng', async () => {
    expect(await fails(rpc(db, OWN, `select public.update_org($1, '{"email_domains":["gmail.com"]}'::jsonb) as r`, [org]))).toContain('PUBLIC_DOMAIN')
    const d = await rpc(db, OWN, `select public.update_org($1, '{"email_domains":["@CongTy.vn"],"domain_auto_approve":true,"domain_only":true}'::jsonb) as r`, [org])
    expect(d).toMatchObject({ email_domains: ['congty.vn'], domain_auto_approve: true, domain_only: true, join_policy: 'APPROVAL' })
    expect(await rpc(db, A, `select public.org_invite_preview($1) as r`, [code])).toMatchObject({ auto_approve: true, blocked: false })
    expect(await rpc(db, A, `select public.join_org($1) as r`, [code])).toMatchObject({ status: 'APPROVED' })
    expect(await rpc(db, C, `select public.org_invite_preview($1) as r`, [code])).toMatchObject({ blocked: true })
    expect(await fails(rpc(db, C, `select public.join_org($1) as r`, [code]))).toContain('DOMAIN_REQUIRED')
  })

  it('nhập danh sách: tạo đơn vị nhiều cấp, người chưa có tài khoản thành lời mời chờ; gỡ người không còn trong danh sách', async () => {
    const res = await rpc(db, OWN, `select public.org_import_members($1, $2::jsonb) as r`, [org, JSON.stringify([
      { email: 'b@congty.vn', unit: 'Miền Bắc / Hà Nội / Kỹ thuật', employee_code: 'NV02', role: 'UNIT_ADMIN' },
      { email: 'moi@congty.vn', unit: 'Miền Bắc / Hà Nội / Kỹ thuật / Tổ 1', employee_code: 'NV03' },
      { email: 'a@congty.vn', unit: 'Miền Bắc / Hải Phòng' },
      { email: 'sai-email' },
    ])])
    expect(res).toMatchObject({ added: 1, updated: 1, invited: 1, units_created: 5 })
    expect(res.errors).toEqual([{ email: 'sai-email', error: 'INVALID_EMAIL' }])
    const detail = await rpc(db, B, `select public.org_detail($1) as r`, [org])
    expect(detail).toMatchObject({ my_role: 'UNIT_ADMIN', is_unit_admin: true })
    expect(detail.managed_units).toHaveLength(2)                   // Kỹ thuật + Tổ 1

    // người được mời đăng ký sau → vào bằng mã: tự duyệt, đúng đơn vị + mã NV
    await db.exec(`insert into auth.users (id, email) values ('${LATE}', 'moi@congty.vn');
                   insert into public.profiles (id, display_name, xu, xp, level, created_at) values ('${LATE}', 'Người mới', 0, 0, 1, now()) on conflict do nothing`)
    expect(await rpc(db, LATE, `select public.join_org($1) as r`, [code])).toMatchObject({ status: 'APPROVED' })
    const me = (await rpc<Row[]>(db, OWN, `select public.org_members_list($1) as r`, [org])).find((m) => m.user_id === LATE)!
    expect(me).toMatchObject({ unit_name: 'Tổ 1', employee_code: 'NV03' })

    // trưởng đơn vị: thấy / quản lý người trong đơn vị mình, không đổi vai trò, báo cáo chỉ đơn vị mình
    const list = await rpc<Row[]>(db, B, `select public.org_members_list($1) as r`, [org])
    expect(list.find((m) => m.user_id === LATE)).toMatchObject({ manageable: true, employee_code: 'NV03' })
    expect(list.find((m) => m.user_id === A)).toMatchObject({ manageable: false, employee_code: null })
    expect(await fails(rpc(db, B, `select public.set_org_member($1, $2, '{"role":"ADMIN"}'::jsonb) as r`, [org, LATE]))).toContain('FORBIDDEN')
    expect(await fails(rpc(db, B, `select public.set_org_member($1, $2, '{"action":"REMOVE"}'::jsonb) as r`, [org, A]))).toContain('FORBIDDEN')
    const rep = await rpc<Row[]>(db, B, `select public.org_report($1, $2, $3) as r`, [org, iso(-24 * 7), iso(1)])
    expect(rep.map((r) => r.user_id).sort()).toEqual([B, LATE].sort())
    expect(await fails(rpc(db, A, `select public.org_report($1, $2, $3) as r`, [org, iso(-24), iso(1)]))).toContain('FORBIDDEN')

    // đồng bộ: danh sách mới không còn LATE → gỡ
    const sync = await rpc(db, OWN, `select public.org_import_members($1, $2::jsonb, '{"remove_missing":true}'::jsonb) as r`, [org, JSON.stringify([
      { email: 'b@congty.vn', unit: 'Miền Bắc / Hà Nội / Kỹ thuật', role: 'UNIT_ADMIN' }, { email: 'a@congty.vn', unit: 'Miền Bắc / Hải Phòng' }])])
    expect(sync).toMatchObject({ removed: 1, updated: 2 })
    expect((await rpc<Row[]>(db, OWN, `select public.org_members_list($1) as r`, [org])).some((m) => m.user_id === LATE)).toBe(false)
  })

  it('chiến dịch: trần km / ngày + ngày hội ×2; BXH đơn vị cộng dồn đơn vị con; riêng tư ẩn tên', async () => {
    await run(db, A, 30, 3)          // trần 20 → 20
    await run(db, A, 10, 2)          // ngày hội ×2 → 20
    await run(db, B, 5, 2)           // ×2 → 10
    camp = await rpc<string>(db, OWN, `select public.save_org_campaign($1, null, $2::jsonb) as r`, [org, JSON.stringify({
      title: 'Tháng sức khoẻ', metric: 'DISTANCE', starts_at: iso(-24 * 5), ends_at: iso(24 * 5), goal_per_person: 15,
      daily_cap_km: 20, review_top: 1, boost_days: [{ date: vnDay(2), mult: 2 }, { date: '1999-01-01', mult: 3 }], cert_enabled: true })])
    const b = await rpc(db, OWN, `select public.org_campaign_board($1) as r`, [camp])
    expect(b.campaign.boost_days).toEqual([{ date: vnDay(2), mult: 2 }])
    expect(b.people.map((p: Row) => [p.user_id, Number(p.value)])).toEqual([[A, 40], [B, 10], [OWN, 0]])
    expect(Number(b.people[0].km)).toBe(30)                       // km thật (đã chặn trần), không nhân hệ số
    const north = b.units.find((u: Row) => u.name === 'Miền Bắc')
    expect(north).toMatchObject({ members: 2, active: 2 })
    expect(Number(north.total)).toBe(50)
    expect((await rpc<Row[]>(db, A, `select public.org_feed($1) as r`, [org]))[0]).toMatchObject({ kind: 'CAMPAIGN' })

    await rpc(db, OWN, `select public.update_org($1, '{"privacy_mode":true}'::jsonb) as r`, [org])
    const hidden = await rpc(db, B, `select public.org_campaign_board($1) as r`, [camp])
    expect(hidden).toMatchObject({ hidden: true, people: [], me: { rank: 2 } })
    expect(hidden.units.length).toBeGreaterThan(0)
    expect((await rpc(db, OWN, `select public.org_campaign_board($1) as r`, [camp])).people).toHaveLength(3)
  })

  it('chốt kết quả: chưa hết hạn thì chưa chốt; top N chờ duyệt; loại có lý do → mất chứng nhận', async () => {
    expect(await fails(rpc(db, OWN, `select public.lock_org_campaign($1) as r`, [camp]))).toContain('CAMPAIGN_NOT_ENDED')
    await db.query(`update public.org_campaigns set ends_at = now() - interval '1 minute' where id = $1`, [camp])
    expect(await rpc(db, OWN, `select public.lock_org_campaign($1) as r`, [camp])).toMatchObject({ locked: true, pending: 1 })
    await run(db, B, 50, 0)                                           // chạy sau khi chốt: không đổi kết quả
    expect(Number((await rpc(db, OWN, `select public.org_campaign_board($1) as r`, [camp])).people[1].value)).toBe(10)
    expect(await rpc(db, A, `select public.org_campaign_certificate($1) as r`, [camp])).toMatchObject({ value: 40, rank: 1, campaign: 'Tháng sức khoẻ' })
    expect(await fails(rpc(db, B, `select public.org_campaign_certificate($1) as r`, [camp]))).toContain('NOT_ELIGIBLE')   // 10 < 15
    expect(await fails(rpc(db, OWN, `select public.review_campaign_result($1, $2, false, '') as r`, [camp, A]))).toContain('REASON_REQUIRED')
    await rpc(db, OWN, `select public.review_campaign_result($1, $2, false, 'Bài 30 km bất thường') as r`, [camp, A])
    const b = await rpc(db, OWN, `select public.org_campaign_board($1) as r`, [camp])
    expect(b.people[0].user_id).toBe(B)
    expect(b.disqualified[0]).toMatchObject({ user_id: A, note: 'Bài 30 km bất thường' })
    expect(await fails(rpc(db, A, `select public.org_campaign_certificate($1) as r`, [camp]))).toContain('NOT_ELIGIBLE')
    expect(await fails(rpc(db, OWN, `select public.set_org_campaign_cert($1, $2::jsonb) as r`, [camp, JSON.stringify({ bg_url: 'https://evil.example/x.png', layers: [] })])))
      .toContain('INVALID_CERT_IMAGE')
  })

  it('bảng tin: đăng, thích, bình luận; tắt "thành viên được đăng" thì chỉ quản trị đăng', async () => {
    const post = await rpc(db, A, `select public.create_org_post($1, 'Sáng nay chạy 10 km!', null, true) as r`, [org])
    expect(post).toMatchObject({ kind: 'POST', is_pinned: false })            // thành viên không ghim / thông báo được
    expect(await rpc<boolean>(db, B, `select public.toggle_org_post_like($1) as r`, [post.id])).toBe(true)
    await rpc(db, B, `select public.add_org_post_comment($1, 'Giỏi quá') as r`, [post.id])
    expect((await rpc<Row[]>(db, A, `select public.org_feed($1) as r`, [org])).find((p) => p.id === post.id)).toMatchObject({ likes: 1, comments: 1 })
    expect(await fails(rpc(db, C, `select public.org_feed($1) as r`, [org]))).toContain('NOT_A_MEMBER')
    await rpc(db, OWN, `select public.update_org($1, '{"member_posts":false}'::jsonb) as r`, [org])
    expect(await fails(rpc(db, A, `select public.create_org_post($1, 'x') as r`, [org]))).toContain('POSTS_ADMIN_ONLY')
    expect(await rpc(db, OWN, `select public.create_org_post($1, 'Thông báo', null, true) as r`, [org])).toMatchObject({ kind: 'ANNOUNCEMENT', is_pinned: true })
  })

  it('quay thưởng: chỉ người quản lý tạo / quay; quay một lần; loại người đã trúng; công bố seed + mã băm', async () => {
    expect(await fails(rpc(db, A, `select public.create_lucky_draw('ORG_CAMPAIGN', $1, '{"title":"Quay","prizes":[{"name":"Áo","qty":1}]}'::jsonb) as r`, [camp])))
      .toContain('FORBIDDEN')
    const d1 = await rpc(db, OWN, `select public.create_lucky_draw('ORG_CAMPAIGN', $1, $2::jsonb) as r`, [camp, JSON.stringify({
      title: 'Quay thưởng người có chạy', rule: 'ACTIVE', prizes: [{ name: 'Giày', qty: 1 }] })])
    expect(d1).toMatchObject({ status: 'READY', eligible_now: 1 })              // A bị loại → chỉ còn B có chạy
    const r1 = await rpc(db, OWN, `select public.run_lucky_draw($1) as r`, [d1.id])
    expect(r1).toMatchObject({ status: 'DONE', entrant_count: 1 })
    expect(r1.winners).toEqual([expect.objectContaining({ user_id: B, prize: 'Giày', position: 1 })])
    expect(r1.seed).toMatch(/^[0-9a-f]{32}$/)
    expect(r1.entrants_hash).toMatch(/^[0-9a-f]{32}$/)
    expect(await fails(rpc(db, OWN, `select public.run_lucky_draw($1) as r`, [d1.id]))).toContain('DRAW_CLOSED')
    const d2 = await rpc(db, OWN, `select public.create_lucky_draw('ORG_CAMPAIGN', $1, '{"title":"Quay lần 2","rule":"ACTIVE","prizes":[{"name":"Mũ","qty":2}]}'::jsonb) as r`, [camp])
    expect(await fails(rpc(db, OWN, `select public.run_lucky_draw($1) as r`, [d2.id]))).toContain('NO_ENTRANTS')
    expect((await db.query(`select 1 from public.notifications where user_id = $1 and kind = 'LUCKY_DRAW_WIN'`, [B])).rows).toHaveLength(1)
    expect((await rpc<Row[]>(db, B, `select public.lucky_draws_for('ORG_CAMPAIGN', $1) as r`, [camp])).find((d) => d.id === d1.id)!.winners[0].me).toBe(true)

    // dùng chung: CLB (ban quản trị quay, thành viên xem, kết quả lên bảng tin CLB) và toàn hệ thống (chỉ admin)
    const dc = await rpc(db, CAP, `select public.create_lucky_draw('CLUB', $1, '{"title":"Quà tháng","rule":"ALL","prizes":[{"name":"Bình nước","qty":5}]}'::jsonb) as r`, [CLUB])
    const rc = await rpc(db, CAP, `select public.run_lucky_draw($1) as r`, [dc.id])
    expect(rc.winners).toHaveLength(2)                                          // CLB chỉ có 2 người
    expect((await rpc<Row[]>(db, A, `select public.lucky_draws_for('CLUB', $1) as r`, [CLUB]))[0].can_manage).toBe(false)
    expect((await db.query(`select 1 from public.club_posts where club_id = $1 and title like 'Quay thưởng%'`, [CLUB])).rows).toHaveLength(1)
    expect(await fails(rpc(db, OWN, `select public.create_lucky_draw('SYSTEM', null, '{"title":"Toàn app","prizes":[{"name":"VIP","qty":1}]}'::jsonb) as r`))).toContain('FORBIDDEN')
    expect(await rpc(db, ADM, `select public.create_lucky_draw('SYSTEM', null, '{"title":"Toàn app","prizes":[{"name":"VIP","qty":1}]}'::jsonb) as r`))
      .toMatchObject({ scope: 'SYSTEM', ref_id: null })
  })
})
