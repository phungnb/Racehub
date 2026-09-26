import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser, sanitize } from './load-schema'

// Migration 007200: production có bản admin_set_club_plan lạ (không có trong mã nguồn) chặn admin gán Pro → khôi phục bản chuẩn
const ADM = '00000000-0000-0000-0000-0000000072a1'
const CAP = '00000000-0000-0000-0000-0000000072a2'
const CLUB = '00000000-0000-0000-0000-0000000072c1'
const FILE = path.join(__dirname, '../../supabase/migrations/20261001007200_restore_admin_set_club_plan.sql')

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${ADM}', 'a72@x.vn'), ('${CAP}', 'c72@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values ('${ADM}', 'Admin', 0, 0, 1, now()), ('${CAP}', 'Captain', 0, 0, 1, now())
      on conflict do nothing;
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'NO BEER NO RUN', '${CAP}', 'nb7201');
    insert into public.club_members (club_id, user_id, role, status) values ('${CLUB}', '${CAP}', 'OWNER', 'APPROVED') on conflict do nothing;
  `)
}

const setPlan = (db: PGlite, uid: string) =>
  asUser<{ r: { plan: string } }>(db, uid, '/rpc', `select public.admin_set_club_plan($1, 'PRO', null, 'CLB ADMIN') as r`, [CLUB])

describe('khôi phục hàm gán gói CLB Pro (007200)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADM])
  }, 240_000)

  it('bản lạ trả kiểu khác + chặn admin → chạy 007200 thì admin gán Pro được, người thường vẫn bị chặn', async () => {
    await db.exec(`
      drop function public.admin_set_club_plan(uuid, text, timestamptz, text);
      create function public.admin_set_club_plan(p_club_id uuid, p_plan text, p_until timestamptz, p_reason text) returns void
      language plpgsql security definer set search_path = public as $$
      declare v uuid := private.require_admin();
      begin raise exception 'FORBIDDEN'; end $$;
      grant execute on function public.admin_set_club_plan(uuid, text, timestamptz, text) to authenticated;`)
    await expect(setPlan(db, ADM)).rejects.toThrow(/FORBIDDEN/)

    await db.exec(sanitize(fs.readFileSync(FILE, 'utf8')))
    expect((await setPlan(db, ADM)).rows[0].r.plan).toBe('PRO')
    expect((await db.query<{ plan: string; pro_until: string | null }>(`select plan, pro_until from public.clubs where id = $1`, [CLUB])).rows[0])
      .toMatchObject({ plan: 'PRO', pro_until: null })
    await expect(setPlan(db, CAP)).rejects.toThrow(/FORBIDDEN/)
  })

  it('bước báo ban quản trị CLB hỏng → vẫn gán được, lỗi ghi vào nhật ký', async () => {
    const orig = (await db.query<{ d: string }>(`select pg_get_functiondef('private.notify_club(uuid, boolean, text, text, text, text, uuid)'::regprocedure) as d`)).rows[0].d
    await db.exec(`create or replace function private.notify_club(p_club uuid, p_staff_only boolean, p_kind text, p_title text, p_body text, p_link text, p_actor uuid)
      returns void language plpgsql as $$ begin raise exception 'permission denied for table push_queue' using errcode = '42501'; end $$;`)
    try {
      expect((await setPlan(db, ADM)).rows[0].r.plan).toBe('PRO')
    } finally {
      await db.exec(orig)
    }
    const errs = (await db.query<{ stage: string }>(`select stage from private.notify_errors order by id desc`)).rows
    expect(errs.map((e) => e.stage)).toContain('club_plan')
  })
})
