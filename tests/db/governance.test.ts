import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 004100: vá bảo mật + cơ chế quản trị (không tự phục vụ, hai người duyệt, nhật ký chỉ-thêm) + sửa chốt thử thách
const [ADM1, ADM2, U, M1, M2, M3] = ['00000000-0000-0000-0000-0000000041a1', '00000000-0000-0000-0000-0000000041a2', '00000000-0000-0000-0000-0000000041a3',
  '00000000-0000-0000-0000-0000000041b1', '00000000-0000-0000-0000-0000000041b2', '00000000-0000-0000-0000-0000000041b3']
const CLUB = '00000000-0000-0000-0000-0000000041c1'
const ALL = [ADM1, ADM2, U, M1, M2, M3]

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ${ALL.map((id, i) => `('${id}', 'g${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values ${ALL.map((id, i) => `('${id}', 'G${i}', 0, 0, 1, now())`).join(', ')};
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'CLB Admin', '${ADM1}', 'gov001');
    insert into public.club_members (club_id, user_id, role, status, joined_at) values
      ('${CLUB}', '${ADM1}', 'OWNER', 'APPROVED', now()), ('${CLUB}', '${M1}', 'MEMBER', 'APPROVED', now()),
      ('${CLUB}', '${M2}', 'MEMBER', 'APPROVED', now()), ('${CLUB}', '${M3}', 'MEMBER', 'APPROVED', now());
  `)
}
type Row = Record<string, any>
const rpc = async <T = Row>(db: PGlite, uid: string | null, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const xu = async (db: PGlite, acc: string) => Number((await db.query<{ b: string }>(`select private.balance($1) as b`, [acc])).rows[0].b)
let k = 0
const grant = (db: PGlite, admin: string, type: string, id: string, amount: number) =>
  rpc<Row>(db, admin, `select public.admin_grant_xu($1, $2, $3, 'BONUS', 'Thưởng sự kiện', $4) as r`, [type, id, amount, `gov-key-${++k}-xxxx`])

describe('Bảo mật + quản trị (004100)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id in ($1, $2)`, [ADM1, ADM2])
  }, 300_000)

  it('khóa bề mặt tấn công: khách không gọi hàm quản trị, người dùng không gọi việc định kỳ, không ghi bảng cũ', async () => {
    expect(await fails(rpc(db, null, `select public.admin_set_club_plan($1, 'PRO', null, 'thử') as r`, [CLUB]))).toMatch(/permission denied/)
    expect(await fails(rpc(db, U, `select public.issue_due_credits() as r`))).toMatch(/permission denied/)
    expect(await fails(asUser(db, U, '/achievements', `insert into public.achievements (code, title) values ('hack', 'x')`))).toMatch(/permission denied/)
    expect(await fails(asUser(db, U, '/roles', `insert into public.roles (code, name) values ('ADMIN2', 'x')`))).toMatch(/permission denied/)
    const noPath = await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef and n.nspname in ('public', 'private') and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`)
    expect(noPath.rows).toEqual([])
    const noRls = await db.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`)
    expect(noRls.rows).toEqual([])
  })

  it('admin không tự phục vụ mình hay CLB mình là thành viên', async () => {
    expect(await fails(grant(db, ADM1, 'USER', ADM1, 100))).toContain('SELF_ACTION_FORBIDDEN')
    expect(await fails(grant(db, ADM1, 'CLUB', CLUB, 100))).toContain('SELF_ACTION_FORBIDDEN')
    expect(await fails(rpc(db, ADM1, `select public.admin_grant_plan('USER', $1, 'VIP3', 1, 'tự cấp') as r`, [ADM1]))).toContain('SELF_ACTION_FORBIDDEN')
    expect(await fails(rpc(db, ADM1, `select public.admin_set_club_plan($1, 'PRO', null, 'tự bật') as r`, [CLUB]))).toContain('SELF_ACTION_FORBIDDEN')
    expect(await fails(rpc(db, ADM1, `select public.admin_set_race_organizer('USER', $1, true, null) as r`, [ADM1]))).toContain('SELF_ACTION_FORBIDDEN')
    const pkg = (await db.query<{ id: string }>(`select id from public.xu_packages where xu = 5000`)).rows[0].id
    const o = await rpc<Row>(db, ADM1, `select public.create_order($1::jsonb) as r`, [JSON.stringify({ kind: 'XU', package_id: pkg })])
    expect(await fails(rpc(db, ADM1, `select public.admin_confirm_order($1, null) as r`, [o.id]))).toContain('SELF_ACTION_FORBIDDEN')
    expect(await fails(rpc(db, ADM2, `select public.admin_confirm_order($1, 'VCB') as r`, [o.id]))).toBe('OK')   // admin khác xác nhận được
    // ADM2 không thuộc CLB → bật Pro cho CLB được
    expect(await fails(rpc(db, ADM2, `select public.admin_set_club_plan($1, 'PRO', null, 'đối tác') as r`, [CLUB]))).toBe('OK')
  })

  it('lệnh nhỏ chạy ngay; lệnh lớn thành yêu cầu, chỉ admin KHÁC duyệt được; sổ cái ghi người duyệt', async () => {
    const small = await grant(db, ADM1, 'USER', U, 1000)
    expect(small.transaction_id).toBeTruthy()
    expect(await xu(db, U)).toBe(1000)
    const big = await grant(db, ADM1, 'USER', U, 8000)
    expect(big).toMatchObject({ pending: true })
    expect(await xu(db, U)).toBe(1000)
    expect(await fails(rpc(db, ADM1, `select public.admin_decide_approval($1, true, null) as r`, [big.approval_id]))).toContain('SAME_ADMIN')
    expect((await db.query(`select 1 from public.notifications where user_id = $1 and kind = 'ADMIN_APPROVAL'`, [ADM2])).rows.length).toBeGreaterThan(0)
    const list = await rpc<Row[]>(db, ADM2, `select public.admin_list_approvals('PENDING') as r`)
    expect(list.map((a) => a.id)).toContain(big.approval_id)
    const d = await rpc<Row>(db, ADM2, `select public.admin_decide_approval($1, true, 'Đã xem hồ sơ') as r`, [big.approval_id])
    expect(d.status).toBe('APPROVED')
    expect(await xu(db, U)).toBe(9000)
    const tx = (await db.query<{ a: string }>(`select approved_by as a from public.ledger_transactions where id = $1`, [d.result.transaction_id])).rows[0].a
    expect(tx).toBe(ADM2)
    expect(await fails(rpc(db, ADM2, `select public.admin_decide_approval($1, true, null) as r`, [big.approval_id]))).toContain('APPROVAL_DONE')
  })

  it('trần ngày mỗi admin: cộng dồn vượt 20.000 Xu → phải duyệt; chủ hệ thống duyệt được bằng SQL Editor', async () => {
    for (let i = 0; i < 4; i++) expect((await grant(db, ADM2, 'USER', M1, 4500)).transaction_id).toBeTruthy()   // 18.000
    const over = await grant(db, ADM2, 'USER', M1, 4500)
    expect(over.pending).toBe(true)
    const r = (await db.query<{ r: Row }>(`select private.approve_as_owner($1) as r`, [over.approval_id])).rows[0].r
    expect(r.status).toBe('APPROVED')
    expect(await xu(db, M1)).toBe(22500)
  })

  it('lượt tạo nhiều và gói dài cũng phải duyệt', async () => {
    const pass = await rpc(db, ADM1, `select public.admin_grant_challenge_pass('USER', $1, 20, 100, null, 'Tài trợ') as r`, [U])
    expect(pass).toBeNull()
    const plan = await rpc<Row>(db, ADM1, `select public.admin_grant_plan('USER', $1, 'VIP2', 6, 'Đại sứ thương hiệu') as r`, [U])
    expect(plan.pending).toBe(true)
    const pending = (await db.query<{ n: number }>(`select count(*)::int as n from public.admin_approvals where status = 'PENDING' and action in ('GRANT_PASS', 'GRANT_PLAN')`)).rows[0].n
    expect(pending).toBe(2)
  })

  it('nhật ký quản trị và sổ cái không sửa / xóa được', async () => {
    expect(await fails(db.query(`update public.admin_audit_log set reason = 'sửa' where true`))).toContain('APPEND_ONLY')
    expect(await fails(db.query(`delete from public.admin_audit_log where true`))).toContain('APPEND_ONLY')
    expect(await fails(db.query(`update public.ledger_entries set amount = amount + 1 where true`))).toContain('APPEND_ONLY')
    expect(await fails(db.query(`delete from public.ledger_transactions where true`))).toContain('APPEND_ONLY')
  })

  it('thưởng quỹ CLB: tối đa 50% số dư; ít hơn 3 người có kết quả thì hoàn quỹ; chốt thử thách không cộng XP', async () => {
    await db.query(`select private.ledger_post('TEST_SEED', 'gov-club-seed', 'seed', null,
      jsonb_build_array(jsonb_build_object('account_id', $1::uuid, 'coin_kind', 'BONUS', 'amount', 1000),
                        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -1000)))`, [CLUB])
    const ins = (reward: number) => db.query<{ id: string }>(`
      insert into public.challenges (title, start_date, end_date, target_value, created_by, format, objective, target_audience, target_club_id,
                                     reward_xu, reward_source, reward_split, status)
      values ('Tuần CLB', now() - interval '8 days', now() - interval '1 day', 10, $1, 'RANKED', 'DISTANCE', 'CLUB_ONLY', $2, $3, 'CLUB', 'WINNER', 'ACTIVE')
      returning id`, [ADM1, CLUB, reward])
    expect(await fails(ins(600))).toContain('REWARD_TOO_LARGE')
    const c = (await ins(400)).rows[0].id
    // mô phỏng ký quỹ như create_challenge_v2
    await db.query(`select private.ledger_post('CHALLENGE_ESCROW', 'gov-escrow', 'escrow', null,
      jsonb_build_array(jsonb_build_object('account_id', $1::uuid, 'coin_kind', 'BONUS', 'amount', -400),
                        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', 400)))`, [CLUB])
    await db.query(`insert into public.challenge_participants (challenge_id, profile_id, current_progress, status) values ($1, $2, 12, 'JOINED'), ($1, $3, 8, 'JOINED')`, [c, ADM1, M1])
    const xuBefore = await xu(db, ADM1)
    const xpBefore = (await db.query<{ xp: number }>(`select xp from public.profiles where id = $1`, [ADM1])).rows[0].xp
    expect((await db.query<{ r: boolean }>(`select private.settle_challenge($1) as r`, [c])).rows[0].r).toBe(true)
    expect(await xu(db, CLUB)).toBe(1000)                  // hoàn quỹ vì chỉ 2 người có kết quả
    expect(await xu(db, ADM1)).toBe(xuBefore)
    expect((await db.query<{ xp: number }>(`select xp from public.profiles where id = $1`, [ADM1])).rows[0].xp).toBe(xpBefore)
  })
})
