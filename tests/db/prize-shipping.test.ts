import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 015500: thông tin nhận tặng phẩm (thử thách + giải chạy)
const id = (n: number) => `00000000-0000-0000-0000-0000000155${String(n).padStart(2, '0')}`
const [ORG, R1, R2, OUT] = [1, 2, 3, 4].map(id)
const CH = '00000000-0000-0000-0000-0000000155c1'
const RACE = '00000000-0000-0000-0000-0000000155c2'

async function seed(db: PGlite) {
  const users = [ORG, R1, R2, OUT]
  await db.exec(`
    insert into auth.users (id, email) values ${users.map((u, i) => `('${u}', 'pz${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${users.map((u, i) => `('${u}', 'U${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
  `)
}
type Row = Record<string, any>
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const setGift = (db: PGlite, uid: string, scope: string, ref: string, p: object) => rpc<Row>(db, uid, `select public.set_prize_gift($1, $2, $3::jsonb) as r`, [scope, ref, JSON.stringify(p)])
const save = (db: PGlite, uid: string, scope: string, ref: string, p: object) => rpc<Row>(db, uid, `select public.save_prize_address($1, $2, $3::jsonb) as r`, [scope, ref, JSON.stringify(p)])
const get = (db: PGlite, uid: string, scope: string, ref: string) => rpc<Row | null>(db, uid, `select public.prize_gift_get($1, $2) as r`, [scope, ref])
const list = (db: PGlite, uid: string, scope: string, ref: string) => rpc<Row[]>(db, uid, `select public.prize_recipients($1, $2) as r`, [scope, ref])
const addr = { full_name: 'Nguyễn Văn A', phone: '0901 234 567', address: '12 Lê Lợi, Quận 1, TP.HCM', size: 'M', note: 'Giao giờ hành chính' }

describe('tặng phẩm: điền thông tin nhận (015500)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.exec(`
      insert into public.challenges (id, title, start_date, end_date, target_value, target_km, min_km, status, created_by, target_audience)
        values ('${CH}', 'Thử thách quà', now() - interval '1 day', now() + interval '6 days', 50, 50, 1, 'ACTIVE', '${ORG}', 'PUBLIC');
      insert into public.challenge_participants (challenge_id, profile_id, status) values
        ('${CH}', '${ORG}', 'JOINED'), ('${CH}', '${R1}', 'JOINED'), ('${CH}', '${R2}', 'LEFT');
      insert into public.virtual_races (id, organizer_id, title, start_at, end_at, reg_close_at, distances, audience)
        values ('${RACE}', '${ORG}', 'Giải quà', now() - interval '1 day', now() + interval '6 days', now() + interval '5 days', '{5,10}', 'PUBLIC');
      insert into public.race_registrations (race_id, user_id, distance_km, bib) values
        ('${RACE}', '${R1}', 5, 'RH-0001'), ('${RACE}', '${R2}', 10, 'RH-0002');
    `)
  }, 240_000)

  it('chỉ BTC khai báo; cần cỡ áo thì phải có danh sách cỡ; người tham gia được báo', async () => {
    const g = { description: 'Áo + huy chương', needs_size: true, size_options: ['S', 'M', 'L', ' ', 'M'] }
    expect(await fails(setGift(db, R1, 'CHALLENGE', CH, g))).toContain('FORBIDDEN')
    expect(await fails(setGift(db, ORG, 'CHALLENGE', CH, { ...g, size_options: [] }))).toContain('PRIZE_SIZES_EMPTY')
    expect(await setGift(db, ORG, 'CHALLENGE', CH, g)).toEqual({ enabled: true })
    const s = await get(db, R1, 'CHALLENGE', CH)
    expect(s).toMatchObject({ enabled: true, can_manage: false, is_member: true, needs_size: true, size_options: ['S', 'M', 'L'], mine: null })
    const notes = await db.query<{ user_id: string }>(`select user_id from public.notifications where kind = 'PRIZE_INFO'`)
    expect(notes.rows.map((x) => x.user_id)).toEqual([R1])           // không báo BTC, không báo người đã rời
  })

  it('người tham gia điền, sửa; kiểm tra dữ liệu; người ngoài / đã rời bị chặn', async () => {
    expect(await fails(save(db, OUT, 'CHALLENGE', CH, addr))).toContain('FORBIDDEN')
    expect(await fails(save(db, R2, 'CHALLENGE', CH, addr))).toContain('FORBIDDEN')
    expect(await fails(save(db, R1, 'CHALLENGE', CH, { ...addr, phone: '12ab' }))).toContain('PRIZE_PHONE_INVALID')
    expect(await fails(save(db, R1, 'CHALLENGE', CH, { ...addr, address: 'ngắn' }))).toContain('PRIZE_ADDRESS_INVALID')
    expect(await fails(save(db, R1, 'CHALLENGE', CH, { ...addr, size: 'XXL' }))).toContain('PRIZE_SIZE_INVALID')
    const s = await save(db, R1, 'CHALLENGE', CH, addr)
    expect(s?.mine).toMatchObject({ full_name: 'Nguyễn Văn A', phone: '0901234567', size: 'M' })
    await save(db, R1, 'CHALLENGE', CH, { ...addr, address: '99 Nguyễn Huệ, Quận 1, TP.HCM' })
    expect((await get(db, R1, 'CHALLENGE', CH))?.mine.address).toBe('99 Nguyễn Huệ, Quận 1, TP.HCM')
    expect(await get(db, OUT, 'CHALLENGE', CH)).toBeNull()
  })

  it('BTC xem danh sách (cả người chưa điền); người khác không đọc được', async () => {
    expect(await fails(list(db, R1, 'CHALLENGE', CH))).toContain('FORBIDDEN')
    const rows = await list(db, ORG, 'CHALLENGE', CH)
    expect(rows.map((r) => [r.user_id, r.filled])).toEqual([[R1, true], [ORG, false]])
    expect(rows[0]).toMatchObject({ phone: '0901234567', size: 'M' })
    expect((await get(db, ORG, 'CHALLENGE', CH))?.filled_count).toBe(1)
  })

  it('giải chạy: hạn điền, không cần cỡ áo thì bỏ qua cỡ, gỡ khai báo', async () => {
    expect(await fails(save(db, R1, 'RACE', RACE, addr))).toContain('PRIZE_NOT_ENABLED')
    await setGift(db, ORG, 'RACE', RACE, { description: 'Huy chương', needs_size: false, deadline: new Date(Date.now() + 86400_000).toISOString() })
    expect((await save(db, R1, 'RACE', RACE, addr))?.mine.size).toBeNull()
    const rows = await list(db, ORG, 'RACE', RACE)
    expect(rows.map((r) => [r.ref_label, r.filled])).toEqual([['RH-0001 · 5 km', true], ['RH-0002 · 10 km', false]])
    await setGift(db, ORG, 'RACE', RACE, { description: 'Huy chương', deadline: new Date(Date.now() - 1000).toISOString() })
    expect(await fails(save(db, R2, 'RACE', RACE, addr))).toContain('PRIZE_CLOSED')
    expect(await setGift(db, ORG, 'RACE', RACE, { description: '' })).toEqual({ enabled: false })
    expect((await get(db, ORG, 'RACE', RACE))?.enabled).toBe(false)
  })
})
