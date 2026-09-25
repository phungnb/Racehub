import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 005900: bộ đồng phục (áo + quần + tất + giày), họa tiết theo ô, mã bộ
const id = (n: number) => `00000000-0000-0000-0000-0000000059${String(n).padStart(2, '0')}`
const [ADM, CAP, MEM] = [1, 2, 3].map(id)
const CLUB = '00000000-0000-0000-0000-0000000059c1'

async function seed(db: PGlite) {
  const users = [ADM, CAP, MEM]
  await db.exec(`
    insert into auth.users (id, email) values ${users.map((u, i) => `('${u}', 'k${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${users.map((u, i) => `('${u}', 'K${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'Hà Nội Runners', '${CAP}', 'hnr059');
  `)
}
type Row = Record<string, any>
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const saveItem = (db: PGlite, p: object) => rpc<Row>(db, ADM, `select public.admin_save_avatar_item($1::jsonb) as r`, [JSON.stringify(p)])
const request = (db: PGlite, uid: string, p: object) => rpc<Row>(db, uid, `select public.request_club_uniform($1, $2::jsonb) as r`, [CLUB, JSON.stringify(p)])
const state = (db: PGlite, uid: string) => rpc<Row>(db, uid, `select public.character_state() as r`)

describe('Bộ đồng phục (005900)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADM])
    await db.exec(`insert into public.club_members (club_id, user_id, role, status) values
      ('${CLUB}', '${CAP}', 'OWNER', 'APPROVED'), ('${CLUB}', '${MEM}', 'MEMBER', 'APPROVED') on conflict do nothing;`)
  }, 240_000)

  it('họa tiết: đúng ô, đúng loại; chữ chỉ trên áo; áo lớp ảnh không có họa tiết', async () => {
    const top = await saveItem(db, { code: 'top_hoops', name: 'Áo sọc ngang', slot: 'top', render_kind: 'TINT', color: '#1d4ed8', price_xu: 10,
      print: { pattern: { kind: 'hoops', color: '#FFFFFF' } }, kit: 'kit_demo' })
    expect(top).toMatchObject({ print: { pattern: { kind: 'hoops', color: '#ffffff' } }, kit: 'kit_demo' })
    expect(await saveItem(db, { code: 'bottom_side', name: 'Quần sọc sườn', slot: 'bottom', render_kind: 'TINT', color: '#111827',
      print: { pattern: { kind: 'sides', color: '#1d4ed8' } }, kit: 'kit_demo' })).toMatchObject({ print: { pattern: { kind: 'sides' } } })
    expect(await fails(saveItem(db, { code: 'bottom_bad', name: 'Quần', slot: 'bottom', render_kind: 'TINT', color: '#111827',
      print: { pattern: { kind: 'sash', color: '#1d4ed8' } } }))).toContain('INVALID_PATTERN')
    expect(await fails(saveItem(db, { code: 'socks_txt', name: 'Tất', slot: 'socks', render_kind: 'TINT', color: '#ffffff',
      print: { title: 'HNR' } }))).toContain('PRINT_TOP_ONLY')
    expect(await fails(saveItem(db, { code: 'hat_pat', name: 'Mũ', slot: 'hat', render_kind: 'LAYER', layer_urls: { male: '/character/layers/x.png' },
      print: { pattern: { kind: 'hoops', color: '#ffffff' } } }))).toMatch(/INVALID_PATTERN|PATTERN_TINT_ONLY/)
    expect(await fails(saveItem(db, { code: 'top_x', name: 'Áo', slot: 'top', render_kind: 'TINT', color: '#000000', kit: 'Có Dấu' }))).toContain('INVALID_KIT')
    const s = await state(db, MEM)
    expect((s.items as Row[]).filter((i) => i.kit === 'kit_demo').map((i) => i.code).sort()).toEqual(['bottom_side', 'top_hoops'])
  })

  it('CLB gửi cả bộ → admin duyệt với giá từng món → thành viên nhận món 0 Xu, mặc cả bộ', async () => {
    expect(await fails(request(db, CAP, { name: 'Bộ HNR', color: '#dc2626', print: { title: 'HNR' }, parts: { hat: { color: '#000000' } } }))).toContain('INVALID_PARTS')
    const req = await request(db, CAP, {
      name: 'Bộ HNR 2027', color: '#dc2626',
      print: { title: 'HÀ NỘI RUNNERS', personal: 'NAME', pattern: { kind: 'sides', color: '#facc15' } },
      parts: { bottom: { color: '#111827', print: { pattern: { kind: 'sides', color: '#dc2626' } } }, socks: { color: '#ffffff', print: { pattern: { kind: 'band', color: '#dc2626' } } }, shoes: { color: '#111827' } },
    })
    expect(req.parts).toMatchObject({ bottom: { color: '#111827' }, socks: { print: { pattern: { kind: 'band' } } }, shoes: { color: '#111827', print: null } })
    const done = await rpc<Row>(db, ADM, `select public.admin_review_uniform_request($1, 'APPROVE', $2::jsonb) as r`,
      [req.id, JSON.stringify({ price_xu: 50, part_prices: { bottom: 20 } })])
    const code = done.item_code
    expect((done.kit_items as Row[]).map((i) => [i.slot, Number(i.price_xu)]).sort()).toEqual([['bottom', 20], ['shoes', 0], ['socks', 0]])
    const mine = ((await state(db, MEM)).items as Row[]).filter((i) => i.kit === code)
    expect(mine.map((i) => [i.slot, i.owned]).sort()).toEqual([['bottom', false], ['shoes', true], ['socks', true], ['top', false]])
    // tất + giày miễn phí đã có → mặc cả phần đã có được ngay
    await rpc(db, MEM, `select public.save_character('{}'::jsonb, $1::jsonb) as r`, [JSON.stringify({ socks: `${code}_socks`, shoes: `${code}_shoes` })])
    expect((await state(db, MEM)).equipped).toMatchObject({ socks: `${code}_socks`, shoes: `${code}_shoes` })
  })
})
