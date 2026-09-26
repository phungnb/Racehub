import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 007900: cửa hàng CLB — đơn ghi trong app, tiền chuyển thẳng vào tài khoản CLB (RaceHub không giữ tiền)
const OWN = '00000000-0000-0000-0000-0000000079a1'
const MEM = '00000000-0000-0000-0000-0000000079a2'
const OUT = '00000000-0000-0000-0000-0000000079a3'
const CLUB = '00000000-0000-0000-0000-0000000079c1'
type Row = Record<string, any>

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${OWN}', 'o79@x.vn'), ('${MEM}', 'm79@x.vn'), ('${OUT}', 'x79@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ('${OWN}', 'Chủ nhiệm', 0, 0, 1, now()), ('${MEM}', 'Thành viên', 0, 0, 1, now()), ('${OUT}', 'Người ngoài', 0, 0, 1, now()) on conflict do nothing;
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'CLB Áo Đẹp', '${OWN}', 'aodep79');
    insert into public.club_members (club_id, user_id, role, status) values ('${CLUB}', '${OWN}', 'OWNER', 'APPROVED'), ('${CLUB}', '${MEM}', 'MEMBER', 'APPROVED')
      on conflict do nothing;
  `)
}
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const order = (db: PGlite, uid: string, pid: string, items: object[]) => rpc<Row>(db, uid, `select public.place_club_order($1, $2::jsonb, 'giao ở buổi chạy CN') as r`, [pid, JSON.stringify(items)])

describe('cửa hàng CLB (007900)', () => {
  let db: PGlite
  let pid: string
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 240_000)

  it('chỉ ban quản trị đăng sản phẩm; chưa khai tài khoản CLB thì chưa đặt được', async () => {
    const p = { club_id: CLUB, title: 'Áo CLB 2026', price_vnd: 250000, sizes: ['S', 'M', 'L'], stock: 5, max_per_order: 3 }
    expect(await fails(rpc(db, MEM, `select public.save_club_product($1::jsonb) as r`, [JSON.stringify(p)]))).toContain('FORBIDDEN')
    pid = (await rpc<string>(db, OWN, `select public.save_club_product($1::jsonb) as r`, [JSON.stringify(p)]))!
    expect((await db.query(`select 1 from public.notifications where user_id = $1 and kind = 'CLUB_SHOP'`, [MEM])).rows).toHaveLength(1)
    expect(await fails(order(db, MEM, pid, [{ size: 'M', qty: 1 }]))).toContain('CLUB_BANK_MISSING')
    await db.query(`update public.clubs set bank_bin = '970436', bank_account_no = '0123456789', bank_account_name = 'CLB AO DEP' where id = $1`, [CLUB])
  })

  it('đặt hàng: kiểm size, số lượng, tồn; trả mã CK + tài khoản CLB; người ngoài không đặt được', async () => {
    expect(await fails(order(db, MEM, pid, [{ size: 'XXL', qty: 1 }]))).toContain('INVALID_SIZE')
    expect(await fails(order(db, MEM, pid, [{ size: 'M', qty: 4 }]))).toContain('INVALID_QUANTITY')
    expect(await fails(order(db, OUT, pid, [{ size: 'M', qty: 1 }]))).toContain('NOT_A_MEMBER')
    const o = await order(db, MEM, pid, [{ size: 'M', qty: 2 }, { size: 'L', qty: 1 }])
    expect(o).toMatchObject({ quantity: 3, amount_vnd: 750000, status: 'PENDING', bank: { account_no: '0123456789' } })
    expect(o.code).toMatch(/^RH[0-9A-F]{6}$/)
    await order(db, OWN, pid, [{ size: 'S', qty: 2 }])
    expect(await fails(order(db, MEM, pid, [{ size: 'S', qty: 1 }]))).toContain('OUT_OF_STOCK')      // 5 cái đã hết
    const shop = await rpc<Row>(db, MEM, `select public.club_shop($1) as r`, [CLUB])
    expect(shop.products[0]).toMatchObject({ sold: 5, open: false })
    expect(shop.products[0].pending).toBeNull()                                                          // thành viên không thấy số liệu quản trị
    expect(shop.my_orders).toHaveLength(1)
  })

  it('ban quản trị: tổng hợp size, xác nhận đã nhận tiền → đã giao (báo người đặt); người đặt chỉ huỷ được khi chưa trả', async () => {
    const adm = await rpc<Row>(db, OWN, `select public.club_orders_admin($1) as r`, [pid])
    expect(adm.sizes).toEqual([{ size: 'L', qty: 1, paid_qty: 0 }, { size: 'M', qty: 2, paid_qty: 0 }, { size: 'S', qty: 2, paid_qty: 0 }])
    expect(adm.totals).toMatchObject({ orders: 2, pending_vnd: 1250000, paid_vnd: 0 })
    const mine = adm.orders.find((o: Row) => o.user_id === MEM)
    expect(await fails(rpc(db, MEM, `select public.set_club_order_status($1, 'PAID') as r`, [mine.id]))).toContain('FORBIDDEN')
    expect(await rpc(db, OWN, `select public.set_club_order_status($1, 'PAID') as r`, [mine.id])).toMatchObject({ status: 'PAID' })
    expect(await fails(rpc(db, MEM, `select public.cancel_my_club_order($1) as r`, [mine.id]))).toContain('ORDER_LOCKED')
    expect(await fails(rpc(db, OWN, `select public.set_club_order_status($1, 'PENDING') as r`, [adm.orders.find((o: Row) => o.user_id === OWN).id]))).toContain('INVALID_STATUS')
    expect(await rpc(db, OWN, `select public.set_club_order_status($1, 'DELIVERED') as r`, [mine.id])).toMatchObject({ status: 'DELIVERED' })
    expect((await db.query<Row>(`select title from public.notifications where user_id = $1 and kind = 'CLUB_SHOP' order by created_at`, [MEM])).rows.map((r: Row) => r.title))
      .toEqual(expect.arrayContaining([expect.stringContaining('đã nhận tiền'), expect.stringContaining('đã giao')]))
    const other = adm.orders.find((o: Row) => o.user_id === OWN)
    expect(await rpc(db, OWN, `select public.cancel_my_club_order($1) as r`, [other.id])).toMatchObject({ status: 'CANCELLED' })
    expect((await rpc<Row>(db, MEM, `select public.club_shop($1) as r`, [CLUB])).products[0]).toMatchObject({ sold: 3, open: true })
  })
})
