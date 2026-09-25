import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 005600: trang Quản trị — việc cần xử lý, người dùng (khóa / quyền), thử thách, nhật ký
const id = (n: number) => `00000000-0000-0000-0000-0000000056${String(n).padStart(2, '0')}`
const [ADM, U1, U2] = [1, 2, 3].map(id)
const CH = '00000000-0000-0000-0000-0000000056c1'

async function seed(db: PGlite) {
  const users = [ADM, U1, U2]
  await db.exec(`
    insert into auth.users (id, email) values ${users.map((u, i) => `('${u}', 'a${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${users.map((u, i) => `('${u}', 'A${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
  `)
}
type Row = Record<string, any>
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }

describe('trang quản trị (005600)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADM])
    await db.exec(`
      insert into public.challenges (id, title, start_date, end_date, target_value, target_km, min_km, status, created_by, target_audience)
        values ('${CH}', 'Thử thách spam', now() - interval '1 day', now() + interval '6 days', 50, 50, 1, 'ACTIVE', '${U1}', 'PUBLIC');
      insert into public.challenge_participants (challenge_id, profile_id, status) values ('${CH}', '${U1}', 'JOINED'), ('${CH}', '${U2}', 'JOINED');
      insert into auth.sessions (user_id) values ('${U1}'), ('${U1}');
    `)
  }, 240_000)

  it('người thường bị chặn; việc cần xử lý + chi tiết người dùng', async () => {
    expect(await fails(rpc(db, U1, `select public.admin_inbox() as r`))).not.toBe('OK')
    expect(await fails(rpc(db, U1, `select public.admin_user_detail($1) as r`, [U2]))).not.toBe('OK')
    const inbox = await rpc<Row>(db, ADM, `select public.admin_inbox() as r`)
    expect(inbox).toMatchObject({ orders: 0, partners: 0, banned: 0 })
    const d = await rpc<Row>(db, ADM, `select public.admin_user_detail($1) as r`, [U1])
    expect(d).toMatchObject({ display_name: 'A1', email: 'a1@x.vn', role: 'MEMBER', stats: { challenges: 1 } })
  })

  it('khóa tài khoản: chặn đăng nhập + xóa phiên, cần lý do; không tự khóa / khóa admin; mở lại được; có nhật ký', async () => {
    expect(await fails(rpc(db, ADM, `select public.admin_set_user_ban($1, true, '') as r`, [U1]))).toContain('REASON_REQUIRED')
    expect(await fails(rpc(db, ADM, `select public.admin_set_user_ban($1, true, 'thử') as r`, [ADM]))).toContain('CANNOT_TARGET_SELF')
    await rpc(db, ADM, `select public.admin_set_user_ban($1, true, 'Spam thử thách') as r`, [U1])
    const u = (await db.query<{ banned_until: string | null }>(`select banned_until from auth.users where id = $1`, [U1])).rows[0]
    expect(u.banned_until).not.toBeNull()
    expect((await db.query(`select 1 from auth.sessions where user_id = $1`, [U1])).rows).toHaveLength(0)
    expect(await rpc<Row>(db, ADM, `select public.admin_user_detail($1) as r`, [U1])).toMatchObject({ banned_reason: 'Spam thử thách' })
    expect(await fails(rpc(db, ADM, `select public.admin_set_user_role($1, 'SYSTEM_ADMIN') as r`, [U1]))).toContain('USER_BANNED')
    await rpc(db, ADM, `select public.admin_set_user_ban($1, false) as r`, [U1])
    expect((await db.query<{ banned_until: string | null }>(`select banned_until from auth.users where id = $1`, [U1])).rows[0].banned_until).toBeNull()
    const log = await rpc<Row[]>(db, ADM, `select public.admin_audit_list('USER_') as r`)
    expect(log.map((x) => x.action)).toEqual(['USER_UNBAN', 'USER_BAN'])
  })

  it('cấp / gỡ quyền admin (không tự gỡ mình); khóa được admin? không', async () => {
    await rpc(db, ADM, `select public.admin_set_user_role($1, 'SYSTEM_ADMIN', 'Điều hành viên') as r`, [U2])
    expect(await fails(rpc(db, ADM, `select public.admin_set_user_ban($1, true, 'thử khóa') as r`, [U2]))).toContain('CANNOT_BAN_ADMIN')
    expect(await fails(rpc(db, ADM, `select public.admin_set_user_role($1, 'MEMBER') as r`, [ADM]))).toContain('CANNOT_TARGET_SELF')
    expect(await rpc<Row>(db, U2, `select public.admin_inbox() as r`)).toHaveProperty('orders')      // quyền mới có hiệu lực
    await rpc(db, ADM, `select public.admin_set_user_role($1, 'MEMBER') as r`, [U2])
    expect(await fails(rpc(db, U2, `select public.admin_inbox() as r`))).not.toBe('OK')
  })

  it('tìm + hủy thử thách (cần lý do), báo cả người tạo và người tham gia', async () => {
    expect((await rpc<Row[]>(db, ADM, `select public.admin_list_challenges('spam', 'LIVE') as r`)).map((x) => x.id)).toEqual([CH])
    expect(await fails(rpc(db, ADM, `select public.admin_cancel_challenge($1, '') as r`, [CH]))).toContain('REASON_REQUIRED')
    await rpc(db, ADM, `select public.admin_cancel_challenge($1, 'Nội dung vi phạm') as r`, [CH])
    expect((await db.query<{ status: string }>(`select status from public.challenges where id = $1`, [CH])).rows[0].status).toBe('CANCELLED')
    const n = await db.query<{ user_id: string }>(`select user_id from public.notifications where kind = 'CHALLENGE_CANCELLED' order by user_id`)
    expect(n.rows.map((x) => x.user_id)).toEqual([U1, U2])
    expect((await rpc<Row[]>(db, ADM, `select public.admin_list_challenges('', 'CANCELLED') as r`))[0]).toMatchObject({ cancelled_reason: 'Nội dung vi phạm' })
  })
})
