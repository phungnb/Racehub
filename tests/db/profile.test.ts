import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 001400: hồ sơ cá nhân (giới tính → nhân vật, ngày sinh riêng tư, ảnh đại diện)
const U = '00000000-0000-0000-0000-0000000000a1'
const V = '00000000-0000-0000-0000-0000000000a2'

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${U}', 'u@x.vn'), ('${V}', 'v@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ('${U}', 'Minh', 0, 0, 1, now()), ('${V}', 'Lan', 0, 0, 1, now());
    insert into public.user_avatar (user_id, gender) values ('${V}', 'female');
  `)
}

type P = { display_name: string; bio: string | null; gender: string | null; birth_date: string | null; height_cm: number | null; weight_kg: number | null }
const rpc = async <T = Record<string, unknown>>(db: PGlite, uid: string, sql: string, params: unknown[] = []) =>
  (await asUser<T>(db, uid, '/rpc', sql, params)).rows
const fails = async (db: PGlite, uid: string, sql: string, params: unknown[] = []) => {
  try { await asUser(db, uid, '/rpc', sql, params) } catch (e) { return (e as Error).message }
  return 'OK'
}
const update = (db: PGlite, uid: string, p: Record<string, unknown>) =>
  rpc<{ r: P }>(db, uid, `select public.update_my_profile($1::jsonb) as r`, [JSON.stringify(p)]).then((r) => r[0].r)
const updateFails = (db: PGlite, uid: string, p: Record<string, unknown>) =>
  fails(db, uid, `select public.update_my_profile($1::jsonb)`, [JSON.stringify(p)])

describe('Hồ sơ cá nhân (001400)', () => {
  let db: PGlite
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 240_000)

  it('người đã chọn nhân vật nữ trước đây được điền sẵn giới tính; người khác để trống', async () => {
    const v = (await rpc<{ r: P }>(db, V, `select public.my_profile() as r`))[0].r
    expect(v.gender).toBe('female')
    const u = (await rpc<{ r: P }>(db, U, `select public.my_profile() as r`))[0].r
    expect(u.gender).toBeNull()
    const s = (await rpc<{ s: { gender_set: boolean } }>(db, U, `select public.character_state() as s`))[0].s
    expect(s.gender_set).toBe(false)
  })

  it('cập nhật hồ sơ; chọn giới tính → nhân vật đổi theo', async () => {
    const r = await update(db, U, { display_name: '  Phùng Minh ', bio: 'Chạy vì vui', gender: 'female', birth_date: '1992-05-20', height_cm: 170, weight_kg: 62.34 })
    expect(r).toMatchObject({ display_name: 'Phùng Minh', bio: 'Chạy vì vui', gender: 'female', birth_date: '1992-05-20', height_cm: 170 })
    expect(Number(r.weight_kg)).toBe(62.3)
    const s = (await rpc<{ s: { gender: string; gender_set: boolean } }>(db, U, `select public.character_state() as s`))[0].s
    expect(s).toMatchObject({ gender: 'female', gender_set: true })
    // khóa không gửi thì giữ nguyên; gửi null thì xóa
    const r2 = await update(db, U, { gender: 'male', weight_kg: null })
    expect(r2).toMatchObject({ gender: 'male', bio: 'Chạy vì vui', birth_date: '1992-05-20', weight_kg: null })
    expect((await rpc<{ c: { gender: string } }>(db, V, `select public.get_character($1) as c`, [U]))[0].c.gender).toBe('male')
  })

  it('từ chối dữ liệu sai', async () => {
    expect(await updateFails(db, U, { display_name: 'x' })).toContain('INVALID_NAME')
    expect(await updateFails(db, U, { bio: 'a'.repeat(161) })).toContain('INVALID_BIO')
    expect(await updateFails(db, U, { gender: 'robot' })).toContain('INVALID_GENDER')
    expect(await updateFails(db, U, { birth_date: '2030-01-01' })).toContain('INVALID_BIRTH_DATE')
    expect(await updateFails(db, U, { birth_date: 'hôm qua' })).toContain('INVALID_PROFILE')
    expect(await updateFails(db, U, { height_cm: 20 })).toContain('INVALID_HEIGHT')
    expect(await updateFails(db, U, { weight_kg: 400 })).toContain('INVALID_WEIGHT')
  })

  it('ngày sinh, chiều cao, cân nặng: chỉ chủ tài khoản đọc được, không ai ghi thẳng', async () => {
    expect((await rpc(db, U, `select birth_date from public.profile_details where user_id = $1`, [U]))).toHaveLength(1)
    expect((await rpc(db, V, `select birth_date from public.profile_details where user_id = $1`, [U]))).toHaveLength(0)
    expect(await fails(db, U, `update public.profile_details set height_cm = 200 where user_id = $1`, [U])).toMatch(/permission denied/)
    expect(await fails(db, U, `update public.profiles set gender = 'female' where id = $1`, [U])).toMatch(/permission denied/)
    // giới tính + giới thiệu công khai (BXH theo giới)
    expect((await rpc<{ gender: string }>(db, V, `select gender from public.profiles where id = $1`, [U]))[0].gender).toBe('male')
  })

  it('ảnh đại diện: bucket công khai, mỗi người chỉ ghi thư mục của mình', async () => {
    const b = await db.query(`select public, allowed_mime_types from storage.buckets where id = 'avatars'`)
    expect(b.rows).toEqual([{ public: true, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'] }])
    const pol = await db.query<{ policyname: string }>(`select policyname from pg_policies where tablename = 'objects' and policyname like 'avatars_%' order by 1`)
    expect(pol.rows.map((r) => r.policyname)).toEqual(['avatars_delete', 'avatars_insert', 'avatars_update'])
  })
})
