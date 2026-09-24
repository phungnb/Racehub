import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 002700: giải chạy ảo
const id = (n: number) => `00000000-0000-0000-0000-0000000007${String(n).padStart(2, '0')}`
const [ORG, R1, R2, R3, OUT] = [1, 2, 3, 4, 5].map(id)
const CLUB = '00000000-0000-0000-0000-0000000007c1'

async function seed(db: PGlite) {
  const users = [ORG, R1, R2, R3, OUT]
  await db.exec(`
    insert into auth.users (id, email) values ${users.map((u, i) => `('${u}', 'vr${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${users.map((u, i) => `('${u}', 'VĐV ${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'NBNR', '${ORG}', 'vr0001');
    insert into public.club_members (club_id, user_id, role, status) values
      ('${CLUB}', '${ORG}', 'OWNER', 'APPROVED'), ('${CLUB}', '${R1}', 'MEMBER', 'APPROVED'), ('${CLUB}', '${R2}', 'MEMBER', 'APPROVED'),
      ('${CLUB}', '${R3}', 'MEMBER', 'APPROVED') on conflict do nothing;
  `)
}

type Detail = { id: string; registered: number; finished: number; can_manage: boolean
  me: { bib: string; distance_km: number; status: string; finish_time_s: number | null; rank: number | null } | null }
const rpc = async <T,>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0].r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
let h = 20
const run = (db: PGlite, uid: string, km: number, paceS: number, status = 'APPROVED') => db.query<{ id: string }>(`
  insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
  values ($1, 'Chạy', 'DIRECT_GPS', now() - make_interval(hours => $4), now() - make_interval(hours => $4) + interval '1 hour', $2::numeric, $2::numeric, $3::int, $5::int, $6, 'READY')
  returning id`, [uid, km * 1000, Math.round(km * paceS), (h -= 1), paceS, status])

describe('giải chạy ảo (002700)', () => {
  let db: PGlite
  let race = ''
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`insert into public.race_organizer_grants (owner_type, owner_id) values ('CLUB', $1) on conflict do nothing`, [CLUB])   // 003800: CLB được admin cấp quyền tổ chức
  }, 240_000)

  it('chỉ ban quản trị CLB / admin tạo giải; kiểm tra dữ liệu', async () => {
    const p = { title: 'NBNR Virtual Run 2026', club_id: CLUB, audience: 'CLUB_ONLY', distances: [21.1, 5, 10, 10], bib_prefix: 'nbnr',
      start_at: new Date(Date.now() + 3600_000).toISOString(), end_at: new Date(Date.now() + 10 * 86400_000).toISOString(), max_participants: 3 }
    const q = `select public.create_virtual_race($1::jsonb) as r`
    expect(await fails(rpc(db, R1, q, [JSON.stringify(p)]))).toContain('FORBIDDEN')
    expect(await fails(rpc(db, ORG, q, [JSON.stringify({ ...p, distances: [0.5] })]))).toContain('INVALID_DISTANCES')
    race = await rpc<string>(db, ORG, q, [JSON.stringify(p)])
    const d = await rpc<Detail & { distances: number[] }>(db, ORG, `select public.race_detail($1) as r`, [race])
    expect(d).toMatchObject({ can_manage: true, distances: [5, 10, 21.1] })
    // giải nội bộ: người ngoài CLB không thấy
    expect(await fails(rpc(db, OUT, `select public.race_detail($1) as r`, [race]))).toContain('RACE_NOT_FOUND')
  })

  it('đăng ký nhận BIB tuần tự; sai cự ly / hết chỗ bị từ chối; rút tên trước giờ chạy', async () => {
    const reg = (u: string, km: number) => rpc<Detail>(db, u, `select public.register_race($1, $2) as r`, [race, km])
    expect(await fails(reg(R1, 7))).toContain('INVALID_DISTANCE')
    expect((await reg(R1, 10)).me).toMatchObject({ bib: 'NBNR-0001', distance_km: 10, status: 'REGISTERED' })
    expect((await reg(R2, 10)).me?.bib).toBe('NBNR-0002')
    expect((await reg(R3, 5)).me?.bib).toBe('NBNR-0003')
    expect(await fails(reg(ORG, 5))).toContain('RACE_FULL')
    expect((await reg(R1, 21.1)).me).toMatchObject({ bib: 'NBNR-0001', distance_km: 21.1 })   // đổi cự ly giữ BIB
    await rpc(db, R1, `select public.register_race($1, 10) as r`, [race])
  })

  it('bài hợp lệ ≥ cự ly trong thời gian giải → hoàn thành, thời gian quy đổi, xếp hạng; bài bị từ chối thì mất kết quả', async () => {
    await db.query(`update public.virtual_races set start_at = now() - interval '1 day' where id = $1`, [race])
    await run(db, R1, 9.5, 300)                          // ngắn hơn 10 km → không tính
    await run(db, R1, 12, 330)                           // 10 km quy đổi: 3300 s
    const fast = (await run(db, R2, 10, 300)).rows[0].id  // 3000 s
    await run(db, R3, 5, 400, 'PENDING')                 // chưa duyệt → chưa tính
    const d1 = await rpc<Detail>(db, R1, `select public.race_detail($1) as r`, [race])
    expect(d1.me).toMatchObject({ status: 'FINISHED', finish_time_s: 3300, rank: 2 })
    const res = await rpc<{ bib: string; finish_time_s: number; pace_s: number }[]>(db, R3, `select public.race_results($1, 10) as r`, [race])
    expect(res.map((x) => [x.bib, x.finish_time_s, x.pace_s])).toEqual([['NBNR-0002', 3000, 300], ['NBNR-0001', 3300, 330]])
    expect((await rpc<Detail>(db, R3, `select public.race_detail($1) as r`, [race])).me?.status).toBe('REGISTERED')

    await db.query(`update public.activities set validation_status = 'REJECTED', status = 'REJECTED' where id = $1`, [fast])
    expect((await rpc<Detail>(db, R2, `select public.race_detail($1) as r`, [race])).me?.status).toBe('REGISTERED')
    expect((await rpc<Detail>(db, R1, `select public.race_detail($1) as r`, [race])).me?.rank).toBe(1)
    expect((await db.query(`select 1 from public.notifications where user_id = $1 and kind = 'RACE_FINISHED'`, [R1])).rows.length).toBe(1)
  })

  it('dashboard BTC: chỉ BTC xem, có đủ VĐV; rút tên sau giờ chạy bị chặn; hủy giải báo VĐV', async () => {
    expect(await fails(rpc(db, R1, `select public.race_dashboard($1) as r`, [race]))).toContain('FORBIDDEN')
    const rows = await rpc<{ bib: string; status: string }[]>(db, ORG, `select public.race_dashboard($1) as r`, [race])
    expect(rows.map((r) => r.bib).sort()).toEqual(['NBNR-0001', 'NBNR-0002', 'NBNR-0003'])
    expect(await fails(rpc(db, R3, `select public.withdraw_race($1) as r`, [race]))).toContain('RACE_STARTED')
    const list = await rpc<{ id: string }[]>(db, R3, `select public.list_races('MINE') as r`)
    expect(list.map((x) => x.id)).toEqual([race])
    await rpc(db, ORG, `select public.cancel_virtual_race($1, 'Mưa bão') as r`, [race])
    expect((await db.query(`select 1 from public.notifications where kind = 'RACE_CANCELLED'`)).rows.length).toBe(3)
  })
})

describe('BIB điện tử do BTC thiết kế (002900)', () => {
  let db: PGlite
  let race = ''
  const url = (rid: string, file = 'logo.png') => `https://x.supabase.co/storage/v1/object/public/race-media/${rid}/${ORG}/${file}`
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`insert into public.race_organizer_grants (owner_type, owner_id) values ('CLUB', $1) on conflict do nothing`, [CLUB])   // 003800: CLB được admin cấp quyền tổ chức
    race = await rpc<string>(db, ORG, `select public.create_virtual_race($1::jsonb) as r`, [JSON.stringify({ title: 'Giải có BIB đẹp', club_id: CLUB,
      distances: [10], bib_prefix: 'NB', max_participants: 5, start_at: new Date(Date.now() + 3600_000).toISOString(), end_at: new Date(Date.now() + 5 * 86400_000).toISOString() })])
  }, 240_000)

  it('BTC lưu thiết kế: làm sạch trường, chặn ảnh ngoài kho của giải, VĐV thấy trong chi tiết giải', async () => {
    const q = `select public.set_race_bib_design($1, $2::jsonb) as r`
    const good = { template: 'stripe', colors: { bg: '#FFFFFF', band: '#1f4fd8', number: '#111111' }, logo_url: url(race), tagline: 'No Beer No Run',
      sponsors: [{ name: 'Nhà tài trợ A' }, { name: '', logo_url: url(race, 'sp1.png') }, { name: '' }], show_qr: true, hack: '<script>' }
    expect(await fails(rpc(db, R1, q, [race, JSON.stringify(good)]))).toContain('FORBIDDEN')
    expect(await fails(rpc(db, ORG, q, [race, JSON.stringify({ ...good, logo_url: 'https://evil.com/a.png' })]))).toContain('INVALID_BIB_IMAGE')
    expect(await fails(rpc(db, ORG, q, [race, JSON.stringify({ ...good, logo_url: url('00000000-0000-0000-0000-000000000000') })]))).toContain('INVALID_BIB_IMAGE')
    expect(await fails(rpc(db, ORG, q, [race, JSON.stringify({ ...good, colors: { bg: 'red' } })]))).toContain('INVALID_BIB_DESIGN')
    const saved = await rpc<Record<string, unknown>>(db, ORG, q, [race, JSON.stringify(good)])
    expect(saved).toMatchObject({ template: 'stripe', colors: { bg: '#ffffff', band: '#1f4fd8', number: '#111111' }, show_name: true, show_qr: true })
    expect(saved).not.toHaveProperty('hack')
    expect((saved.sponsors as unknown[]).length).toBe(2)                 // bỏ nhà tài trợ trống
    const d = await rpc<{ bib_design: { template: string } }>(db, R1, `select public.race_detail($1) as r`, [race])
    expect(d.bib_design.template).toBe('stripe')
  })

  it('003000 + 003200: ảnh BIB có sẵn làm khung + 3 khung chữ tự do, giới hạn giá trị, sai lựa chọn bị từ chối', async () => {
    const q = `select public.set_race_bib_design($1, $2::jsonb) as r`
    const base = { template: 'classic', colors: {}, sponsors: [] }
    const saved = await rpc<Record<string, unknown>>(db, ORG, q, [race, JSON.stringify({ ...base, art_url: url(race, 'bib.png'), use_art: true,
      art_fit: { zoom: 9, x: -0.25, y: 'lạ' }, show_header: false, qr_pos: 'corner', org_text: '  BTC Hồ Tây  ',
      boxes: { number: { x: 2, y: 0.4, align: 'left', font: 'impact', outline: true, size: 9, color: 'accent', hack: 1 }, name: { show: false } } })])
    expect(saved).toMatchObject({ use_art: true, show_header: false, show_sponsors: true, qr_pos: 'corner', art_fit: { zoom: 3, x: -0.25, y: 0 },
      org_text: 'BTC Hồ Tây', show_name: false,
      boxes: {
        number: { show: true, x: 1, y: 0.4, align: 'left', font: 'impact', italic: false, outline: true, size: 2.5, color: 'accent' },
        name: { show: false, font: 'sans', color: 'text' },
        org: { show: true, x: 0.42, y: 0.3, align: 'center', font: 'sans', size: 1 },
      } })
    expect((saved.boxes as Record<string, object>).number).not.toHaveProperty('hack')
    expect(saved).not.toHaveProperty('text')
    const noArt = await rpc<Record<string, unknown>>(db, ORG, q, [race, JSON.stringify({ ...base, use_art: true })])
    expect(noArt).toMatchObject({ use_art: false, qr_pos: 'right', boxes: { number: { font: 'mono', color: 'number' } } })
    expect(await fails(rpc(db, ORG, q, [race, JSON.stringify({ ...base, art_url: 'https://evil.com/bib.png' })]))).toContain('INVALID_BIB_IMAGE')
    expect(await fails(rpc(db, ORG, q, [race, JSON.stringify({ ...base, boxes: { number: { font: 'comic' } } })]))).toContain('INVALID_BIB_DESIGN')
    expect(await fails(rpc(db, ORG, q, [race, JSON.stringify({ ...base, boxes: { org: 'x' } })]))).toContain('INVALID_BIB_DESIGN')
    expect(await fails(rpc(db, ORG, q, [race, JSON.stringify({ ...base, qr_pos: 'top' })]))).toContain('INVALID_BIB_DESIGN')
  })

  it('kho ảnh race-media: BTC tải lên được, người ngoài bị chặn; không làm hỏng upload của kho khác', async () => {
    // giống Supabase: storage.objects bật RLS, authenticated có quyền ghi bảng
    await db.exec(`alter table storage.objects enable row level security; grant select, insert on storage.objects to authenticated;`)
    const put = (uid: string, bucket: string, name: string) => asUser(db, uid, '/storage/v1/object', `insert into storage.objects (bucket_id, name) values ($1, $2)`, [bucket, name])
    await put(ORG, 'race-media', `${race}/${ORG}/bib.png`)
    expect(await fails(put(R1, 'race-media', `${race}/${R1}/bib.png`))).toMatch(/row-level security/)
    expect(await fails(put(ORG, 'race-media', `khong-phai-uuid/${ORG}/bib.png`))).toMatch(/row-level security/)   // 003300: không lỗi ép kiểu uuid
    await put(R1, 'avatars', `${R1}/a.png`)                                   // kho khác vẫn tải bình thường
  })

  it('quét QR trên BIB: xác thực VĐV theo số BIB', async () => {
    await rpc(db, R2, `select public.register_race($1, 10) as r`, [race])
    const v = await rpc<{ bib: string; display_name: string; status: string } | null>(db, R3, `select public.race_bib_lookup($1, 'nb-0001') as r`, [race])
    expect(v).toMatchObject({ bib: 'NB-0001', display_name: 'VĐV 2', status: 'REGISTERED' })
    expect(await rpc(db, R3, `select public.race_bib_lookup($1, 'NB-9999') as r`, [race])).toBeNull()
  })
})
