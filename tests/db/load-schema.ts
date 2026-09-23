import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const ROOT = path.resolve(__dirname, '../..')

/** Bỏ các lệnh chỉ có trên Supabase thật (extension không có trong PGlite). */
function sanitize(sql: string) {
  return sql
    .replace(/^CREATE EXTENSION IF NOT EXISTS "(pg_stat_statements|supabase_vault|uuid-ossp|pg_graphql)".*$/gm, '')
    .replace(/^CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";$/gm,
      'CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";')
    .replace(/^ALTER PUBLICATION .*$/gm, '')
    .replace(/^SELECT pg_catalog\.set_config\('search_path', '', false\);$/gm, '')
    .replace(/notify pgrst[^;]*;/gi, '')
}

/** Tạo DB mới = schema production + (tuỳ chọn) các migration mới. */
export async function createDb({
  withMigrations = true,
  runMigrationsTwice = false,
  seed,
}: { withMigrations?: boolean; runMigrationsTwice?: boolean; seed?: (db: PGlite) => Promise<void> } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(fs.readFileSync(path.join(__dirname, 'supabase_stub.sql'), 'utf8'))
  await db.exec(sanitize(fs.readFileSync(path.join(ROOT, 'supabase/remote_schema.sql'), 'utf8')))
  await db.exec(`set search_path = "$user", public, extensions; set row_security = on;`)
  if (seed) await seed(db)            // dữ liệu có sẵn trên production TRƯỚC khi migrate
  if (withMigrations) {
    const dir = path.join(ROOT, 'supabase/migrations')
    const files = fs.readdirSync(dir).filter((f) => f >= '20261001').sort()
    for (let i = 0; i < (runMigrationsTwice ? 2 : 1); i++) {
      for (const f of files) await db.exec(sanitize(fs.readFileSync(path.join(dir, f), 'utf8')))
    }
  }
  return db
}

/** Chạy một câu lệnh như một request PostgREST của user (hoặc anon nếu uid = null). */
export async function asUser<T>(db: PGlite, uid: string | null, reqPath: string, sql: string, params: unknown[] = []) {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claims', $1, false), set_config('request.path', $2, false)`,
    [uid ? JSON.stringify({ sub: uid, role: 'authenticated' }) : '', reqPath])
  await db.exec(uid ? 'set role authenticated' : 'set role anon')
  try {
    return await db.query<T>(sql, params)
  } finally {
    await db.exec('reset role')
    await db.query(`select set_config('request.path', '', false), set_config('request.jwt.claims', '', false)`)
  }
}
