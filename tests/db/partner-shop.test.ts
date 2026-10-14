import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 016300: Cửa hàng đối tác — sản phẩm, biến thể, tồn kho, đơn hàng, thanh toán
const id = (n: number) => `00000000-0000-0000-0000-0000000163${String(n).padStart(2, '0')}`
const [OWNER, BUYER, OTHER, ADM] = [1, 2, 3, 4].map(id)
const img = (uid: string, f = 'a.jpg') => `https://x.supabase.co/storage/v1/object/public/market-media/${uid}/${f}`

async function seed(db: PGlite) {
  const users = [OWNER, BUYER, OTHER, ADM]
  await db.exec(`
    insert into auth.users (id, email) values ${users.map((u, i) => `('${u}', 's${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${users.map((u, i) => `('${u}', 'S${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
  `)
}
type Row = Record<string, any>
const rpc = async <T = Row>(db: PGlite, uid: string | null, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const j = (o: unknown) => JSON.stringify(o)
const saveProduct = (db: PGlite, uid: string, p: object) => rpc<Row>(db, uid, `select public.save_partner_product($1::jsonb) as r`, [j(p)])
const shop = (db: PGlite, uid: string | null, pid: string) => rpc<Row>(db, uid, `select public.partner_shop($1) as r`, [pid])
const order = (db: PGlite, uid: string, pid: string, items: object[], method = 'BANK', buyer: object = { name: 'Nguyễn An', phone: '0912 345 678', address: '12 Lê Lợi, Quận 1, TP.HCM' }) =>
  rpc<Row>(db, uid, `select public.place_partner_order($1, $2::jsonb, $3::jsonb, $4, 'Giao giờ hành chính') as r`, [pid, j(items), j(buyer), method])
const setStatus = (db: PGlite, uid: string, oid: string, st: string, note: string | null = null, tracking: string | null = null) =>
  rpc<Row>(db, uid, `select public.set_partner_order_status($1, $2, $3, $4) as r`, [oid, st, note, tracking])

describe('Cửa hàng đối tác — sản phẩm & đơn hàng (016300)', () => {
  let db: PGlite
  let pid: string
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADM])
    const p = await rpc<Row>(db, OWNER, `select public.save_partner($1::jsonb) as r`, [j({ kind: 'SHOP', name: 'Shop Giày Chạy' })])
    pid = p.id
  }, 240_000)

  it('đối tác đăng sản phẩm ngay khi có hồ sơ, nhưng khách chỉ thấy sau khi hồ sơ được xác minh', async () => {
    expect(await fails(saveProduct(db, BUYER, { partner_id: pid, title: 'Giày X', price_vnd: 1000 }))).toContain('FORBIDDEN')
    expect(await fails(saveProduct(db, OWNER, { partner_id: pid, title: 'G', price_vnd: 1000 }))).toContain('INVALID_PRODUCT')
    expect(await fails(saveProduct(db, OWNER, { partner_id: pid, title: 'Giày X', price_vnd: 100, compare_price_vnd: 50 }))).toContain('INVALID_PRICE')
    expect(await fails(saveProduct(db, OWNER, { partner_id: pid, title: 'Giày X', price_vnd: 100, images: [img(BUYER)] }))).toContain('INVALID_PARTNER_IMAGE')
    const g = await saveProduct(db, OWNER, { partner_id: pid, title: 'Giày chạy Alpha', price_vnd: 2_000_000, compare_price_vnd: 2_500_000, category: 'Giày',
      images: [img(OWNER), img(OWNER, 'b.png')], variants: [{ name: '41', stock: 2 }, { name: '42', stock: 5, price_vnd: 2_100_000 }, { name: '' }] })
    expect(g).toMatchObject({ price_min: 2_000_000, price_max: 2_100_000, in_stock: true })
    expect(g.variants).toHaveLength(2)
    const s = await shop(db, OWNER, pid)
    expect(s.products).toHaveLength(1)
    expect(s.partner.is_mine).toBe(true)
    expect(await fails(shop(db, BUYER, pid))).toContain('SHOP_NOT_FOUND')
    await rpc(db, ADM, `select public.admin_review_partner($1, 'APPROVE', null) as r`, [pid])
    expect((await shop(db, BUYER, pid)).products).toHaveLength(1)
    expect(await rpc<Row[]>(db, null, `select public.list_partners('SHOP') as r`)).toMatchObject([{ products_count: 1 }])
    // sản phẩm ẩn: khách không thấy
    await saveProduct(db, OWNER, { id: g.id, partner_id: pid, title: 'Giày chạy Alpha', price_vnd: 2_000_000, status: 'HIDDEN', variants: g.variants })
    expect((await shop(db, BUYER, pid)).products).toHaveLength(0)
    expect(await fails(rpc(db, BUYER, `select public.get_shop_product($1) as r`, [g.id]))).toContain('PRODUCT_NOT_FOUND')
    await saveProduct(db, OWNER, { id: g.id, partner_id: pid, title: 'Giày chạy Alpha', price_vnd: 2_000_000, status: 'ACTIVE', variants: g.variants })
  })

  it('cài đặt thanh toán + vận chuyển; chỉ chủ shop sửa được', async () => {
    const bank = { bin: '970436', account_no: '0011004', account_name: 'nguyen van a' }
    expect(await fails(rpc(db, BUYER, `select public.save_partner_shop($1, $2::jsonb) as r`, [pid, j({ ship_fee_vnd: 0 })]))).toContain('FORBIDDEN')
    expect(await fails(rpc(db, OWNER, `select public.save_partner_shop($1, $2::jsonb) as r`, [pid, j({ bank: { ...bank, bin: '12' } })]))).toContain('INVALID_BANK')
    const s = await rpc<Row>(db, OWNER, `select public.save_partner_shop($1, $2::jsonb) as r`,
      [pid, j({ ship_fee_vnd: 30000, free_ship_over_vnd: 3_000_000, cod_enabled: false, bank, shop_policy: 'Đổi size trong 7 ngày' })])
    expect(s).toMatchObject({ ship_fee_vnd: 30000, bank_ready: true, bank: { account_name: 'NGUYEN VAN A' } })
    const pub = (await shop(db, BUYER, pid)).settings
    expect(pub.bank_ready).toBe(true)
    expect(pub).not.toHaveProperty('bank')
  })

  it('đặt hàng: tính tiền ở server, trừ tồn kho, chặn bán lố, COD, shop tự mua', async () => {
    const g = (await shop(db, OWNER, pid)).products[0]
    const [v41, v42] = g.variants
    expect(await fails(order(db, OWNER, pid, [{ product_id: g.id, variant_id: v41.id, qty: 1 }]))).toContain('OWN_SHOP')
    expect(await fails(order(db, BUYER, pid, []))).toContain('EMPTY_CART')
    expect(await fails(order(db, BUYER, pid, [{ product_id: g.id, qty: 1 }]))).toContain('VARIANT_REQUIRED')
    expect(await fails(order(db, BUYER, pid, [{ product_id: g.id, variant_id: v41.id, qty: 3 }]))).toContain('OUT_OF_STOCK')
    expect(await fails(order(db, BUYER, pid, [{ product_id: g.id, variant_id: v41.id, qty: 1 }], 'COD'))).toContain('COD_DISABLED')
    expect(await fails(order(db, BUYER, pid, [{ product_id: g.id, variant_id: v41.id, qty: 1 }], 'BANK', { name: 'A', phone: '123', address: 'x' }))).toContain('INVALID_BUYER')

    const o = await order(db, BUYER, pid, [{ product_id: g.id, variant_id: v41.id, qty: 1 }, { product_id: g.id, variant_id: v42.id, qty: 2 }, { product_id: g.id, variant_id: v42.id, qty: 1 }])
    // 2.000.000 + 3 × 2.100.000 = 8.300.000 ≥ 3.000.000 → miễn phí giao
    expect(o).toMatchObject({ subtotal_vnd: 8_300_000, ship_fee_vnd: 0, amount_vnd: 8_300_000, quantity: 4, status: 'PENDING', payment_method: 'BANK',
      buyer_phone: '0912345678', bank: { account_no: '0011004' } })
    expect(o.code).toMatch(/^RH[0-9A-F]{6}$/)
    const after = (await shop(db, BUYER, pid)).products[0]
    expect(after.variants.map((v: Row) => v.stock)).toEqual([1, 2])
    expect(after.sold).toBe(4)
    // hết hàng khi mua hết
    await order(db, BUYER, pid, [{ product_id: g.id, variant_id: v41.id, qty: 1 }])
    expect(await fails(order(db, BUYER, pid, [{ product_id: g.id, variant_id: v41.id, qty: 1 }]))).toContain('OUT_OF_STOCK')
    // 1 dòng lỗi → cả đơn không ghi (không trừ kho dở dang)
    expect(await fails(order(db, BUYER, pid, [{ product_id: g.id, variant_id: v42.id, qty: 1 }, { product_id: g.id, variant_id: v41.id, qty: 1 }]))).toContain('OUT_OF_STOCK')
    expect((await shop(db, BUYER, pid)).products[0].variants.map((v: Row) => v.stock)).toEqual([0, 2])
    // người ngoài thấy hết hàng nhưng chủ shop nhận thông báo đơn mới
    expect((await db.query(`select 1 from public.notifications where user_id = $1 and kind = 'MARKET' and title like 'Đơn mới%'`, [OWNER])).rows.length).toBeGreaterThanOrEqual(2)
  })

  it('phí giao hàng, COD, sản phẩm không biến thể', async () => {
    await rpc(db, OWNER, `select public.save_partner_shop($1, $2::jsonb) as r`,
      [pid, j({ ship_fee_vnd: 30000, free_ship_over_vnd: 3_000_000, cod_enabled: true, bank: { bin: '970436', account_no: '0011004', account_name: 'A B' } })])
    const t = await saveProduct(db, OWNER, { partner_id: pid, title: 'Tất chạy bộ', price_vnd: 90_000, stock: 10 })
    const o = await order(db, OTHER, pid, [{ product_id: t.id, qty: 2 }], 'COD')
    expect(o).toMatchObject({ subtotal_vnd: 180_000, ship_fee_vnd: 30000, amount_vnd: 210_000, payment_method: 'COD', bank: null })
    expect(await fails(order(db, OTHER, pid, [{ product_id: t.id, variant_id: id(99), qty: 1 }]))).toContain('PRODUCT_UNAVAILABLE')
    expect((await shop(db, OTHER, pid)).products.find((x: Row) => x.id === t.id).stock).toBe(8)
  })

  it('vòng đời đơn: chuyển khoản → xác nhận tiền → giao → hoàn tất; huỷ hoàn tồn kho; phân quyền', async () => {
    const t = (await shop(db, OWNER, pid)).products.find((x: Row) => x.title === 'Tất chạy bộ')
    const o = await order(db, BUYER, pid, [{ product_id: t.id, qty: 3 }])
    expect((await rpc<Row>(db, OWNER, `select public.partner_orders_admin($1) as r`, [pid])).orders.length).toBeGreaterThanOrEqual(1)
    expect(await fails(rpc(db, BUYER, `select public.partner_orders_admin($1) as r`, [pid]))).toContain('FORBIDDEN')
    expect(await fails(setStatus(db, BUYER, o.id, 'PAID'))).toContain('FORBIDDEN')
    expect(await fails(setStatus(db, OWNER, o.id, 'SHIPPING'))).toContain('PAYMENT_NOT_CONFIRMED')
    expect(await fails(setStatus(db, OWNER, o.id, 'DONE'))).toContain('INVALID_STATUS')
    expect(await setStatus(db, OWNER, o.id, 'PAID')).toMatchObject({ status: 'PAID', bank: null })
    expect(await fails(rpc(db, BUYER, `select public.cancel_my_partner_order($1) as r`, [o.id]))).toContain('ORDER_LOCKED')
    expect(await setStatus(db, OWNER, o.id, 'SHIPPING', null, 'GHN123')).toMatchObject({ status: 'SHIPPING', tracking_code: 'GHN123' })
    expect(await setStatus(db, OWNER, o.id, 'DONE')).toMatchObject({ status: 'DONE' })
    expect(await fails(setStatus(db, OWNER, o.id, 'CANCELLED'))).toContain('INVALID_STATUS')
    const mine = await rpc<Row[]>(db, BUYER, `select public.my_partner_orders() as r`)
    expect(mine.find((x) => x.id === o.id)).toMatchObject({ status: 'DONE', shop_name: 'Shop Giày Chạy' })
    expect((await rpc<Row[]>(db, OTHER, `select public.my_partner_orders() as r`)).some((x) => x.id === o.id)).toBe(false)

    // khách huỷ đơn chờ → hoàn kho
    const before = (await shop(db, OWNER, pid)).products.find((x: Row) => x.id === t.id)
    const o2 = await order(db, BUYER, pid, [{ product_id: t.id, qty: 2 }])
    expect((await shop(db, OWNER, pid)).products.find((x: Row) => x.id === t.id).stock).toBe(before.stock - 2)
    expect(await rpc(db, BUYER, `select public.cancel_my_partner_order($1) as r`, [o2.id])).toMatchObject({ status: 'CANCELLED' })
    expect((await shop(db, OWNER, pid)).products.find((x: Row) => x.id === t.id)).toMatchObject({ stock: before.stock, sold: before.sold })
    // chủ shop huỷ đơn đã nhận tiền → hoàn kho
    const o3 = await order(db, BUYER, pid, [{ product_id: t.id, qty: 1 }])
    await setStatus(db, OWNER, o3.id, 'PAID')
    await setStatus(db, OWNER, o3.id, 'CANCELLED', 'Hết hàng thực tế')
    expect((await shop(db, OWNER, pid)).products.find((x: Row) => x.id === t.id).stock).toBe(before.stock)
    const totals = (await rpc<Row>(db, OWNER, `select public.partner_orders_admin($1) as r`, [pid])).totals
    expect(totals.done).toBe(1)
  })

  it('hồ sơ bị ẩn: không đặt được; xoá sản phẩm; sửa biến thể giữ id', async () => {
    const g = (await shop(db, OWNER, pid)).products.find((x: Row) => x.title === 'Giày chạy Alpha')
    const edited = await saveProduct(db, OWNER, { id: g.id, title: 'Giày chạy Alpha', price_vnd: 2_000_000, variants: [{ id: g.variants[1].id, name: '42.5', stock: 9 }] })
    expect(edited.variants).toHaveLength(1)
    expect(edited.variants[0]).toMatchObject({ id: g.variants[1].id, name: '42.5', stock: 9 })
    await rpc(db, ADM, `select public.admin_review_partner($1, 'HIDE', 'Vi phạm quy định') as r`, [pid])
    expect(await fails(order(db, BUYER, pid, [{ product_id: g.id, variant_id: g.variants[1].id, qty: 1 }]))).toContain('SHOP_NOT_FOUND')
    expect(await fails(rpc(db, BUYER, `select public.delete_partner_product($1) as r`, [g.id]))).toContain('FORBIDDEN')
    await rpc(db, OWNER, `select public.delete_partner_product($1) as r`, [g.id])
    expect((await shop(db, OWNER, pid)).products.some((x: Row) => x.id === g.id)).toBe(false)
  })
})
