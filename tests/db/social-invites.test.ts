import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 005500: hồ sơ từ Google / Apple / email, mã giới thiệu ngắn, xem trước lời mời
const id = (n: number) => `00000000-0000-0000-0000-0000000055${String(n).padStart(2, '0')}`
const [OLD, INV] = [1, 2].map(id)
const CLUB = '00000000-0000-0000-0000-0000000055c1'

async function seed(db: PGlite) {
  // tài khoản cũ có sẵn trước migration
  await db.exec(`
    insert into auth.users (id, email) values ('${OLD}', 'old@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values ('${OLD}', 'Cũ', 0, 0, 1, now()) on conflict do nothing;
  `)
}
type Row = Record<string, any>
const rpc = async <T = Row>(db: PGlite, uid: string | null, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const signUp = (db: PGlite, uid: string, email: string, meta: object) =>
  db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)`, [uid, email, JSON.stringify(meta)])
const profile = async (db: PGlite, uid: string) =>
  (await db.query<{ display_name: string; avatar_url: string | null; referral_code: string }>(`select display_name, avatar_url, referral_code from public.profiles where id = $1`, [uid])).rows[0]

describe('đăng nhập mạng xã hội + lời mời (005500)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    const cols = (await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = 'auth' and table_name = 'users'`)).rows.map((r) => r.column_name)
    if (!cols.includes('raw_user_meta_data')) await db.exec(`alter table auth.users add column raw_user_meta_data jsonb`)
    await db.exec(`drop trigger if exists on_auth_user_created on auth.users;
      create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();`)
  }, 240_000)

  it('hồ sơ mới lấy tên / ảnh đúng nguồn; mọi tài khoản (cả tài khoản cũ) có mã 8 ký tự', async () => {
    await signUp(db, INV, 'lan@gmail.com', { full_name: 'Nguyễn Thị Lan', picture: 'https://lh3.googleusercontent.com/a/x' })
    await signUp(db, id(3), 'abc@x.vn', { display_name: 'Tuấn Runner' })
    await signUp(db, id(4), 'q7x2@privaterelay.appleid.com', {})
    await signUp(db, id(5), '0912345678@phone.racehub.vn', {})
    expect(await profile(db, INV)).toMatchObject({ display_name: 'Nguyễn Thị Lan', avatar_url: 'https://lh3.googleusercontent.com/a/x' })
    expect((await profile(db, id(3))).display_name).toBe('Tuấn Runner')
    expect((await profile(db, id(4))).display_name).toBe('Runner')
    expect((await profile(db, id(5))).display_name).toBe('Runner')
    for (const u of [OLD, INV, id(3)]) expect((await profile(db, u)).referral_code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
  })

  it('xem trước + nhập mã giới thiệu (mã ngắn hoặc uuid cũ); my_referral đếm bạn đã mời', async () => {
    const code = (await profile(db, INV)).referral_code
    expect(await rpc(db, null, `select public.referral_preview($1) as r`, [code.toLowerCase()])).toMatchObject({ display_name: 'Nguyễn Thị Lan', code })
    expect(await rpc(db, null, `select public.referral_preview('KHONGCO1') as r`)).toBeNull()
    expect(await fails(rpc(db, id(3), `select public.apply_referral_code('KHONGCO1') as r`))).toContain('REFERRER_NOT_FOUND')
    expect(await fails(rpc(db, INV, `select public.apply_referral_code($1) as r`, [code]))).toContain('CANNOT_REFER_SELF')
    expect(await rpc(db, id(3), `select public.apply_referral_code($1) as r`, [` ${code.toLowerCase()} `])).toMatchObject({ success: true, referrer_name: 'Nguyễn Thị Lan' })
    expect(await rpc(db, id(4), `select public.apply_referral_code($1) as r`, [INV])).toMatchObject({ success: true })
    expect(await fails(rpc(db, id(4), `select public.apply_referral_code($1) as r`, [code]))).toContain('ALREADY_REFERRED')
    const mine = await rpc<Row>(db, INV, `select public.my_referral() as r`)
    expect(mine).toMatchObject({ code, invited: 2, rewarded: 0, can_enter_code: true })
    expect(mine.friends).toHaveLength(2)
    expect(mine.rules.min_km).toBeGreaterThan(0)
    expect(await rpc<Row>(db, id(3), `select public.my_referral() as r`)).toMatchObject({ referred_by: { display_name: 'Nguyễn Thị Lan' }, can_enter_code: false })
  })

  it('xem trước lời mời CLB khi chưa đăng nhập, không lộ mã mời', async () => {
    await db.exec(`insert into public.clubs (id, name, description, owner_id, invite_code, member_count, join_policy)
      values ('${CLUB}', 'Hồ Tây Runners', 'Chạy sáng', '${OLD}', 'abc123def456', 12, 'APPROVAL')`)
    const p = await rpc<Row>(db, null, `select public.club_invite_preview(' ABC123DEF456 ') as r`)
    expect(p).toMatchObject({ id: CLUB, name: 'Hồ Tây Runners', member_count: 12, join_policy: 'APPROVAL', my_status: null })
    expect(JSON.stringify(p)).not.toContain('abc123def456')
    expect(await rpc(db, null, `select public.club_invite_preview('sai') as r`)).toBeNull()
  })
})
