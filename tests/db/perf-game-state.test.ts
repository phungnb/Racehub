import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 012200: my_game_state chỉ bắt kịp huy hiệu tối đa 1 lần / 10 phút; kết quả trả về không đổi
const A = '00000000-0000-0000-0000-0000000122a1'

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${A}', 'gs@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values ('${A}', 'Runner', 0, 0, 1, now()) on conflict do nothing;
  `)
}
const state = async (db: PGlite) =>
  (await asUser<{ s: Record<string, unknown> }>(db, A, '/rpc', `select public.my_game_state() as s`)).rows[0].s
const checkedAt = async (db: PGlite) =>
  (await db.query<{ t: string }>(`select checked_at::text as t from private.achievement_catchup where user_id = $1`, [A])).rows[0]?.t

describe('Trang chủ nhẹ hơn: bắt kịp huy hiệu tối đa 1 lần / 10 phút (012200)', () => {
  let db: PGlite
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 240_000)

  it('lần đầu kiểm tra, mở lại trong 10 phút thì bỏ qua, quá 10 phút thì kiểm tra lại', async () => {
    const s1 = await state(db)
    expect(s1).toBeTruthy()
    const t1 = await checkedAt(db)
    expect(t1).toBeTruthy()

    await state(db)
    expect(await checkedAt(db)).toBe(t1)

    await db.query(`update private.achievement_catchup set checked_at = now() - interval '11 minutes' where user_id = $1`, [A])
    const old = await checkedAt(db)
    await state(db)
    expect(await checkedAt(db)).not.toBe(old)
  })

  it('người dùng không gọi trực tiếp được hàm nội bộ', async () => {
    let msg = 'OK'
    try { await asUser(db, A, '/rpc', `select private.catch_up_achievements($1)`, [A]) } catch (e) { msg = (e as Error).message }
    expect(msg).toMatch(/permission denied/)
  })
})
