import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 012800: Quanh đây v2 (khu hay chạy tự động, bảng tin quanh đây) + Hội quán runner
const id = (n: number) => `00000000-0000-0000-0000-0000000128${String(n).padStart(2, '0')}`
const [A, B, C, D, E, ADM] = [1, 2, 3, 4, 5, 6].map(id)

async function seed(db: PGlite) {
  const users = [A, B, C, D, E, ADM]
  const names = ['Nguyễn Văn An', 'Trần Thị Bình', 'Lê Minh Châu', 'Phạm Dũng', 'Hoàng Em', 'Admin']
  await db.exec(`
    insert into auth.users (id, email) values ${users.map((u, i) => `('${u}', 'h${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${users.map((u, i) => `('${u}', '${names[i]}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
  `)
}
type Row = Record<string, any>
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const setD = (db: PGlite, u: string, p: object) => rpc<Row>(db, u, `select public.set_discovery($1::jsonb) as r`, [JSON.stringify(p)])
const post = (db: PGlite, u: string, p: object) => rpc<Row>(db, u, `select public.create_hub_post($1::jsonb) as r`, [JSON.stringify(p)])
/** n bài hợp lệ, xuất phát quanh (lat, lng), dài km, pace giây/km */
const runs = async (db: PGlite, u: string, n: number, lat: number | null, lng: number | null, km = 5, pace = 360, extra = 0) => {
  for (let k = 0; k < n; k++) {
    const r = await db.query<{ id: string }>(`
      insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
      values ($1, 'Chạy', 'DIRECT_GPS', now() - make_interval(days => $2::int), now() - make_interval(days => $2::int) + interval '1 hour', $3::int, $3::int, $4::int, $5::int, 'APPROVED', 'READY')
      returning id`, [u, k + 1 + extra, Math.round(km * 1000), Math.round(km * pace), pace])
    if (lat != null) await db.query(`insert into public.activity_details (activity_id, start_lat, start_lng) values ($1, $2, $3)`, [r.rows[0].id, lat + k * 0.001, lng! + k * 0.001])
  }
}

describe('Quanh đây v2 + Hội quán (012800)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADM])
    await runs(db, A, 3, 21.061, 105.821, 5, 360)                    // khu Tây Hồ
    await runs(db, B, 3, 21.051, 105.841, 10, 370)
    await runs(db, C, 3, 21.071, 105.811, 21.1, 330)                 // có bài ≥ HM
    await runs(db, E, 2, 21.061, 105.821, 5, 480); await runs(db, E, 1, 10.77, 106.70, 5, 480, 5)
    await runs(db, D, 1, 21.06, 105.82)                              // chưa đủ 3 bài
  }, 240_000)

  it('khu hay chạy: cần đồng ý riêng; ô ~2 km từ điểm xuất phát (≥ 2 bài); tắt là xoá ngay', async () => {
    expect(await fails(setD(db, A, { enabled: true, consent: true, auto_area: true }))).toContain('CONSENT_REQUIRED')
    const me = await setD(db, A, { enabled: true, consent: true, auto_area: true, auto_consent: true, goals: ['10K'], time_slots: ['EARLY'] })
    expect(me).toMatchObject({ enabled: true, auto_area: true, located: true, presence: null, home: { runs: 3 } })
    const h = (await db.query<Row>(`select cell_lat::float8 as la, cell_lng::float8 as ln from public.runner_home_area where user_id = $1`, [A])).rows[0]
    expect(h).toEqual({ la: 21.06, ln: 105.82 })                                     // làm tròn 0,02°
    expect(await fails(rpc(db, A, `select * from public.runner_home_area`))).toMatch(/permission|denied/i)

    // E: 2 bài cùng khu + 1 bài ở TP.HCM → khu vẫn là Tây Hồ
    await setD(db, E, { enabled: true, consent: true, auto_area: true, auto_consent: true })
    expect((await db.query<Row>(`select cell_lat::float8 as la, runs from public.runner_home_area where user_id = $1`, [E])).rows[0]).toEqual({ la: 21.06, runs: 2 })
    await setD(db, E, { auto_area: false })
    expect((await db.query(`select 1 from public.runner_home_area where user_id = $1`, [E])).rows).toHaveLength(0)
    expect((await setD(db, E, {})).located).toBe(false)
  })

  it('tìm runner không cần mở app: người chỉ có khu hay chạy vẫn tìm thấy và được tìm thấy; không lộ toạ độ', async () => {
    await setD(db, B, { enabled: true, consent: true, goals: ['10K'], time_slots: ['EARLY'] })
    await rpc(db, B, `select public.set_presence(21.05, 105.84, 'DEVICE', 'Hồ Tây', 168) as r`)
    await setD(db, C, { enabled: true, consent: true, auto_area: true, auto_consent: true })
    const r = await rpc<Row>(db, A, `select public.nearby_runners('{"radius_km": 10}'::jsonb) as r`)
    expect(r.my_kind).toBe('HOME')
    expect(Object.fromEntries((r.items as Row[]).map((x) => [x.id, x.where]))).toEqual({ [B]: 'LIVE', [C]: 'HOME' })
    expect(r.items.find((x: Row) => x.id === B)).toMatchObject({ name: 'Bình T.', last_run_days: 1 })
    expect(r.items.find((x: Row) => x.id === B).reasons).toEqual(expect.arrayContaining(['PACE', 'SLOT', 'GOAL', 'ACTIVE']))
    expect(JSON.stringify(r)).not.toMatch(/cell_|lat|lng/)
    // B (vị trí tạm) cũng thấy A (khu hay chạy)
    expect((await rpc<Row>(db, B, `select public.nearby_runners('{}'::jsonb) as r`)).items.map((x: Row) => x.id)).toEqual(expect.arrayContaining([A, C]))
  })

  it('bảng tin quanh đây: bài chạy đã chia sẻ (chỉ ngày, không tuyến), tối đa 2 bài / người', async () => {
    await db.query(`update public.activities set shared = false where user_id = $1 and started_at < now() - interval '2 days'`, [B])
    const f = await rpc<Row>(db, A, `select public.nearby_feed('{}'::jsonb) as r`)
    const runsOf = (u: string) => (f.items as Row[]).filter((x) => x.type === 'RUN' && x.user.id === u)
    expect(runsOf(B)).toHaveLength(1)                                                // 2 bài bị ẩn chia sẻ
    expect(runsOf(C)).toHaveLength(2)                                                // giới hạn 2 bài / người
    expect(runsOf(B)[0]).toMatchObject({ distance_m: 10000, where: 'LIVE', user: { name: 'Bình T.' } })
    expect(JSON.stringify(f)).not.toMatch(/polyline|start_lat|cell_/)
    expect(await fails(rpc(db, D, `select public.nearby_feed('{}'::jsonb) as r`))).toContain('NEARBY_DISABLED')
  })

  it('Hội quán: tham gia cần đồng ý + ≥ 3 bài; danh bạ có thành tích ước tính, số liệu chỉ từ bài đã chia sẻ; lọc tỉnh / tên', async () => {
    expect(await fails(setD(db, B, { hub_listed: true }))).toContain('CONSENT_REQUIRED')
    expect(await fails(setD(db, D, { hub_listed: true, hub_consent: true }))).toContain('NOT_ELIGIBLE')
    expect(await fails(setD(db, B, { hub_listed: true, hub_consent: true, province: 'Sài Gòn' }))).toContain('INVALID_SETTINGS')
    expect(await fails(setD(db, B, { hub_listed: true, hub_consent: true, headline: 'Zalo 0905 123 456' }))).toContain('NO_LINKS')
    await setD(db, B, { hub_listed: true, hub_consent: true, province: 'Hà Nội', headline: 'Tập HM sub 2' })
    await setD(db, C, { hub_listed: true, hub_consent: true, province: 'TP. Hồ Chí Minh', goals: ['HM'] })
    await setD(db, A, { hub_listed: true, hub_consent: true, province: 'Hà Nội' })

    const all = await rpc<Row>(db, A, `select public.hub_runners('{}'::jsonb) as r`)
    expect(all.items.map((x: Row) => x.id)).toEqual([B, C])                          // B cùng tỉnh, cùng mục tiêu, cùng pace → đứng đầu
    const b = all.items[0]
    expect(b).toMatchObject({ name: 'Trần Thị Bình', province: 'Hà Nội', headline: 'Tập HM sub 2', connection: 'NONE', following: false })
    expect(b.reasons).toEqual(expect.arrayContaining(['PROVINCE', 'PACE']))
    expect(b.stats).toMatchObject({ runs_30d: 1, km_30d: 10 })                       // 2 bài không chia sẻ không tính
    expect(b.prs).toEqual({ '5K': 1850, '10K': 3700 })
    expect(all.items[1].prs).toMatchObject({ HM: 6962 })                             // 21,1 km @ 5:30 quy về 21,097 km
    expect((await rpc<Row>(db, A, `select public.hub_runners('{"province": "TP. Hồ Chí Minh"}'::jsonb) as r`)).items.map((x: Row) => x.id)).toEqual([C])
    expect((await rpc<Row>(db, A, `select public.hub_runners('{"q": "binh"}'::jsonb) as r`)).items.map((x: Row) => x.id)).toEqual([B])
    expect((await rpc<Row>(db, E, `select public.hub_runners('{}'::jsonb) as r`)).total).toBe(3)   // xem không cần tham gia
    expect(await rpc<Row>(db, A, `select public.my_hub() as r`)).toMatchObject({ listed: true, province: 'Hà Nội', prs: { '5K': 1800 } })
    // Kết nối được từ Hội quán dù người kia không bật Quanh đây
    await setD(db, C, { enabled: false })
    expect(await rpc<Row>(db, A, `select public.send_connection($1, 'Đi giải HM cùng nhé') as r`, [C])).toMatchObject({ status: 'PENDING' })
  })

  it('bài đăng: không link / số điện thoại, giải phải có tên, ≤ 5 bài / ngày; bài "gần tôi" báo runner quanh đó', async () => {
    expect(await fails(post(db, E, { kind: 'BUDDY', body: 'Ai chạy sáng mai không?' }))).toContain('HUB_NOT_JOINED')
    expect(await fails(post(db, A, { kind: 'BUDDY', body: 'Gọi mình 0905.123.456 nhé' }))).toContain('NO_LINKS')
    expect(await fails(post(db, A, { kind: 'RACE', body: 'Ai đi giải cùng không?' }))).toContain('RACE_NAME_REQUIRED')
    const p1 = await post(db, A, { kind: 'BUDDY', body: 'Sáng thứ 7 chạy 10K Hồ Tây pace 6:00, ai đi cùng?', near: true, pace_s: 360 })
    expect(p1).toMatchObject({ kind: 'BUDDY', near: true, province: 'Hà Nội', is_mine: true, author: { name: 'Nguyễn Văn An' } })
    expect(JSON.stringify(p1)).not.toMatch(/cell_|lat|lng/)
    // B bật Quanh đây, ở gần → nhận thông báo; C đã tắt Quanh đây → không
    const notif = async (u: string) => (await db.query(`select 1 from public.notifications where user_id = $1 and kind = 'HUB_NEARBY'`, [u])).rows.length
    expect(await notif(B)).toBe(1)
    expect(await notif(C)).toBe(0)
    await post(db, A, { kind: 'RACE', body: 'Ai đăng ký VnExpress Marathon Hà Nội?', race_name: 'VM Hà Nội 2026', goal: 'HM' })
    await post(db, A, { kind: 'ASK', body: 'Giày nào êm cho chạy dài?' })
    await post(db, A, { kind: 'SHARE', body: 'Vừa chạy xong 5K đầu tiên dưới 30 phút' })
    await post(db, A, { kind: 'PACER', body: 'Cần pacer 2:00 cho HM tháng sau' })
    expect(await fails(post(db, A, { kind: 'ASK', body: 'Bài thứ 6 trong ngày' }))).toContain('TOO_MANY_POSTS')

    const feed = await rpc<Row>(db, B, `select public.hub_feed('{}'::jsonb) as r`)
    expect(feed.total).toBe(5)
    expect((await rpc<Row>(db, B, `select public.hub_feed('{"kind": "RACE"}'::jsonb) as r`)).items[0]).toMatchObject({ race_name: 'VM Hà Nội 2026' })
    const near = await rpc<Row>(db, B, `select public.hub_feed('{"scope": "NEAR"}'::jsonb) as r`)
    expect(near.items.map((x: Row) => x.id)).toEqual([p1.id])
    expect((await rpc<Row>(db, B, `select public.hub_feed($1::jsonb) as r`, [JSON.stringify({ id: p1.id })])).items.map((x: Row) => x.id)).toEqual([p1.id])
    expect(Number.isInteger(near.items[0].km)).toBe(true)
    expect((await rpc<Row>(db, B, `select public.nearby_feed('{}'::jsonb) as r`)).items.some((x: Row) => x.type === 'POST' && x.id === p1.id)).toBe(true)
  })

  it('"Quan tâm" → báo người đăng, hai bên nhắn tin được; 3 báo cáo → bài tự ẩn, admin hiện lại; rời Hội quán đóng bài', async () => {
    const p1 = (await rpc<Row>(db, A, `select public.hub_feed('{"kind": "BUDDY"}'::jsonb) as r`)).items[0]
    expect(await fails(rpc(db, E, `select public.send_direct_message($1, 'Chào bạn') as r`, [A]))).not.toBe('OK')
    expect(await rpc<Row>(db, E, `select public.toggle_hub_interest($1) as r`, [p1.id])).toMatchObject({ interested: true, interest_count: 1 })
    expect((await db.query(`select 1 from public.notifications where user_id = $1 and kind = 'HUB_INTEREST'`, [A])).rows).toHaveLength(1)
    expect((await rpc<Row[]>(db, A, `select public.hub_interested($1) as r`, [p1.id])).map((x) => x.id)).toEqual([E])
    expect(await fails(rpc(db, B, `select public.hub_interested($1) as r`, [p1.id]))).toContain('POST_NOT_FOUND')
    expect(await fails(rpc(db, E, `select public.send_direct_message($1, 'Mình đi cùng nhé') as r`, [A]))).toBe('OK')
    expect(await fails(rpc(db, A, `select public.send_direct_message($1, 'Ok hẹn 5h nhé') as r`, [E]))).toBe('OK')
    expect(await rpc<Row>(db, E, `select public.toggle_hub_interest($1) as r`, [p1.id])).toMatchObject({ interested: false, interest_count: 0 })

    const p2 = (await rpc<Row>(db, A, `select public.hub_feed('{"kind": "ASK"}'::jsonb) as r`)).items[0]
    for (const u of [B, C, E]) await rpc(db, u, `select public.report_hub_post($1, 'SPAM')`, [p2.id])
    expect((await rpc<Row>(db, B, `select public.hub_feed('{}'::jsonb) as r`)).total).toBe(4)
    expect((await rpc<Row>(db, A, `select public.hub_feed('{"scope": "MINE"}'::jsonb) as r`)).items.find((x: Row) => x.id === p2.id).status).toBe('HIDDEN')
    expect(await fails(rpc(db, A, `select public.admin_set_hub_post($1, false)`, [p2.id]))).not.toBe('OK')
    await rpc(db, ADM, `select public.admin_set_hub_post($1, false)`, [p2.id])
    expect((await rpc<Row>(db, B, `select public.hub_feed('{}'::jsonb) as r`)).total).toBe(5)

    await rpc(db, B, `select public.block_user($1)`, [A])
    expect((await rpc<Row>(db, B, `select public.hub_feed('{}'::jsonb) as r`)).total).toBe(0)
    expect((await rpc<Row>(db, B, `select public.hub_runners('{}'::jsonb) as r`)).items.map((x: Row) => x.id)).not.toContain(A)
    await setD(db, A, { hub_listed: false })
    expect((await db.query(`select 1 from public.hub_posts where author_id = $1 and status = 'ACTIVE'`, [A])).rows).toHaveLength(0)
    expect(await fails(rpc(db, A, `select * from public.hub_posts`))).toMatch(/permission|denied/i)
  })

  it('thông tin công ty có khoá link nhóm Facebook', async () => {
    expect((await db.query<Row>(`select 'support_facebook' = any (private.site_info_keys()) as ok`)).rows[0].ok).toBe(true)
  })
})
