import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 004400: thông báo hệ thống do admin đặt + nhật ký lỗi phía người dùng (gộp, chống spam)
const [ADMIN, U, V] = ['00000000-0000-0000-0000-0000000044a1', '00000000-0000-0000-0000-0000000044a2', '00000000-0000-0000-0000-0000000044a3']

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${ADMIN}', 'a@x.vn'), ('${U}', 'u@x.vn'), ('${V}', 'v@x.vn');
    insert into public.profiles (id, display_name, created_at) values ('${ADMIN}', 'A', now()), ('${U}', 'U', now()), ('${V}', 'V', now());
  `)
}
type Row = Record<string, any>
const rpc = async <T = Row>(db: PGlite, uid: string | null, sql: string, params: unknown[] = []) =>
  (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0].r

describe('Thông báo hệ thống + nhật ký lỗi (004400)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADMIN])
  }, 300_000)

  it('admin đặt thông báo bảo trì: ai cũng đọc được (kể cả chưa đăng nhập); tắt được; hết hạn thì tự ẩn', async () => {
    await expect(asUser(db, U, '/rpc', `select public.admin_set_system_notice($1)`, [{ level: 'INFO', title: 'Xin chào' }])).rejects.toThrow(/FORBIDDEN/)
    await expect(asUser(db, ADMIN, '/rpc', `select public.admin_set_system_notice($1)`, [{ level: 'LOUD', title: 'Xin chào' }])).rejects.toThrow(/INVALID_LEVEL/)
    const until = new Date(Date.now() + 3_600_000).toISOString()
    await rpc(db, ADMIN, `select public.admin_set_system_notice($1) as r`, [{ level: 'MAINTENANCE', title: 'Bảo trì 22h', message: 'Tạm dừng 30 phút', until }])
    expect(await rpc(db, null, `select public.system_notice() as r`)).toMatchObject({ level: 'MAINTENANCE', title: 'Bảo trì 22h' })
    expect(await rpc(db, U, `select public.system_notice() as r`)).toMatchObject({ message: 'Tạm dừng 30 phút' })
    await db.query(`update private.system_notice set until = now() - interval '1 minute'`)
    expect(await rpc(db, U, `select public.system_notice() as r`)).toBeNull()
    await rpc(db, ADMIN, `select public.admin_set_system_notice($1) as r`, [{ level: 'WARNING', title: 'Strava chậm' }])
    await rpc(db, ADMIN, `select public.admin_set_system_notice($1) as r`, [{}])
    expect(await rpc(db, U, `select public.system_notice() as r`)).toBeNull()
    const n = (await db.query<{ n: number }>(`select count(*)::int n from public.admin_audit_log where action like 'SYSTEM_NOTICE%'`)).rows[0].n
    expect(n).toBe(3)
  })

  it('lỗi được gộp theo mã; đếm số người gặp; mã/loại sai bị bỏ; chỉ admin xem', async () => {
    await expect(asUser(db, null, '/rpc', `select public.log_client_error('SERVER', 'SER-1AB')`)).rejects.toThrow(/permission denied/)
    expect(await rpc(db, U, `select public.log_client_error('HACK', 'SER-1AB') as r`)).toBe(false)
    expect(await rpc(db, U, `select public.log_client_error('SERVER', '<script>') as r`)).toBe(false)
    expect(await rpc(db, U, `select public.log_client_error('NOT_DEPLOYED', 'NOT-9ZZ', 'Could not find the function public.my_quests', '/feed') as r`)).toBe(true)
    await rpc(db, U, `select public.log_client_error('NOT_DEPLOYED', 'NOT-9ZZ', null, '/feed') as r`)
    await rpc(db, V, `select public.log_client_error('NOT_DEPLOYED', 'NOT-9ZZ', null, '/wallet') as r`)
    await expect(asUser(db, U, '/rpc', `select public.admin_client_errors(7)`)).rejects.toThrow(/FORBIDDEN/)
    const list = await rpc<Row[]>(db, ADMIN, `select public.admin_client_errors(7) as r`)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ code: 'NOT-9ZZ', kind: 'NOT_DEPLOYED', hits: 3, users: 2, path: '/wallet', message: 'Could not find the function public.my_quests' })
    const s = await rpc<Row>(db, ADMIN, `select public.admin_system_check() as r`)
    expect(s.stats).toMatchObject({ client_errors_24h: 3, not_deployed_24h: 3 })
  })

  it('chống spam: mỗi người tối đa 30 lần / giờ; bảng lỗi không đọc trực tiếp được', async () => {
    let ok = 0
    for (let i = 0; i < 35; i++) if (await rpc(db, V, `select public.log_client_error('SERVER', 'SER-00A') as r`)) ok++
    expect(ok).toBe(29) // V đã gửi 1 lần ở test trước
    await expect(asUser(db, U, '/rest', `select * from private.client_errors`)).rejects.toThrow(/permission denied/)
  })
})
