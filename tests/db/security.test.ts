import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Kiểm tra trên ĐÚNG schema production (supabase/remote_schema.sql).
// Mỗi lỗ hổng: trước migration phải khai thác được (chứng minh lỗ hổng có thật),
// sau migration phải bị chặn.

const ATTACKER = '00000000-0000-0000-0000-0000000000a1'
const VICTIM = '00000000-0000-0000-0000-0000000000b2'
const ADMIN = '00000000-0000-0000-0000-0000000000ad'
const SYS = '00000000-0000-0000-0000-000000000000'

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values
      ('${ATTACKER}', 'attacker@x.vn'), ('${VICTIM}', 'victim@x.vn'), ('${ADMIN}', 'admin@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, role, strava_access_token, strava_refresh_token,
                                 strava_token_expires_at, strava_athlete_id, strava_connected, created_at)
    values ('${ATTACKER}', 'Attacker', 10, 0, 1, 'MEMBER', null, null, null, null, false, now()),
           ('${VICTIM}', 'Victim', 300, 2400, 5, 'MEMBER', 'victim-token', 'victim-refresh', 1893456000, '777', true, now()),
           ('${ADMIN}', 'Admin', 0, 0, 1, 'SYSTEM_ADMIN', null, null, null, null, false, now());
    insert into public.avatar_items (id, name, category, asset_url) values ('00000000-0000-0000-0000-00000000f00d', 'Giày Vàng', 'shoes', '/x.png');
  `)
}

const xuOf = async (db: PGlite, id: string) =>
  Number((await db.query<{ xu: string }>(`select xu from public.profiles where id = $1`, [id])).rows[0].xu)

describe('TRƯỚC migration — lỗ hổng tồn tại trên production', () => {
  let db: PGlite
  beforeAll(async () => { db = await createDb({ withMigrations: false, seed }) }, 60_000)

  it('khách chưa đăng nhập tự nạp Xu qua user_topup_xu', async () => {
    await asUser(db, null, '/rpc/user_topup_xu',
      `select public.user_topup_xu($1, $2, 1000000, 0, 'fake', 'k1')`, [ATTACKER, ATTACKER])
    expect(await xuOf(db, ATTACKER)).toBe(1000010)
  })

  it('user tự phong admin và tự sửa Xu qua REST /profiles', async () => {
    await asUser(db, ATTACKER, '/profiles', `update public.profiles set role = 'SYSTEM_ADMIN', xu = 5 where id = $1`, [ATTACKER])
    const r = await db.query<{ role: string }>(`select role from public.profiles where id = $1`, [ATTACKER])
    expect(r.rows[0].role).toBe('SYSTEM_ADMIN')
  })

  it('ai cũng đọc được token Strava của người khác', async () => {
    const r = await asUser<{ strava_access_token: string }>(db, null, '/profiles',
      `select strava_access_token from public.profiles where id = $1`, [VICTIM])
    expect(r.rows[0].strava_access_token).toBe('victim-token')
  })

  it('tự thêm vật phẩm vào tủ đồ', async () => {
    await asUser(db, ATTACKER, '/user_inventory',
      `insert into public.user_inventory (user_id, item_id) values ($1, '00000000-0000-0000-0000-00000000f00d')`, [ATTACKER])
  })
})

describe('SAU migration', () => {
  let db: PGlite
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 120_000)

  describe('lỗ hổng đã bị chặn', () => {
    it('không ai tự nạp / điều chỉnh Xu, kể cả khi truyền UUID của admin', async () => {
      await expect(asUser(db, null, '/rpc/user_topup_xu',
        `select public.user_topup_xu($1, 1000000, 0, 'fake', 'k1')`, [ATTACKER])).rejects.toThrow()
      await expect(asUser(db, ATTACKER, '/rpc/user_topup_xu',
        `select public.user_topup_xu($1, 1000000, 1, 'fake', 'k1')`, [ATTACKER])).rejects.toThrow(/FORBIDDEN/)
      await expect(asUser(db, ATTACKER, '/rpc/admin_adjust_user_xu',
        `select public.admin_adjust_user_xu($1, 1000, 'BONUS', 'hack hack', 'k2')`, [ATTACKER])).rejects.toThrow(/FORBIDDEN/)
      await expect(asUser(db, ATTACKER, '/rpc/execute_ledger_transaction',
        `select public.execute_ledger_transaction('X', 'k3', 'x', $1, $2::jsonb)`,
        [ATTACKER, JSON.stringify([{ account_id: ATTACKER, coin_kind: 'BONUS', amount: 999 }, { account_id: SYS, coin_kind: 'BONUS', amount: -999 }])]))
        .rejects.toThrow(/permission denied/)
      expect(await xuOf(db, ATTACKER)).toBe(10)
    })

    it('không tự sửa Xu / role / is_admin, nhưng vẫn đổi được tên', async () => {
      for (const col of [`xu = 999999`, `role = 'SYSTEM_ADMIN'`, `is_admin = true`, `level = 5`, `xp = 99999`]) {
        await expect(asUser(db, ATTACKER, '/profiles', `update public.profiles set ${col} where id = $1`, [ATTACKER]))
          .rejects.toThrow(/permission denied/)
      }
      await asUser(db, ATTACKER, '/profiles', `update public.profiles set display_name = 'Runner A' where id = $1`, [ATTACKER])
      const r = await db.query<{ display_name: string }>(`select display_name from public.profiles where id = $1`, [ATTACKER])
      expect(r.rows[0].display_name).toBe('Runner A')
    })

    it('không tự tạo hồ sơ, bài chạy, CLB, thử thách, vật phẩm qua REST', async () => {
      const attempts: [string, string][] = [
        ['/profiles', `insert into public.profiles (id, display_name, xu) values (gen_random_uuid(), 'x', 1e9)`],
        ['/activities', `insert into public.activities (user_id, distance_m) values ('${ATTACKER}', 1e7)`],
        ['/clubs', `insert into public.clubs (name, invite_code, treasury_balance) values ('x', 'abc', 1e6)`],
        ['/challenges', `insert into public.challenges (title, start_date, end_date, target_value) values ('x', now(), now() + interval '1 day', 1)`],
        ['/user_inventory', `insert into public.user_inventory (user_id, item_id) values ('${ATTACKER}', '00000000-0000-0000-0000-00000000f00d')`],
        ['/club_members', `insert into public.club_members (club_id, user_id, role) values (gen_random_uuid(), '${ATTACKER}', 'OWNER')`],
      ]
      for (const [p, sql] of attempts) {
        await expect(asUser(db, ATTACKER, p, sql), p).rejects.toThrow()
      }
    })

    it('token Strava không còn trong profiles, đã chuyển sang connected_accounts (client không đọc được)', async () => {
      const r = await asUser<{ t: string | null }>(db, null, '/profiles',
        `select strava_access_token as t from public.profiles where id = $1`, [VICTIM])
      expect(r.rows[0].t).toBeNull()
      await expect(asUser(db, ATTACKER, '/connected_accounts', `select * from public.connected_accounts`))
        .rejects.toThrow(/permission denied/)
      const c = await db.query<{ access_token: string }>(`select access_token from public.connected_accounts where user_id = $1`, [VICTIM])
      expect(c.rows[0].access_token).toBe('victim-token')
      await expect(db.query(`update public.profiles set strava_access_token = 'x' where id = $1`, [VICTIM]))
        .rejects.toThrow(/profiles_no_oauth_tokens/)
    })

    it('upsert user_avatar chỉ đổi ngoại hình vẫn chạy; không sửa được coins', async () => {
      const upsert = `insert into public.user_avatar (user_id, gender, updated_at) values ($1, $2, now())
                      on conflict (user_id) do update set user_id = excluded.user_id, gender = excluded.gender, updated_at = excluded.updated_at`
      await asUser(db, ATTACKER, '/user_avatar', upsert, [ATTACKER, 'female'])
      await asUser(db, ATTACKER, '/user_avatar', upsert, [ATTACKER, 'male'])
      await expect(asUser(db, ATTACKER, '/user_avatar', `update public.user_avatar set coins = 99999 where user_id = $1`, [ATTACKER]))
        .rejects.toThrow(/permission denied/)
    })
  })

})
