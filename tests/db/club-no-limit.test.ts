import { describe, it, expect } from 'vitest'
import { createDb } from './load-schema'

// Migration 002100: CLB không còn giới hạn số thành viên
describe('CLB không giới hạn thành viên', () => {
  it('CLB cũ và mới đều có trần rất lớn; chạy migration 2 lần không lỗi', async () => {
    const db = await createDb({ withMigrations: true, runMigrationsTwice: true })
    await db.exec(`
      insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000002b1', 'n@x.vn');
      insert into public.profiles (id, display_name, xu, xp, level, created_at)
        values ('00000000-0000-0000-0000-0000000002b1', 'N', 0, 0, 1, now()) on conflict do nothing;
      insert into public.clubs (name, owner_id, invite_code) values ('CLB', '00000000-0000-0000-0000-0000000002b1', 'abc123');
    `)
    const r = await db.query<{ member_limit: number }>(`select member_limit from public.clubs where invite_code = 'abc123'`)
    expect(r.rows[0].member_limit).toBe(1000000)
  }, 60_000)
})
