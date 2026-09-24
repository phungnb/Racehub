import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, createDb } from './load-schema'

// Migration 003100: tìm kiếm không dấu, nhiều từ, viết tắt, xếp hạng
const ME = '00000000-0000-0000-0000-0000000031a1'
const people: [string, string][] = [
  ['00000000-0000-0000-0000-0000000031b1', 'Nguyễn Văn An'],
  ['00000000-0000-0000-0000-0000000031b2', 'Trần Thị Ánh'],
  ['00000000-0000-0000-0000-0000000031b3', 'Đặng Anh Dũng'],
  ['00000000-0000-0000-0000-0000000031b4', 'Ẩn Danh'],
]

describe('Tìm kiếm linh hoạt (003100)', () => {
  let db: PGlite
  const q = async <T>(sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, ME, '/rpc', sql, params)).rows[0].r
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true })
    const all: [string, string][] = [[ME, 'Tôi'], ...people]
    for (const [id, name] of all) {
      await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${id.slice(-4)}@x.vn`])
      await db.query(`insert into public.profiles (id, display_name, xu, xp, level, created_at) values ($1, $2, 0, 0, 1, now()) on conflict (id) do update set display_name = excluded.display_name`, [id, name])
    }
    await db.query(`insert into public.profile_settings (user_id, profile_visibility) values ($1, 'PRIVATE') on conflict (user_id) do update set profile_visibility = 'PRIVATE'`, [people[3][0]])
    await db.exec(`
      insert into public.clubs (name, owner_id, invite_code, member_count, join_policy) values
        ('Hồ Tây Runners', '${ME}', 'c1', 120, 'OPEN'),
        ('No Beer No Run', '${ME}', 'c2', 80, 'APPROVAL'),
        ('Hội Chạy Kín', '${ME}', 'c3', 50, 'INVITE_ONLY'),
        ('Tây Hồ Trail', '${ME}', 'c4', 30, 'OPEN');
    `)
  }, 240_000)

  it('chuẩn hóa: bỏ dấu, hoa thường, Unicode tổ hợp (Unikey) như dựng sẵn', async () => {
    const r = await db.query<{ a: string; b: string }>(`select private.search_key('  Đặng   ÁNH-Dũng! ') as a, private.search_key($1) as b`, ['Nguyễn'])
    expect(r.rows[0]).toEqual({ a: 'dang anh dung', b: 'nguyen' })
  })

  it('VĐV: không dấu, đảo thứ tự từ, gõ đủ tên; ẩn hồ sơ riêng tư và chính mình', async () => {
    const names = async (s: string) => (await q<{ display_name: string }[]>(`select public.search_athletes($1) as r`, [s])).map((x) => x.display_name)
    expect(await names('nguyen van an')).toEqual(['Nguyễn Văn An'])
    expect(await names('An Nguyễn')).toEqual(['Nguyễn Văn An'])
    expect(await names('NGUYỄN VĂN AN')).toEqual(['Nguyễn Văn An'])
    expect((await names('anh')).sort()).toEqual(['Trần Thị Ánh', 'Đặng Anh Dũng'].sort())
    expect(await names('tta')).toEqual(['Trần Thị Ánh'])        // chữ cái đầu
    expect(await names('dang')).toEqual(['Đặng Anh Dũng'])
    expect(await names('an danh')).toEqual([])                 // riêng tư
    expect(await names('toi')).toEqual([])                     // chính mình
  })

  it('CLB: không dấu, viết tắt, xếp khớp nhất trước; CLB kín chỉ ra khi gõ đúng tên', async () => {
    const names = async (s: string) => (await q<{ name: string }[]>(`select public.search_clubs($1) as r`, [s])).map((x) => x.name)
    expect(await names('ho tay')).toEqual(['Hồ Tây Runners', 'Tây Hồ Trail'])
    expect(await names('tay ho')).toEqual(['Tây Hồ Trail', 'Hồ Tây Runners'])
    expect(await names('nbnr')).toEqual(['No Beer No Run'])
    expect(await names('kin')).toEqual([])
    expect(await names('hoi chay kin')).toEqual(['Hội Chạy Kín'])
    expect(await names('')).toEqual(['Hồ Tây Runners', 'No Beer No Run', 'Tây Hồ Trail'])
    const one = (await q<Record<string, unknown>[]>(`select public.search_clubs('ho tay runners') as r`))[0]
    expect(one).not.toHaveProperty('invite_code')
  })

  it('003300 admin: ô trống gợi ý người + CLB; 1 ký tự khớp đầu từ; người thường bị chặn', async () => {
    const rows = async (s: string) => (await asUser<{ kind: string; name: string }>(db, ME, '/rpc', `select * from public.admin_search_accounts($1)`, [s])).rows
    await expect(rows('')).rejects.toThrow(/FORBIDDEN/)
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ME])
    const sug = await rows('')
    expect(sug.filter((r) => r.kind === 'USER').length).toBeGreaterThan(0)
    expect(sug.filter((r) => r.kind === 'CLUB').map((r) => r.name)[0]).toBe('Hồ Tây Runners')   // CLB đông nhất
    const d = await rows('d')
    expect(d.map((r) => r.name)).toEqual(expect.arrayContaining(['Đặng Anh Dũng', 'Ẩn Danh']))
    expect(d.map((r) => r.name)).not.toContain('Nguyễn Văn An')
    expect((await rows('no')).map((r) => r.name)).toEqual(['No Beer No Run'])
    expect((await rows('nguyen an')).map((r) => r.name)).toEqual(['Nguyễn Văn An'])
  })
})
