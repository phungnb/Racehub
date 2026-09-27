import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 008900: hàm quản lý CLB đời đầu bỏ qua kiểm tra quyền khi người gọi không thuộc CLB (club_role = NULL)
const [OWN, CAP, MEM, OUT, ADM] = ['00000000-0000-0000-0000-0000000089a1', '00000000-0000-0000-0000-0000000089a2',
  '00000000-0000-0000-0000-0000000089a3', '00000000-0000-0000-0000-0000000089a4', '00000000-0000-0000-0000-0000000089a5']
const CLUB = '00000000-0000-0000-0000-0000000089c1'

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${OWN}', 'own@c.vn'), ('${CAP}', 'cap@c.vn'), ('${MEM}', 'mem@c.vn'), ('${OUT}', 'out@c.vn'), ('${ADM}', 'adm@c.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ('${OWN}', 'Chủ', 0, 0, 1, now()), ('${CAP}', 'Đội trưởng', 0, 0, 1, now()), ('${MEM}', 'Thành viên', 0, 0, 1, now()),
      ('${OUT}', 'Người ngoài', 0, 0, 1, now()), ('${ADM}', 'Admin', 0, 0, 1, now()) on conflict do nothing;
    update public.profiles set role = 'SYSTEM_ADMIN' where id = '${ADM}';
  `)
}
const call = async (db: PGlite, uid: string | null, sql: string, params: unknown[] = []) => {
  try { await asUser(db, uid, '/rpc', sql, params); return 'OK' } catch (e) { return (e as Error).message }
}
const memberId = async (db: PGlite, uid: string) => (await db.query<{ id: string }>(`select id from public.club_members where club_id = $1 and user_id = $2`, [CLUB, uid])).rows[0].id

describe('quyền các hàm quản lý CLB (008900)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    // CLB tạo sau migration (ràng buộc vai trò cũ OWNER/ADMIN/MEMBER đã được bỏ ở 005700)
    await db.exec(`
    insert into public.clubs (id, name, owner_id, invite_code, join_policy) values ('${CLUB}', 'CLB Gốc', '${OWN}', 'abc123', 'OPEN');
    insert into public.club_members (club_id, user_id, role, status) values
      ('${CLUB}', '${OWN}', 'OWNER', 'APPROVED'), ('${CLUB}', '${CAP}', 'CAPTAIN', 'APPROVED'), ('${CLUB}', '${MEM}', 'MEMBER', 'APPROVED')
    on conflict do nothing;
    `)
  }, 240_000)

  it('người ngoài CLB và khách chưa đăng nhập: bị chặn mọi thao tác quản lý', async () => {
    const mem = await memberId(db, MEM)
    for (const who of [OUT, MEM, null]) {
      expect(await call(db, who, `select public.update_club($1, 'Hacked') as r`, [CLUB])).not.toBe('OK')
      expect(await call(db, who, `select public.set_club_announcement($1, 'hacked') as r`, [CLUB])).not.toBe('OK')
      expect(await call(db, who, `select public.update_club_policy($1, 'INVITE_ONLY') as r`, [CLUB])).not.toBe('OK')
      expect(await call(db, who, `select public.rotate_invite_code($1) as r`, [CLUB])).not.toBe('OK')
      expect(await call(db, who, `select public.transfer_ownership($1, $2) as r`, [CLUB, MEM])).not.toBe('OK')
      expect(await call(db, who, `select public.set_member_role($1, 'CAPTAIN') as r`, [mem])).not.toBe('OK')
    }
    expect(await call(db, OUT, `select public.set_member_status($1, 'BANNED') as r`, [mem])).toContain('FORBIDDEN')
    expect(await call(db, OUT, `select public.remove_member($1) as r`, [mem])).toContain('FORBIDDEN')
    expect(await call(db, null, `select public.remove_member($1) as r`, [mem])).not.toBe('OK')
    const c = (await db.query<{ name: string; announcement: string | null; join_policy: string; invite_code: string; owner_id: string }>(
      `select name, announcement, join_policy, invite_code, owner_id from public.clubs where id = $1`, [CLUB])).rows[0]
    expect(c).toMatchObject({ name: 'CLB Gốc', announcement: null, join_policy: 'OPEN', invite_code: 'abc123', owner_id: OWN })
  })

  it('người ngoài tự tham gia CLB mở rồi chuyển quyền chủ cho mình: bị chặn', async () => {
    await call(db, OUT, `select public.join_club($1) as r`, [CLUB])
    expect(await call(db, OUT, `select public.transfer_ownership($1, $2) as r`, [CLUB, OUT])).toContain('FORBIDDEN')
    expect((await db.query<{ owner_id: string }>(`select owner_id from public.clubs where id = $1`, [CLUB])).rows[0].owner_id).toBe(OWN)
  })

  it('chủ / đội trưởng / admin hệ thống vẫn làm được như cũ', async () => {
    expect(await call(db, CAP, `select public.set_club_announcement($1, 'Chạy sáng CN') as r`, [CLUB])).toBe('OK')
    expect(await call(db, CAP, `select public.update_club($1, 'CLB Mới') as r`, [CLUB])).toBe('OK')
    expect(await call(db, CAP, `select public.update_club_policy($1, 'APPROVAL') as r`, [CLUB])).toContain('FORBIDDEN')   // chỉ chủ
    expect(await call(db, OWN, `select public.update_club_policy($1, 'APPROVAL') as r`, [CLUB])).toBe('OK')
    expect(await call(db, OWN, `select public.set_member_role($1, 'CAPTAIN') as r`, [await memberId(db, MEM)])).toBe('OK')
    expect(await call(db, ADM, `select public.set_club_announcement($1, 'Admin') as r`, [CLUB])).toBe('OK')
    expect(await call(db, OWN, `select public.transfer_ownership($1, $2) as r`, [CLUB, CAP])).toBe('OK')
    const c = (await db.query<{ name: string; announcement: string; join_policy: string; owner_id: string }>(
      `select name, announcement, join_policy, owner_id from public.clubs where id = $1`, [CLUB])).rows[0]
    expect(c).toMatchObject({ name: 'CLB Mới', announcement: 'Admin', join_policy: 'APPROVAL', owner_id: CAP })
  })

  it('khách chưa đăng nhập không còn quyền gọi các hàm ghi / trang admin', async () => {
    const r = await db.query<{ f: string }>(`select p.proname f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
        and p.proname in ('update_club','set_club_announcement','update_club_policy','rotate_invite_code','transfer_ownership','set_member_role',
                          'set_member_status','remove_member','join_club','delete_club','admin_help_save','admin_help_delete','admin_help_list','admin_site_info_save')`)
    expect(r.rows).toEqual([])
  })
})
