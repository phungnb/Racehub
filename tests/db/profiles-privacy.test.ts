import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 011900: khách (anon key) không đọc được profiles; người đăng nhập chỉ thấy cột công khai của người khác
const [A, B] = [1, 2].map((n) => `00000000-0000-0000-0000-0000001190${String(n).padStart(2, '0')}`)
type Row = Record<string, any>

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${A}', 'a119@x.vn'), ('${B}', 'b119@x.vn');
    insert into public.profiles (id, display_name) values ('${A}', 'An'), ('${B}', 'Bình') on conflict do nothing;
    update public.profiles set role = 'SYSTEM_ADMIN', xu = 5000, strava_athlete_id = '123' where id = '${B}';
  `)
}
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }

describe('Bảo vệ dữ liệu hồ sơ (011900)', () => {
  let db: PGlite
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 300_000)

  it('khách chưa đăng nhập: không đọc được profiles và các bảng riêng tư', async () => {
    for (const t of ['profiles', 'club_members', 'club_treasury_log', 'profile_settings', 'ledger_entries']) {
      expect(await fails(asUser(db, null, `/rest/v1/${t}`, `select * from public.${t}`))).toMatch(/permission denied/i)
    }
  })

  it('người đăng nhập: chỉ thấy cột công khai của người khác; hồ sơ đầy đủ của mình qua my_account()', async () => {
    const pub = (await asUser<Row>(db, A, '/rest/v1/profiles', `select id, display_name, avatar_url, level from public.profiles where id = $1`, [B])).rows[0]
    expect(pub).toMatchObject({ id: B, display_name: 'Bình' })
    for (const col of ['role', 'xu', 'strava_athlete_id', 'referral_code', 'is_admin']) {
      expect(await fails(asUser(db, A, '/rest/v1/profiles', `select ${col} from public.profiles where id = $1`, [B]))).toMatch(/permission denied/i)
    }
    expect(await fails(asUser(db, B, '/rest/v1/profiles', `select * from public.profiles where id = $1`, [B]))).toMatch(/permission denied/i)
    const me = (await asUser<{ r: Row }>(db, B, '/rpc/my_account', `select public.my_account() as r`)).rows[0].r
    expect(me).toMatchObject({ id: B, role: 'SYSTEM_ADMIN', strava_athlete_id: '123' })
    expect(Number(me.xu)).toBeGreaterThan(0)
    expect(me).not.toHaveProperty('strava_access_token')
    expect((await asUser<{ r: Row | null }>(db, null, '/rpc/my_account', `select 1 as r`)).rows[0].r).toBe(1)
    expect(await fails(asUser(db, null, '/rpc/my_account', `select public.my_account()`))).toMatch(/permission denied/i)
    // Vẫn tự sửa tên / ảnh của mình được
    await asUser(db, A, '/rest/v1/profiles', `update public.profiles set display_name = 'An mới' where id = $1`, [A])
    expect((await db.query<Row>(`select display_name from public.profiles where id = $1`, [A])).rows[0].display_name).toBe('An mới')
  })
})
