import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 005800: Outfit Studio — vòng đời, bộ sưu tập, điều kiện mở khóa, giới hạn số lượng, vùng in, đồng phục CLB
const id = (n: number) => `00000000-0000-0000-0000-0000000058${String(n).padStart(2, '0')}`
const [ADM, CAP, MEM, OUT] = [1, 2, 3, 4].map(id)
const CLUB = '00000000-0000-0000-0000-0000000058c1'
const CH = '00000000-0000-0000-0000-0000000058d1'

async function seed(db: PGlite) {
  const users = [ADM, CAP, MEM, OUT]
  await db.exec(`
    insert into auth.users (id, email) values ${users.map((u, i) => `('${u}', 'o${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${users.map((u, i) => `('${u}', 'O${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'NBNR', '${CAP}', 'nbnr58');
  `)
}
type Row = Record<string, any>
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const saveItem = (db: PGlite, p: object) => rpc<Row>(db, ADM, `select public.admin_save_avatar_item($1::jsonb) as r`, [JSON.stringify(p)])
const state = (db: PGlite, uid: string) => rpc<Row>(db, uid, `select public.character_state() as r`)
const item = async (db: PGlite, uid: string, code: string) => ((await state(db, uid)).items as Row[]).find((i) => i.code === code)
let seq = 0
const buy = (db: PGlite, uid: string, code: string) => rpc<Row>(db, uid, `select public.buy_avatar_item($1, $2) as r`, [code, `test-buy-${++seq}-xxxx`])
const give = (db: PGlite, uid: string, amount: number) => db.query(`select private.ledger_post('TEST_SEED', 'seed58:' || $1, 'seed', null,
  jsonb_build_array(jsonb_build_object('account_id', $1::uuid, 'coin_kind', 'BONUS', 'amount', $2::numeric),
                    jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -$2::numeric)))`, [uid, amount])

describe('Outfit Studio (005800)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADM])
    await db.exec(`
      insert into public.club_members (club_id, user_id, role, status) values
        ('${CLUB}', '${CAP}', 'OWNER', 'APPROVED'), ('${CLUB}', '${MEM}', 'MEMBER', 'APPROVED') on conflict do nothing;
      insert into public.challenges (id, title, start_date, end_date, target_value, target_km, min_km, status, created_by, target_audience)
        values ('${CH}', 'Tết Run', now() - interval '3 days', now() + interval '3 days', 10, 10, 1, 'ACTIVE', '${ADM}', 'PUBLIC');
      insert into public.challenge_participants (challenge_id, profile_id, status, completed_at) values ('${CH}', '${MEM}', 'JOINED', now());
    `)
    for (const u of [MEM, OUT]) await give(db, u, 1000)
  }, 240_000)

  it('vòng đời: Nháp không ai thấy; Đang bán thấy; Ngừng bán chỉ người đã có thấy & vẫn mặc', async () => {
    await saveItem(db, { code: 'top_sunset', name: 'Áo Hoàng hôn', slot: 'top', render_kind: 'TINT', color: '#f97316', price_xu: 50, status: 'DRAFT' })
    expect(await item(db, OUT, 'top_sunset')).toBeUndefined()
    await rpc(db, ADM, `select public.admin_set_avatar_item_status('top_sunset', 'PUBLISHED') as r`)
    expect(await item(db, OUT, 'top_sunset')).toMatchObject({ lock: null, status: 'PUBLISHED' })
    await buy(db, MEM, 'top_sunset')
    await rpc(db, MEM, `select public.save_character('{}'::jsonb, '{"top":"top_sunset"}'::jsonb) as r`)
    await rpc(db, ADM, `select public.admin_set_avatar_item_status('top_sunset', 'ARCHIVED') as r`)
    expect(await item(db, OUT, 'top_sunset')).toBeUndefined()                         // không bán nữa
    expect(await fails(buy(db, OUT, 'top_sunset'))).toContain('NOT_FOR_SALE')
    expect((await state(db, MEM)).equipped.top).toBe('top_sunset')                     // người đã có vẫn mặc
    expect(typeof (await state(db, MEM)).display_name).toBe('string')                  // tên in lên áo (vùng tên runner)
    expect(await fails(rpc(db, ADM, `select public.admin_set_avatar_item_status('top_sunset', 'DRAFT') as r`))).toContain('ITEM_HAS_OWNERS')
  })

  it('điều kiện: cấp, huy hiệu, thử thách, khung thời gian, giới hạn số lượng; món 0 Xu có điều kiện tự phát', async () => {
    await rpc(db, ADM, `select public.admin_save_avatar_collection('{"code":"tet_2027","name":"Tết 2027","kind":"EVENT"}'::jsonb) as r`)
    await saveItem(db, { code: 'hat_tet', name: 'Mũ Tết', slot: 'hat', render_kind: 'LAYER', layer_urls: { male: '/character/layers/x.png' },
      price_xu: 0, required_challenge: CH, collection: 'tet_2027' })
    expect((await item(db, MEM, 'hat_tet'))?.owned).toBe(true)                        // hoàn thành thử thách → tự nhận
    expect(await item(db, OUT, 'hat_tet')).toMatchObject({ owned: false, lock: 'CHALLENGE', collection: { code: 'tet_2027' } })
    expect((await state(db, OUT)).collections.map((c: Row) => c.code)).toContain('tet_2027')

    await saveItem(db, { code: 'hat_honor', name: 'Mũ Vinh danh', slot: 'hat', render_kind: 'LAYER', layer_urls: { male: '/character/layers/y.png' },
      price_xu: 20, required_badge: 'HONORED' })
    expect(await fails(buy(db, OUT, 'hat_honor'))).toContain('BADGE_REQUIRED')
    expect(await fails(saveItem(db, { code: 'hat_bad', name: 'Mũ', slot: 'hat', render_kind: 'LAYER', layer_urls: { male: '/character/layers/y.png' }, required_badge: 'KHONGCO' }))).toContain('BADGE_NOT_FOUND')

    await saveItem(db, { code: 'hat_limited', name: 'Mũ 2 chiếc', slot: 'hat', render_kind: 'LAYER', layer_urls: { male: '/character/layers/z.png' },
      price_xu: 10, supply_limit: 1, available_to: new Date(Date.now() + 86_400_000).toISOString() })
    expect(await item(db, OUT, 'hat_limited')).toMatchObject({ left: 1, lock: null })
    await buy(db, OUT, 'hat_limited')
    expect(await fails(buy(db, MEM, 'hat_limited'))).toContain('SOLD_OUT')
    await saveItem(db, { code: 'hat_later', name: 'Mũ sắp bán', slot: 'hat', render_kind: 'LAYER', layer_urls: { male: '/character/layers/w.png' },
      price_xu: 10, available_from: new Date(Date.now() + 86_400_000).toISOString() })
    expect(await fails(buy(db, OUT, 'hat_later'))).toContain('NOT_YET_AVAILABLE')
    expect(await fails(saveItem(db, { code: 'top_lv9', name: 'Áo', slot: 'top', render_kind: 'TINT', color: '#000000', unlock_level: 9 }))).toContain('INVALID_LEVEL')
  })

  it('đồng phục CLB: BQT gửi yêu cầu → admin duyệt + đặt giá → chỉ thành viên thấy / mua / mặc; rời CLB tự tháo', async () => {
    const print = { title: 'NBNR', subtitle: 'No Beer No Run', personal: 'NAME', text_color: '#ffffff' }
    expect(await fails(rpc(db, MEM, `select public.request_club_uniform($1, $2::jsonb) as r`, [CLUB, JSON.stringify({ name: 'Áo NBNR', color: '#facc15', print })]))).toContain('FORBIDDEN')
    expect(await fails(rpc(db, CAP, `select public.request_club_uniform($1, $2::jsonb) as r`, [CLUB,
      JSON.stringify({ name: 'Áo NBNR', color: '#facc15', print: { ...print, logo_url: 'https://evil.example/logo.png' } })]))).toContain('INVALID_PRINT')
    const req = await rpc<Row>(db, CAP, `select public.request_club_uniform($1, $2::jsonb) as r`, [CLUB, JSON.stringify({ name: 'Áo NBNR 2027', color: '#facc15', print })])
    expect(req).toMatchObject({ status: 'PENDING', club_name: 'NBNR', print: { title: 'NBNR', personal: 'NAME' } })
    expect((await rpc<Row[]>(db, ADM, `select public.admin_list_uniform_requests('PENDING') as r`)).map((x) => x.id)).toEqual([req.id])

    const done = await rpc<Row>(db, ADM, `select public.admin_review_uniform_request($1, 'APPROVE', '{"price_xu": 30}'::jsonb) as r`, [req.id])
    expect(done).toMatchObject({ status: 'APPROVED', item: { club_id: CLUB, price_xu: 30, print: { title: 'NBNR' }, color: '#facc15' } })
    const code = done.item_code
    expect((await db.query(`select 1 from public.notifications where kind = 'CLUB_UNIFORM'`)).rows.length).toBe(2)   // cả 2 thành viên
    expect(await item(db, OUT, code)).toBeUndefined()                                   // người ngoài không thấy
    expect(await fails(buy(db, OUT, code))).toContain('CLUB_ONLY')
    expect(await item(db, MEM, code)).toMatchObject({ club_name: 'NBNR', lock: null })
    await buy(db, MEM, code)
    await rpc(db, MEM, `select public.save_character('{}'::jsonb, $1::jsonb) as r`, [JSON.stringify({ top: code })])
    expect((await state(db, MEM)).equipped.top).toBe(code)
    // rời CLB → tự tháo, không mặc lại được
    await db.query(`delete from public.club_members where club_id = $1 and user_id = $2`, [CLUB, MEM])
    expect((await state(db, MEM)).equipped.top).toBe('top_original')
    expect(await fails(rpc(db, MEM, `select public.save_character('{}'::jsonb, $1::jsonb) as r`, [JSON.stringify({ top: code })]))).toContain('CLUB_ONLY')
  })

  it('từ chối cần lý do; đồng phục miễn phí tự phát cho thành viên', async () => {
    const r = await rpc<Row>(db, CAP, `select public.request_club_uniform($1, $2::jsonb) as r`, [CLUB, JSON.stringify({ name: 'Áo tập', color: '#111827', print: { title: 'NBNR' } })])
    expect(await fails(rpc(db, ADM, `select public.admin_review_uniform_request($1, 'REJECT', '{}'::jsonb) as r`, [r.id]))).toContain('REASON_REQUIRED')
    const r2 = await rpc<Row>(db, CAP, `select public.request_club_uniform($1, $2::jsonb) as r`, [CLUB, JSON.stringify({ name: 'Áo free', color: '#16a34a', print: { title: 'NBNR' } })])
    const ok = await rpc<Row>(db, ADM, `select public.admin_review_uniform_request($1, 'APPROVE', '{"price_xu": 0}'::jsonb) as r`, [r2.id])
    expect((await item(db, CAP, ok.item_code))?.owned).toBe(true)
  })
})
