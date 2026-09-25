import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { asUser, createDb, sanitize } from './load-schema'
import { buildBundle } from '../../scripts/db-bundle.mjs'

// File gộp supabase/deploy/chay_tu_003700.sql: đúng nội dung migration hiện tại, chạy được trên production (đang ở 003600), chạy lại vẫn an toàn
const FILE = path.join(__dirname, '../../supabase/deploy/chay_tu_003700.sql')
const ADMIN = '00000000-0000-0000-0000-0000000037b1'

describe('file gộp triển khai (supabase/deploy)', () => {
  it('khớp với migration hiện tại (chạy lại `node scripts/db-bundle.mjs` nếu sai)', () => {
    expect(fs.readFileSync(FILE, 'utf8')).toBe(buildBundle('003700'))
  })

  it('production ở 003600 → dán file gộp (2 lần) → Kiểm tra hệ thống báo đủ migration', async () => {
    const db = await createDb({ withMigrations: true, until: '20261001003600' })
    const sql = sanitize(fs.readFileSync(FILE, 'utf8'))
    await db.exec(sql)
    await db.exec(sql)
    await db.exec(`
      insert into auth.users (id, email) values ('${ADMIN}', 'a@x.vn');
      insert into public.profiles (id, display_name, xu, xp, level, created_at) values ('${ADMIN}', 'Admin', 0, 0, 1, now()) on conflict do nothing;
      update public.profiles set role = 'SYSTEM_ADMIN' where id = '${ADMIN}';
    `)
    const r = (await asUser<{ r: { migrations: { file: string; ok: boolean }[] } }>(db, ADMIN, '/rpc', `select public.admin_system_check() as r`)).rows[0].r
    expect(r.migrations.filter((m) => !m.ok)).toEqual([])
    const latest = fs.readdirSync(path.join(__dirname, '../../supabase/migrations')).filter((f) => f.startsWith('20261001')).sort().at(-1)!.slice(0, 14)
    expect(r.migrations.at(-1)?.file).toBe(latest)
  }, 240_000)
})
