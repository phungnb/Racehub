import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb } from './load-schema'

// Migration 015800: ngày theo giờ Việt Nam — không hàm nào còn dùng current_date (UTC)
describe('ngày theo giờ Việt Nam (015800)', () => {
  let db: PGlite
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true }) }, 240_000)

  it('không còn hàm public/private nào dùng current_date', async () => {
    const r = await db.query<{ f: string }>(`
      select n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and p.prokind = 'f' and p.prosrc ~* '\\mcurrent_date\\M'
         and p.proname <> 'admin_system_check'`)
    expect(r.rows).toEqual([])
  })

  it('các hàm đã thay dùng private.vn_today()', async () => {
    const r = await db.query<{ d: string }>(`select pg_get_functiondef('public.nearby_runners(jsonb)'::regprocedure) as d`)
    expect(r.rows[0].d).toContain('private.vn_today()')
  })

  it('private.vn_today() là ngày giờ VN, không đổi theo múi giờ phiên', async () => {
    await db.exec(`set time zone 'America/Los_Angeles'`)
    const a = (await db.query<{ same: boolean }>(`select private.vn_today() = (now() at time zone 'Asia/Ho_Chi_Minh')::date as same`)).rows[0].same
    await db.exec(`set time zone 'UTC'`)
    expect(a).toBe(true)
  })
})
