import { describe, it, expect } from 'vitest'
import { asUser, createDb } from './load-schema'

// Migration 014500: admin xóa mềm hàng loạt bài chạy đang bị loại
const ADMIN = '00000000-0000-0000-0000-0000000145a1'
const USER = '00000000-0000-0000-0000-0000000145a2'
const [REJ1, REJ2, OK] = [1, 2, 3].map((n) => `00000000-0000-0000-0000-00000001450${n}`)

describe('Admin xóa bài chạy bị loại (014500)', () => {
  it('chỉ admin; chỉ xóa bài REJECTED (mềm); bài hợp lệ giữ nguyên; ghi audit log', async () => {
    const db = await createDb({ withMigrations: true })
    await db.exec(`
      insert into auth.users (id, email) values ('${ADMIN}', 'a@x.vn'), ('${USER}', 'u@x.vn');
      insert into public.profiles (id, display_name, xu, xp, level, role, created_at) values
        ('${ADMIN}', 'Admin', 0, 0, 1, 'MEMBER', now()), ('${USER}', 'U', 0, 0, 1, 'MEMBER', now()) on conflict do nothing;
      update public.profiles set role = 'SYSTEM_ADMIN' where id = '${ADMIN}';
      insert into public.activities (id, user_id, source, distance_m, moving_time_s, started_at, ended_at, validation_status, status) values
        ('${REJ1}', '${USER}', 'DIRECT_GPS', 3000, 1200, now() - interval '3 hours', now() - interval '2 hours', 'REJECTED', 'READY'),
        ('${REJ2}', '${USER}', 'DIRECT_GPS', 3000, 1200, now() - interval '9 hours', now() - interval '8 hours', 'REJECTED', 'READY'),
        ('${OK}', '${USER}', 'DIRECT_GPS', 5000, 1800, now() - interval '30 hours', now() - interval '29 hours', 'APPROVED', 'READY');
    `)
    const call = (uid: string, ids: string[]) =>
      asUser<{ r: { requested: number; deleted: number } }>(db, uid, '/rpc', `select public.admin_delete_rejected_activities($1::uuid[]) as r`, [`{${ids.join(',')}}`])
    await expect(call(USER, [REJ1])).rejects.toThrow(/FORBIDDEN/)
    await expect(call(ADMIN, [])).rejects.toThrow(/NO_IDS/)
    expect((await call(ADMIN, [REJ1, OK])).rows[0].r).toEqual({ requested: 2, deleted: 1 })
    const st = async () => (await db.query<{ id: string; status: string; validation_status: string }>(`select id, status, validation_status from public.activities order by id`)).rows
    expect((await st()).map((r) => r.status)).toEqual(['DELETED', 'READY', 'COMPLETED'])
    const list = (await asUser<{ r: { id: string }[] }>(db, ADMIN, '/rpc', `select public.rejected_activities(null, 30) as r`)).rows[0].r
    expect(list.map((r) => r.id)).toEqual([REJ2])
    expect((await call(ADMIN, [REJ1])).rows[0].r.deleted).toBe(0)
    const log = await db.query(`select action, target from public.admin_audit_log where action = 'DELETE_REJECTED_ACTIVITIES' order by created_at`)
    expect(log.rows.length).toBe(1)
  }, 240_000)
})
