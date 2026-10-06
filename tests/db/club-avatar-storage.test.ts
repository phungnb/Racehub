import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 013200: đổi ảnh đại diện CLB không còn xoá thẳng storage.objects (Supabase chặn bằng trigger protect_delete)
const id = (n: number) => `00000000-0000-0000-0000-0000000132${String(n).padStart(2, '0')}`
const [OWN, MEM, OUT] = [1, 2, 3].map(id)
const CLUB = '00000000-0000-0000-0000-0000000132c1'
const url = (p: string) => `https://x.supabase.co/storage/v1/object/public/club-avatars/${p}`

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${OWN}', 'o132@x.vn'), ('${MEM}', 'm132@x.vn'), ('${OUT}', 'x132@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ('${OWN}', 'Chủ', 0, 0, 1, now()), ('${MEM}', 'Thành viên', 0, 0, 1, now()), ('${OUT}', 'Người ngoài', 0, 0, 1, now()) on conflict do nothing;
  `)
}
const call = async (db: PGlite, uid: string | null, sql: string, params: unknown[] = []) => {
  try { await asUser(db, uid, '/rpc', sql, params); return 'OK' } catch (e) { return (e as Error).message }
}
const avatar = async (db: PGlite) =>
  (await db.query<{ avatar_url: string | null; avatar_path: string | null }>(`select avatar_url, avatar_path from public.clubs where id = $1`, [CLUB])).rows[0]

describe('đổi ảnh đại diện CLB (013200)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    // Giống Supabase: cấm xoá thẳng bảng storage (chỉ được xoá qua Storage API)
    await db.exec(`
      create or replace function storage.protect_delete() returns trigger language plpgsql as $$
      begin raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'; end $$;
      create trigger protect_objects_delete before delete on storage.objects for each row execute function storage.protect_delete();
      insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'CLB 132', '${OWN}', 'c132xx');
      insert into public.club_members (club_id, user_id, role, status) values
        ('${CLUB}', '${OWN}', 'OWNER', 'APPROVED'), ('${CLUB}', '${MEM}', 'MEMBER', 'APPROVED') on conflict do nothing;
      insert into storage.objects (bucket_id, name) values ('club-avatars', '${CLUB}/1.jpg'), ('club-avatars', '${CLUB}/2.jpg');
    `)
  }, 240_000)

  it('quản trị CLB đổi ảnh nhiều lần được (đã có ảnh cũ) — không đụng tới storage.objects', async () => {
    const set = (p: string) => call(db, OWN, `select public.update_club($1, p_avatar_url => $2, p_avatar_path => $3) as r`, [CLUB, url(p), p])
    expect(await set(`${CLUB}/1.jpg`)).toBe('OK')
    expect(await set(`${CLUB}/2.jpg`)).toBe('OK')   // trước 013200: lỗi "Direct deletion from storage tables is not allowed"
    expect(await avatar(db)).toEqual({ avatar_url: url(`${CLUB}/2.jpg`), avatar_path: `${CLUB}/2.jpg` })
    // File cũ còn nguyên — app dọn qua Storage API
    expect((await db.query(`select 1 from storage.objects where bucket_id = 'club-avatars'`)).rows).toHaveLength(2)
    const src = (await db.query<{ src: string }>(`select prosrc as src from pg_proc where proname = 'update_club'`)).rows[0].src
    expect(src).not.toMatch(/storage\.objects/)
  })

  it('chỉ quản trị CLB đổi được ảnh; khách chưa đăng nhập không gọi được hàm', async () => {
    for (const who of [MEM, OUT]) {
      expect(await call(db, who, `select public.update_club($1, p_avatar_url => 'https://evil/x.jpg', p_avatar_path => 'x.jpg') as r`, [CLUB])).toContain('FORBIDDEN')
    }
    expect(await call(db, null, `select public.update_club($1, p_avatar_url => 'https://evil/x.jpg') as r`, [CLUB])).toContain('permission denied')
    expect((await avatar(db)).avatar_path).toBe(`${CLUB}/2.jpg`)
  })

  it('bằng chứng nhật ký lỗi /feed: hàm bảng tin + hồ sơ chỉ cấp cho người đã đăng nhập, không cấp cho khách (anon)', async () => {
    const r = (await db.query<Record<string, boolean>>(`select
        has_function_privilege('authenticated', 'public.my_game_state()', 'execute') as game_auth,
        has_function_privilege('anon', 'public.my_game_state()', 'execute') as game_anon,
        has_function_privilege('authenticated', 'public.following_feed(timestamptz, integer)', 'execute') as feed_auth,
        has_function_privilege('anon', 'public.following_feed(timestamptz, integer)', 'execute') as feed_anon,
        has_function_privilege('authenticated', 'public.my_account()', 'execute') as acc_auth,
        has_function_privilege('anon', 'public.my_account()', 'execute') as acc_anon,
        has_column_privilege('authenticated', 'public.profiles', 'display_name', 'select') as prof_public,
        has_column_privilege('authenticated', 'public.profiles', 'xu', 'select') as prof_private,
        has_table_privilege('anon', 'public.profiles', 'select') as prof_anon`)).rows[0]
    expect(r).toEqual({ game_auth: true, game_anon: false, feed_auth: true, feed_anon: false, acc_auth: true, acc_anon: false,
      prof_public: true, prof_private: false, prof_anon: false })
    // Khách gọi → đúng các thông báo trong nhật ký lỗi (FOR-DZL, FOR-LC2, FOR-XLA)
    expect(await call(db, null, `select public.my_game_state() as r`)).toContain('permission denied for function my_game_state')
    expect(await call(db, null, `select public.following_feed() as r`)).toContain('permission denied for function following_feed')
    expect(await call(db, null, `select * from public.profiles`)).toContain('permission denied for table profiles')
    // Người đã đăng nhập đọc cột công khai bình thường
    expect(await call(db, OWN, `select id, display_name, avatar_url, level from public.profiles`)).toBe('OK')
  })
})
