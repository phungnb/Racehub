import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 009200: nội dung thẻ gói Miễn phí / CLB Miễn phí / Doanh nghiệp do admin soạn; số quản trị viên CLB miễn phí do admin đặt
const [OWN, CAP, MEM, M2, ADM] = ['00000000-0000-0000-0000-0000000092a1', '00000000-0000-0000-0000-0000000092a2',
  '00000000-0000-0000-0000-0000000092a3', '00000000-0000-0000-0000-0000000092a4', '00000000-0000-0000-0000-0000000092a5']
const CLUB = '00000000-0000-0000-0000-0000000092c1'

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${OWN}', 'o@p.vn'), ('${CAP}', 'c@p.vn'), ('${MEM}', 'm@p.vn'), ('${M2}', 'm2@p.vn'), ('${ADM}', 'a@p.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ('${OWN}', 'Chủ', 0, 0, 1, now()), ('${CAP}', 'QTV', 0, 0, 1, now()), ('${MEM}', 'TV', 0, 0, 1, now()),
      ('${M2}', 'TV2', 0, 0, 1, now()), ('${ADM}', 'Admin', 0, 0, 1, now()) on conflict do nothing;
    update public.profiles set role = 'SYSTEM_ADMIN' where id = '${ADM}';
  `)
}
type Card = { title: string; subtitle: string; perks: string[]; note: string }
type Compare = { free_captains: number; club: { freeMaxCaptains: number }; content: { free: Card; clubFree: Card; org: Card } }
const rpc = async <T,>(db: PGlite, uid: string | null, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r as T
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }

describe('nội dung gói miễn phí + số quản trị viên CLB miễn phí (009200)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.exec(`
    insert into public.clubs (id, name, owner_id, invite_code, join_policy) values ('${CLUB}', 'CLB Gói', '${OWN}', 'pl9200', 'OPEN');
    insert into public.club_members (club_id, user_id, role, status) values
      ('${CLUB}', '${OWN}', 'OWNER', 'APPROVED'), ('${CLUB}', '${CAP}', 'CAPTAIN', 'APPROVED'),
      ('${CLUB}', '${MEM}', 'MEMBER', 'APPROVED'), ('${CLUB}', '${M2}', 'MEMBER', 'APPROVED')
    on conflict do nothing;
    `)
  }, 240_000)

  it('mặc định: khách xem được nội dung 3 thẻ (có biến số) và số quản trị viên = 2', async () => {
    const c = await rpc<Compare>(db, null, `select public.plan_compare() as r`)
    expect(c.free_captains).toBe(2)
    expect(c.club.freeMaxCaptains).toBe(2)
    expect(c.content.free.title).toBe('Miễn phí')
    expect(c.content.free.perks.some((p) => p.includes('{freeSlots}'))).toBe(true)
    expect(c.content.clubFree.perks).toContain('Tối đa {clubCaptains} quản trị viên')
    expect(c.content.org.perks.length).toBeGreaterThan(3)
  })

  it('admin sửa riêng thẻ Miễn phí: các thẻ khác và chính sách vận hành giữ nguyên; có phiên bản + nhật ký', async () => {
    expect(await fails(rpc(db, MEM, `select public.admin_publish_ops_policy($1::jsonb) as r`,
      [JSON.stringify({ content: { plans: { free: { title: 'Free', perks: ['Hack'] } } } })]))).toContain('FORBIDDEN')
    for (const bad of [
      { title: 'X', perks: ['Ghi bài GPS'] },                    // tiêu đề quá ngắn
      { title: 'Miễn phí', perks: [] },                          // không có dòng nào
      { title: 'Miễn phí', perks: ['a'.repeat(201)] },          // dòng quá dài
      { title: 'Miễn phí', perks: [1, 2] },                      // không phải chữ
    ]) expect(await fails(rpc(db, ADM, `select public.admin_publish_ops_policy($1::jsonb) as r`,
      [JSON.stringify({ content: { plans: { free: bad } } })]))).toContain('INVALID_CONFIG')

    const v = await rpc<number>(db, ADM, `select public.admin_publish_ops_policy($1::jsonb, 'Sửa gói miễn phí') as r`,
      [JSON.stringify({ content: { plans: { free: { title: 'Gói Free', subtitle: 'Cho mọi runner', perks: ['Ghi bài GPS', 'Tạo thử thách tới {freeSlots} người'], note: '', hacked: 1 } } } })])
    const c = await rpc<Compare>(db, null, `select public.plan_compare() as r`)
    expect(c.content.free).toEqual({ title: 'Gói Free', subtitle: 'Cho mọi runner', perks: ['Ghi bài GPS', 'Tạo thử thách tới {freeSlots} người'], note: '' })
    expect(c.content.clubFree.title).toBe('CLB Miễn phí')
    expect(c.content.org.title).toBe('RaceHub Doanh nghiệp')
    const ops = await rpc<{ version: number; features: { nearby: boolean }; content: { enterprise: { title: string } } }>(db, ADM, `select public.ops_policy() as r`)
    expect(ops.version).toBe(v)
    expect(ops.features.nearby).toBe(true)
    expect(ops.content.enterprise.title).toBe('Phong trào chạy bộ cho cả tổ chức')
    expect((await db.query(`select 1 from public.admin_audit_log where target = $1`, [`ops_policy v${v}: Sửa gói miễn phí`])).rows).toHaveLength(1)

    // Lưu tab Chính sách vận hành (không gửi plans) không làm mất nội dung thẻ gói
    await rpc(db, ADM, `select public.admin_publish_ops_policy($1::jsonb) as r`, [JSON.stringify({ features: { nearby: false } })])
    expect((await rpc<Compare>(db, null, `select public.plan_compare() as r`)).content.free.title).toBe('Gói Free')
    // Khôi phục bản trước đó
    await rpc(db, ADM, `select public.admin_rollback_config('ops_policy', $1) as r`, [v])
    expect((await rpc<{ features: { nearby: boolean } }>(db, ADM, `select public.ops_policy() as r`)).features.nearby).toBe(true)
  })

  it('số quản trị viên CLB miễn phí do admin đặt: trigger, club_plan, plan_compare cùng đọc một số', async () => {
    expect((await rpc<{ captain_limit: number }>(db, OWN, `select public.club_plan($1) as r`, [CLUB])).captain_limit).toBe(2)
    expect(await fails(rpc(db, ADM, `select public.admin_publish_config('economy_global_config', $1::jsonb) as r`,
      [JSON.stringify({ clubChallenge: { freeMaxCaptains: 500 } })]))).toContain('INVALID_CONFIG')
    await rpc(db, ADM, `select public.admin_publish_config('economy_global_config', $1::jsonb) as r`, [JSON.stringify({ clubChallenge: { freeMaxCaptains: 1 } })])
    expect((await rpc<Compare>(db, null, `select public.plan_compare() as r`)).free_captains).toBe(1)
    expect((await rpc<{ captain_limit: number }>(db, OWN, `select public.club_plan($1) as r`, [CLUB])).captain_limit).toBe(1)
    // Đã có 1 quản trị viên → không thêm được người thứ hai
    expect(await fails(db.query(`update public.club_members set role = 'CAPTAIN' where club_id = $1 and user_id = $2`, [CLUB, MEM]))).toContain('CAPTAIN_LIMIT')
    // Nới lên 3 → thêm được
    await rpc(db, ADM, `select public.admin_publish_config('economy_global_config', $1::jsonb) as r`, [JSON.stringify({ clubChallenge: { freeMaxCaptains: 3 } })])
    expect(await fails(db.query(`update public.club_members set role = 'CAPTAIN' where club_id = $1 and user_id in ($2, $3)`, [CLUB, MEM, M2]))).toBe('OK')
    expect((await db.query(`select 1 from public.club_members where club_id = $1 and role = 'CAPTAIN'`, [CLUB])).rows).toHaveLength(3)
  })
})
