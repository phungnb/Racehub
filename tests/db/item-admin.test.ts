import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 001200: quản trị vật phẩm nhân vật (thêm màu / lớp ảnh, bán / ngừng bán, kho ảnh lớp)
const ADMIN = '00000000-0000-0000-0000-0000000000f0'
const U = '00000000-0000-0000-0000-0000000000f1'

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${ADMIN}', 'boss@x.vn'), ('${U}', 'lan@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, role, created_at) values
      ('${ADMIN}', 'Quản trị', 0, 0, 1, 'SYSTEM_ADMIN', now()), ('${U}', 'Lan', 0, 0, 1, 'MEMBER', now());
  `)
}

type Item = { code: string; slot: string; render_kind: string; layer_urls: Record<string, string> | null; color: string | null
  is_active: boolean; owners: number; price_xu: number; owned?: boolean }
const rpc = async <T = Record<string, unknown>>(db: PGlite, uid: string, sql: string, params: unknown[] = []) =>
  (await asUser<T>(db, uid, '/rpc', sql, params)).rows
const fails = async (db: PGlite, uid: string, sql: string, params: unknown[] = []) => {
  try { await asUser(db, uid, '/rpc', sql, params) } catch (e) { return (e as Error).message }
  return 'OK'
}
const save = (db: PGlite, uid: string, item: Record<string, unknown>) =>
  rpc<{ r: Item }>(db, uid, `select public.admin_save_avatar_item($1::jsonb) as r`, [JSON.stringify(item)]).then((r) => r[0].r)
const saveFails = (db: PGlite, uid: string, item: Record<string, unknown>) =>
  fails(db, uid, `select public.admin_save_avatar_item($1::jsonb)`, [JSON.stringify(item)])
const HAT = {
  code: 'hat_cap_red', name: 'Mũ lưỡi trai Đỏ', slot: 'hat', rarity: 'rare', render_kind: 'LAYER', price_xu: 50,
  layer_urls: { male: 'https://abc.supabase.co/storage/v1/object/public/character-layers/hat_cap_red/male-1.png', female: '/character/layers/hat_cap_red_female.png' },
}

describe('Quản trị vật phẩm nhân vật (001200)', () => {
  let db: PGlite
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 240_000)

  it('chỉ quản trị viên hệ thống được xem / thêm / ngừng bán', async () => {
    expect(await fails(db, U, `select public.admin_list_avatar_items()`)).toContain('FORBIDDEN')
    expect(await saveFails(db, U, HAT)).toContain('FORBIDDEN')
    expect(await fails(db, U, `select public.admin_set_avatar_item_active('top_red', false)`)).toContain('FORBIDDEN')
  })

  it('thêm món lớp ảnh → hiện trong shop, ô mới có trong danh mục người chơi, có nhật ký', async () => {
    const r = await save(db, ADMIN, HAT)
    expect(r).toMatchObject({ code: 'hat_cap_red', slot: 'hat', render_kind: 'LAYER', color: null, is_active: true })
    const s = (await rpc<{ s: { items: Item[] } }>(db, U, `select public.character_state() as s`))[0].s
    expect(s.items.find((i) => i.code === 'hat_cap_red')).toMatchObject({ owned: false, layer_urls: HAT.layer_urls })
    const log = await db.query(`select action from public.admin_audit_log where target = 'avatar_item:hat_cap_red'`)
    expect(log.rows).toEqual([{ action: 'AVATAR_ITEM_CREATE' }])
    // sửa giá → ghi nhật ký cập nhật
    expect((await save(db, ADMIN, { ...HAT, price_xu: 60 })).price_xu).toBe(60)
    const all = (await rpc<{ r: Item[] }>(db, ADMIN, `select public.admin_list_avatar_items() as r`))[0].r
    expect(all.find((i) => i.code === 'hat_cap_red')).toMatchObject({ owners: 0, is_active: true })
  })

  it('thêm màu mới cho áo; màu chỉ dành cho áo/quần/tất/giày', async () => {
    const r = await save(db, ADMIN, { code: 'top_vn_red', name: 'Áo Đỏ Cờ', slot: 'top', rarity: 'epic', color: '#da251d', price_xu: 120 })
    expect(r).toMatchObject({ render_kind: 'TINT', color: '#da251d', layer_urls: null })
    expect(await saveFails(db, ADMIN, { code: 'hat_blue', name: 'Mũ xanh', slot: 'hat', color: '#2f6bff' })).toContain('TINT_SLOT_ONLY')
  })

  it('từ chối dữ liệu sai', async () => {
    expect(await saveFails(db, ADMIN, { ...HAT, code: 'Mũ đỏ!' })).toContain('INVALID_CODE')
    expect(await saveFails(db, ADMIN, { ...HAT, name: 'x' })).toContain('INVALID_NAME')
    expect(await saveFails(db, ADMIN, { ...HAT, slot: 'wings' })).toContain('INVALID_SLOT')
    expect(await saveFails(db, ADMIN, { ...HAT, rarity: 'mythic' })).toContain('INVALID_RARITY')
    expect(await saveFails(db, ADMIN, { ...HAT, price_xu: -1 })).toContain('INVALID_PRICE')
    expect(await saveFails(db, ADMIN, { ...HAT, unlock_level: 9 })).toContain('INVALID_LEVEL')
    expect(await saveFails(db, ADMIN, { ...HAT, layer_urls: {} })).toContain('LAYER_REQUIRED')
    expect(await saveFails(db, ADMIN, { ...HAT, layer_urls: { male: 'javascript:alert(1).png' } })).toContain('INVALID_LAYER')
    expect(await saveFails(db, ADMIN, { ...HAT, layer_urls: { male: 'https://x.vn/a.jpg' } })).toContain('INVALID_LAYER')
    expect(await saveFails(db, ADMIN, { ...HAT, layer_urls: { kid: '/character/a.png' } })).toContain('INVALID_LAYER')
    expect(await saveFails(db, ADMIN, { code: 'top_bad', name: 'Áo lỗi', slot: 'top', color: 'red' })).toContain('INVALID_COLOR')
  })

  it('ngừng bán: người đã mua vẫn giữ; không ngừng bán bản nguyên bản; món có chủ không đổi sang ô khác', async () => {
    await db.query(`insert into public.user_inventory (user_id, item_id, acquired_reason)
      select $1, id, 'PURCHASE' from public.avatar_items where code = 'hat_cap_red'`, [U])
    await rpc(db, U, `select public.save_character('{}'::jsonb, '{"hat": "hat_cap_red"}'::jsonb)`)
    expect(await saveFails(db, ADMIN, { ...HAT, slot: 'glasses' })).toContain('SLOT_LOCKED')
    await rpc(db, ADMIN, `select public.admin_set_avatar_item_active('hat_cap_red', false)`)
    const s = (await rpc<{ s: { items: Item[]; equipped: Record<string, string> } }>(db, U, `select public.character_state() as s`))[0].s
    expect(s.items.find((i) => i.code === 'hat_cap_red')).toBeUndefined()
    expect(s.equipped.hat).toBeUndefined()                  // món ngừng bán tự gỡ khỏi người
    expect((await db.query(`select count(*)::int c from public.user_inventory where user_id = $1
      and item_id = (select id from public.avatar_items where code = 'hat_cap_red')`, [U])).rows[0]).toEqual({ c: 1 })
    expect(await fails(db, ADMIN, `select public.admin_set_avatar_item_active('top_original', false)`)).toContain('ITEM_REQUIRED')
    expect(await fails(db, ADMIN, `select public.admin_set_avatar_item_active('khong_co', true)`)).toContain('ITEM_NOT_FOUND')
  })

  it('kho ảnh lớp: bucket công khai chỉ nhận PNG, chỉ admin được ghi', async () => {
    const b = await db.query(`select public, allowed_mime_types from storage.buckets where id = 'character-layers'`)
    expect(b.rows).toEqual([{ public: true, allowed_mime_types: ['image/png'] }])
    const pol = await db.query<{ policyname: string }>(`select policyname from pg_policies where tablename = 'objects' and policyname like 'character_layers_%' order by 1`)
    expect(pol.rows.map((r) => r.policyname)).toEqual(['character_layers_delete', 'character_layers_insert', 'character_layers_update'])
  })
})
