import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 004100: vá bảo mật + nhật ký chỉ-thêm (admin vẫn toàn quyền) + sửa chốt thử thách
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

describe('Bảo mật + lưu vết (004100)', () => {
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

  it('admin toàn quyền: cộng Xu lớn, cấp gói dài, tặng nhiều lượt cho bất kỳ ai (kể cả mình) chạy ngay, có ghi nhật ký', async () => {
    expect((await grant(db, ADM1, 'USER', U, 50000)).transaction_id).toBeTruthy()
    expect(await xu(db, U)).toBe(50000)
    expect((await grant(db, ADM1, 'USER', ADM1, 100)).transaction_id).toBeTruthy()
    expect(await fails(rpc(db, ADM1, `select public.admin_grant_plan('USER', $1, 'VIP3', 12, 'Đại sứ') as r`, [U]))).toBe('OK')
    expect(await rpc(db, ADM1, `select public.admin_grant_challenge_pass('USER', $1, 50, 1000, null, 'Tài trợ') as r`, [U])).toBeTruthy()
    const n = (await db.query<{ n: number }>(`select count(*)::int as n from public.admin_audit_log where actor_id = $1`, [ADM1])).rows[0].n
    expect(n).toBeGreaterThanOrEqual(4)
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
