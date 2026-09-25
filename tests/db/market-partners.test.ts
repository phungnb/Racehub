import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 005300: Chợ Runner — hồ sơ HLV / Shop / Dịch vụ đã xác minh
const id = (n: number) => `00000000-0000-0000-0000-0000000053${String(n).padStart(2, '0')}`
const [COACH, SHOP, R1, ADM] = [1, 2, 3, 4].map(id)
const img = (uid: string, f = 'a.jpg') => `https://x.supabase.co/storage/v1/object/public/market-media/${uid}/${f}`

async function seed(db: PGlite) {
  const users = [COACH, SHOP, R1, ADM]
  await db.exec(`
    insert into auth.users (id, email) values ${users.map((u, i) => `('${u}', 'm${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${users.map((u, i) => `('${u}', 'M${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
  `)
}
type Row = Record<string, any>
const rpc = async <T = Row>(db: PGlite, uid: string | null, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const save = (db: PGlite, uid: string, p: object) => rpc<Row>(db, uid, `select public.save_partner($1::jsonb) as r`, [JSON.stringify(p)])
const review = (db: PGlite, uid: string, pid: string, act: string, note: string | null = null) =>
  rpc<Row>(db, uid, `select public.admin_review_partner($1, $2, $3) as r`, [pid, act, note])
const list = (db: PGlite, kind: string | null = null, area: string | null = null, q: string | null = null) =>
  rpc<Row[]>(db, null, `select public.list_partners($1, $2, $3) as r`, [kind, area, q])

describe('Chợ Runner — hồ sơ đối tác (005300)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADM])
    await db.query(`update public.profiles set level = 5 where id = $1`, [COACH])
  }, 240_000)

  it('đăng ký → chờ duyệt (ẩn khỏi chợ) → admin xác minh → hiện, tìm không dấu, có thành tích HLV', async () => {
    const base = { kind: 'COACH', name: 'HLV Nguyễn Tuấn', tagline: 'Luyện marathon sub 4', area: 'Hà Nội',
      specialties: ['Marathon', 'Trail', ''], avatar_url: img(COACH),
      services: [{ name: 'Giáo án 12 tuần', price: '1.500.000đ', unit: 'gói' }, { name: 'x' }],
      contacts: { phone: '0912 345 678', zalo: '', website: 'https://tuan.run' } }
    expect(await fails(save(db, COACH, { ...base, avatar_url: img(SHOP) }))).toContain('INVALID_PARTNER_IMAGE')
    expect(await fails(save(db, COACH, { ...base, contacts: { website: 'javascript:alert(1)' } }))).toContain('INVALID_CONTACT')
    expect(await fails(save(db, COACH, { ...base, services: Array.from({ length: 13 }, () => ({ name: 'Buổi tập' })) }))).toContain('TOO_MANY_SERVICES')
    const p = await save(db, COACH, base)
    expect(p).toMatchObject({ status: 'PENDING', verified: false, specialties: ['Marathon', 'Trail'], contacts: { phone: '0912345678', website: 'https://tuan.run' } })
    expect(p.services).toHaveLength(1)
    expect(await fails(save(db, COACH, base))).toContain('PARTNER_EXISTS')
    expect(await list(db)).toEqual([])
    expect(await fails(rpc(db, R1, `select public.get_partner($1) as r`, [p.id]))).toContain('PARTNER_NOT_FOUND')
    expect(await fails(save(db, R1, { ...base, id: p.id }))).toContain('FORBIDDEN')
    expect(await fails(review(db, R1, p.id, 'APPROVE'))).not.toBe('OK')

    await review(db, ADM, p.id, 'APPROVE')
    const all = await list(db)
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ name: 'HLV Nguyễn Tuấn', verified: true })
    expect(all[0]).not.toHaveProperty('contacts')
    expect(await list(db, 'COACH', 'Hà Nội', 'nguyen tuan')).toHaveLength(1)
    expect(await list(db, null, null, 'marathon')).toHaveLength(1)
    expect(await list(db, 'SHOP')).toEqual([])
    expect(await list(db, null, 'Huế')).toEqual([])
    const full = await rpc<Row>(db, null, `select public.get_partner($1) as r`, [p.id])
    expect(full).toMatchObject({ contacts: { phone: '0912345678' }, stats: { level: 5, runs_12m: 0 }, review_note: null })
    expect((await db.query(`select 1 from public.notifications where user_id = $1 and kind = 'MARKET'`, [COACH])).rows).toHaveLength(1)

    // sửa khi đang hiện: vẫn hiện
    expect(await save(db, COACH, { ...base, id: p.id, tagline: 'Sub 3:30' })).toMatchObject({ status: 'APPROVED', tagline: 'Sub 3:30' })
  })

  it('từ chối cần lý do; sửa lại thì gửi duyệt lại; ẩn khỏi chợ', async () => {
    const s = await save(db, SHOP, { kind: 'SHOP', name: 'Shop Giày Chạy', area: 'TP. Hồ Chí Minh', contacts: { email: 'Shop@Giay.vn' } })
    expect(s.contacts).toEqual({ email: 'shop@giay.vn' })
    expect(await fails(review(db, ADM, s.id, 'REJECT'))).toContain('REASON_REQUIRED')
    expect(await review(db, ADM, s.id, 'REJECT', 'Thiếu ảnh cửa hàng')).toMatchObject({ status: 'REJECTED', review_note: 'Thiếu ảnh cửa hàng' })
    expect((await rpc<Row[]>(db, SHOP, `select public.my_partners() as r`))[0]).toMatchObject({ status: 'REJECTED', review_note: 'Thiếu ảnh cửa hàng' })
    expect(await save(db, SHOP, { id: s.id, name: 'Shop Giày Chạy', cover_url: img(SHOP, 'c.webp') })).toMatchObject({ status: 'PENDING' })
    expect((await rpc<Row[]>(db, ADM, `select public.admin_list_partners('PENDING') as r`)).map((x) => x.id)).toEqual([s.id])
    await review(db, ADM, s.id, 'APPROVE')
    expect(await list(db, 'shop')).toHaveLength(1)
    await review(db, ADM, s.id, 'HIDE', 'Vi phạm quy định')
    expect(await list(db, 'SHOP')).toEqual([])
  })
})
