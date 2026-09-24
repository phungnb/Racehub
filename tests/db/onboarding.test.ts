import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 001800: người có sẵn coi như đã onboarding; người mới đăng ký thì chưa
const OLD = '00000000-0000-0000-0000-0000000000e1'
const NEW = '00000000-0000-0000-0000-0000000000e2'

describe('Onboarding (001800)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, until: '20261001001700' })
    await db.exec(`insert into auth.users (id, email) values ('${OLD}', 'old@x.vn');
      insert into public.profiles (id, display_name, xu, xp, level, created_at) values ('${OLD}', 'Cũ', 0, 0, 1, now()) on conflict do nothing;`)
    const sql = (await import('node:fs')).readFileSync('supabase/migrations/20261001001800_onboarding.sql', 'utf8')
    await db.exec(sql)
    await db.exec(sql)                                // chạy lại không đánh dấu nhầm người mới
    await db.exec(`insert into auth.users (id, email) values ('${NEW}', 'new@x.vn');
      insert into public.profiles (id, display_name, xu, xp, level, created_at) values ('${NEW}', 'Mới', 0, 0, 1, now()) on conflict do nothing;`)
    await db.exec(sql)
  }, 240_000)

  it('tài khoản cũ đã xong, tài khoản mới chưa; hoàn tất chỉ ghi một lần', async () => {
    const r = await db.query<{ id: string; done: boolean }>(`select id, onboarded_at is not null as done from public.profiles where id in ($1, $2) order by id`, [OLD, NEW])
    expect(r.rows).toEqual([{ id: OLD, done: true }, { id: NEW, done: false }])
    const first = (await asUser<{ r: string }>(db, NEW, '/rpc', `select public.complete_onboarding() as r`)).rows[0].r
    const again = (await asUser<{ r: string }>(db, NEW, '/rpc', `select public.complete_onboarding() as r`)).rows[0].r
    expect(first).toBeTruthy()
    expect(again).toEqual(first)
    await expect(asUser(db, NEW, '/rpc', `update public.profiles set onboarded_at = null where id = $1`, [NEW])).rejects.toThrow(/permission denied/)
  })
})
