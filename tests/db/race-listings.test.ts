import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 016000: tab Race — tin giải chạy offline, chỉ admin đăng
const ADM = '00000000-0000-0000-0000-000000016000'
const USR = '00000000-0000-0000-0000-000000016001'
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }

describe('Tin giải chạy offline (016000)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed: async (d) => {
      await d.exec(`
        insert into auth.users (id, email) values ('${ADM}', 'a16@x.vn'), ('${USR}', 'u16@x.vn');
        insert into public.profiles (id, display_name, xu, xp, level, created_at) values
          ('${ADM}', 'Admin', 0, 0, 1, now()), ('${USR}', 'Runner', 0, 0, 1, now()) on conflict do nothing;`)
    } })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADM])
  }, 240_000)

  it('chỉ admin đăng; người thường chỉ thấy bản đã đăng; link phải là http(s); không đăng trùng nguồn', async () => {
    const ins = (uid: string, status: string, src: string | null = null, reg = 'https://btc.vn/dk') =>
      asUser(db, uid, '/rest', `insert into public.race_listings (title, race_date, status, reg_url, source_url) values ('Giải thử', current_date + 30, $1, $2, $3) returning id`, [status, reg, src])
    expect(await fails(ins(USR, 'PUBLISHED'))).not.toBe('OK')
    await ins(ADM, 'DRAFT', 'https://btc.vn/a')
    await ins(ADM, 'PUBLISHED', 'https://btc.vn/b')
    expect(await fails(ins(ADM, 'DRAFT', 'https://BTC.vn/a'))).not.toBe('OK')
    expect(await fails(ins(ADM, 'DRAFT', null, 'javascript:alert(1)'))).not.toBe('OK')
    const seen = async (uid: string) => (await asUser<{ status: string }>(db, uid, '/rest', `select status from public.race_listings order by status`)).rows.map((r) => r.status)
    expect(await seen(USR)).toEqual(['PUBLISHED'])
    expect(await seen(ADM)).toEqual(['DRAFT', 'PUBLISHED'])
    const del = await asUser(db, USR, '/rest', `delete from public.race_listings returning id`)
    expect(del.rows).toHaveLength(0)
  })
})
