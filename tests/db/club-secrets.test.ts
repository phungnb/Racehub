import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createDb } from './load-schema'

// Migration 003400: mã mời + tài khoản ngân hàng CLB không đọc trực tiếp được từ bảng clubs
const OWNER = '00000000-0000-0000-0000-0000000034a1'
const MEMBER = '00000000-0000-0000-0000-0000000034a2'
const OUT = '00000000-0000-0000-0000-0000000034a3'
const OPEN = '00000000-0000-0000-0000-0000000034c1'
const KIN = '00000000-0000-0000-0000-0000000034c2'

describe('Bí mật CLB (003400)', () => {
  let db: PGlite
  const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true })
    await db.exec(`
      insert into auth.users (id, email) values ('${OWNER}', 'o@x.vn'), ('${MEMBER}', 'm@x.vn'), ('${OUT}', 'x@x.vn');
      insert into public.profiles (id, display_name, xu, xp, level, created_at) values
        ('${OWNER}', 'Chủ', 0, 0, 1, now()), ('${MEMBER}', 'Thành viên', 0, 0, 1, now()), ('${OUT}', 'Người ngoài', 0, 0, 1, now()) on conflict do nothing;
      insert into public.clubs (id, name, owner_id, invite_code, join_policy, bank_account_no) values
        ('${OPEN}', 'CLB Mở', '${OWNER}', 'openabc123', 'OPEN', '0123456789'),
        ('${KIN}', 'CLB Kín', '${OWNER}', 'kinxyz789', 'INVITE_ONLY', '9876543210');
      insert into public.club_members (club_id, user_id, role, status) values
        ('${OPEN}', '${OWNER}', 'OWNER', 'APPROVED'), ('${KIN}', '${OWNER}', 'OWNER', 'APPROVED'),
        ('${OPEN}', '${MEMBER}', 'MEMBER', 'APPROVED'), ('${KIN}', '${MEMBER}', 'MEMBER', 'APPROVED');
    `)
  }, 240_000)

  it('người ngoài / khách không đọc được mã mời và số tài khoản; cột công khai vẫn đọc được', async () => {
    for (const uid of [OUT, null]) {
      expect(await fails(asUser(db, uid, '/rest/v1/clubs', `select invite_code from public.clubs`))).toMatch(/permission denied/)
      expect(await fails(asUser(db, uid, '/rest/v1/clubs', `select id from public.clubs where invite_code = 'kinxyz789'`))).toMatch(/permission denied/)
      expect(await fails(asUser(db, uid, '/rest/v1/clubs', `select bank_account_no from public.clubs`))).toMatch(/permission denied/)
      const r = await asUser<{ name: string }>(db, uid, '/rest/v1/clubs', `select id, name, member_count, join_policy, plan, slug from public.clubs order by name`)
      expect(r.rows.map((x) => x.name)).toEqual(['CLB Kín', 'CLB Mở'])
    }
  })

  it('mã mời: ban quản trị luôn lấy được; thành viên chỉ khi CLB không "chỉ qua mã mời"; người ngoài bị chặn', async () => {
    const code = async (uid: string, club: string) => (await asUser<{ r: string }>(db, uid, '/rpc', `select public.club_invite_code($1) as r`, [club])).rows[0].r
    expect(await code(OWNER, KIN)).toBe('kinxyz789')
    expect(await code(MEMBER, OPEN)).toBe('openabc123')
    expect(await fails(code(MEMBER, KIN))).toContain('FORBIDDEN')
    expect(await fails(code(OUT, OPEN))).toContain('FORBIDDEN')
  })

  it('tìm CLB không trả mã mời / ngân hàng', async () => {
    const r = await asUser<{ r: Record<string, unknown>[] }>(db, OUT, '/rpc', `select public.search_clubs('clb mo') as r`)
    expect(r.rows[0].r[0]).toMatchObject({ name: 'CLB Mở' })
    for (const k of ['invite_code', 'bank_account_no', 'bank_bin']) expect(r.rows[0].r[0]).not.toHaveProperty(k)
  })

  it('bấm lại link mời cũ: chỉ thành viên mới biết là CLB nào', async () => {
    const by = async (uid: string, c: string) => (await asUser<{ r: string | null }>(db, uid, '/rpc', `select public.my_club_by_invite($1) as r`, [c])).rows[0].r
    expect(await by(MEMBER, ' KINXYZ789 ')).toBe(KIN)
    expect(await by(OUT, 'kinxyz789')).toBeNull()
  })

  it('CLB "chỉ qua mã mời": có mã là vào được (trước đây bị chặn); mã sai / bấm lại báo đúng lỗi', async () => {
    const join = (uid: string, c: string) => asUser<{ r: { status: string } }>(db, uid, '/rpc', `select to_jsonb(public.join_club_by_code($1)) as r`, [c])
    expect(await fails(join(OUT, 'sai-ma'))).toContain('INVALID_INVITE')
    expect((await join(OUT, ' KINXYZ789 ')).rows[0].r.status).toBe('APPROVED')
    expect(await fails(join(OUT, 'kinxyz789'))).toContain('ALREADY_MEMBER')
    expect(await fails(asUser(db, OUT, '/rpc', `select public.join_club($1)`, [KIN]))).toContain('INVITE_ONLY')   // không mã → vẫn chặn
    expect((await join(OUT, 'openabc123')).rows[0].r.status).toBe('APPROVED')                                 // CLB mở như cũ
  })
})
