import { describe, it, expect } from 'vitest'
import { asUser, createDb } from './load-schema'

// Migration 003500: admin_system_check dò migration / kho ảnh / dữ liệu bất thường
const ADMIN = '00000000-0000-0000-0000-0000000035a1'
const USER = '00000000-0000-0000-0000-0000000035a2'

describe('Kiểm tra hệ thống (003500)', () => {
  it('đủ migration → tất cả OK; người thường bị chặn; thiếu một migration thì báo đúng file', async () => {
    const db = await createDb({ withMigrations: true, runMigrationsTwice: true })
    await db.exec(`
      insert into auth.users (id, email) values ('${ADMIN}', 'a@x.vn'), ('${USER}', 'u@x.vn');
      insert into public.profiles (id, display_name, xu, xp, level, role, created_at) values
        ('${ADMIN}', 'Admin', 0, 0, 1, 'SYSTEM_ADMIN', now()), ('${USER}', 'U', 0, 0, 1, 'MEMBER', now()) on conflict do nothing;
      update public.profiles set role = 'SYSTEM_ADMIN' where id = '${ADMIN}';
    `)
    const run = (uid: string) => asUser<{ r: { migrations: { file: string; ok: boolean }[]; buckets: { id: string; ok: boolean; limit_mb: number }[]; stats: Record<string, unknown> } }>(
      db, uid, '/rpc', `select public.admin_system_check() as r`)
    await expect(run(USER)).rejects.toThrow(/FORBIDDEN/)
    const r = (await run(ADMIN)).rows[0].r
    expect(r.migrations.filter((m) => !m.ok)).toEqual([])
    expect(r.migrations).toHaveLength(63)
    expect(r.buckets.find((b) => b.id === 'race-media')).toMatchObject({ ok: true, limit_mb: 10 })
    expect(r.stats).toMatchObject({ admins: 1, users: 2 })

    await db.exec(`drop function public.can_upload_race_media(text) cascade`)
    const r2 = (await run(ADMIN)).rows[0].r
    expect(r2.migrations.filter((m) => !m.ok).map((m) => m.file)).toEqual(['20261001003300'])
  }, 240_000)
})
