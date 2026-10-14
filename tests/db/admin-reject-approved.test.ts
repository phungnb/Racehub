import { describe, it, expect } from 'vitest'
import { asUser, createDb } from './load-schema'

// Migration 015900: admin loại được bài ĐÃ ghi nhận → thu hồi Xu, XP
const ADMIN = '00000000-0000-0000-0000-0000000159a1'
const USER = '00000000-0000-0000-0000-0000000159a2'
const RUN = '00000000-0000-0000-0000-000000015901'

describe('Admin loại bài đã ghi nhận (015900)', () => {
  it('thu hồi thưởng, ghi nhật ký; người thường / lý do ngắn / bài chưa ghi nhận bị chặn', async () => {
    const db = await createDb({ withMigrations: true })
    await db.exec(`
      insert into auth.users (id, email) values ('${ADMIN}', 'a@x.vn'), ('${USER}', 'u@x.vn');
      insert into public.profiles (id, display_name, xu, xp, level, role, created_at) values
        ('${ADMIN}', 'Admin', 0, 0, 1, 'MEMBER', now()), ('${USER}', 'U', 0, 0, 1, 'MEMBER', now()) on conflict do nothing;
      update public.profiles set role = 'SYSTEM_ADMIN' where id = '${ADMIN}';
      insert into public.activities (id, user_id, source, distance_m, moving_time_s, started_at, ended_at, validation_status, status) values
        ('${RUN}', '${USER}', 'DIRECT_GPS', 8000, 2800, now() - interval '5 hours', now() - interval '4 hours', 'APPROVED', 'READY');
    `)
    const prof = async () => { const r = (await db.query<{ xu: string; xp: string }>(`select xu, xp from public.profiles where id = $1`, [USER])).rows[0]; return { xu: Number(r.xu), xp: Number(r.xp) } }
    const before = await prof()
    expect(before.xu).toBeGreaterThan(0)       // được thưởng khi bài vào trạng thái APPROVED

    const call = (uid: string, reason: string) => asUser(db, uid, '/rpc', `select public.admin_reject_activity($1, $2)`, [RUN, reason])
    await expect(call(USER, 'gian lận rõ ràng')).rejects.toThrow(/FORBIDDEN/)
    await expect(call(ADMIN, 'ngắn')).rejects.toThrow(/NOTE_REQUIRED/)
    await call(ADMIN, 'Đi xe máy, GPS nhảy nhiều lần')

    const a = (await db.query<{ validation_status: string; earned_xu: number }>(`select validation_status, earned_xu from public.activities where id = $1`, [RUN])).rows[0]
    expect(a).toEqual({ validation_status: 'REJECTED', earned_xu: '0.00' })
    expect(await prof()).toEqual({ xu: 0, xp: 0 })
    await expect(call(ADMIN, 'loại lần hai')).rejects.toThrow(/ACTIVITY_NOT_APPROVED/)
    const log = await db.query(`select action from public.admin_audit_log where action = 'REJECT_APPROVED_ACTIVITY'`)
    expect(log.rows.length).toBe(1)
  }, 240_000)
})
