import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 006000: dáng nhân vật + thiết kế món đồ (lớp in tự do, độ đậm màu, ảnh vải)
const id = (n: number) => `00000000-0000-0000-0000-0000000060${String(n).padStart(2, '0')}`
const [ADM, CAP] = [1, 2].map(id)
const CLUB = '00000000-0000-0000-0000-0000000060c1'

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${ADM}', 'd1@x.vn'), ('${CAP}', 'd2@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values ('${ADM}', 'D1', 0, 0, 1, now()), ('${CAP}', 'D2', 0, 0, 1, now()) on conflict do nothing;
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'Sài Gòn Run', '${CAP}', 'sgr060');
  `)
}
type Row = Record<string, any>
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const saveItem = (db: PGlite, p: object) => rpc<Row>(db, ADM, `select public.admin_save_avatar_item($1::jsonb) as r`, [JSON.stringify(p)])
const logo = (club: string) => `https://x.supabase.co/storage/v1/object/public/uniform-media/${club}/logo.png`

describe('Trình thiết kế nhân vật (006000)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADM])
    await db.exec(`insert into public.club_members (club_id, user_id, role, status) values ('${CLUB}', '${CAP}', 'OWNER', 'APPROVED') on conflict do nothing;`)
  }, 240_000)

  it('chọn dáng nhân vật: hợp lệ thì lưu, lạ thì báo lỗi, bỏ trống thì về bộ gốc', async () => {
    expect(await rpc<Row>(db, CAP, `select public.save_character('{"body": "male_run"}'::jsonb, '{}'::jsonb) as r`)).toMatchObject({ body: 'male_run' })
    expect(await fails(rpc(db, CAP, `select public.save_character('{"body": "alien"}'::jsonb, '{}'::jsonb) as r`))).toContain('INVALID_LOOK')
    expect((await rpc<Row>(db, CAP, `select public.character_state() as r`)).body).toBe('male_run')
    expect((await rpc<Row>(db, CAP, `select public.save_character('{"body": null}'::jsonb, '{}'::jsonb) as r`)).body).toBeNull()
  })

  it('lớp in tự do + độ đậm + ảnh vải: làm sạch số liệu, chặn lớp sai', async () => {
    const it0 = await saveItem(db, { code: 'top_design', name: 'Áo thiết kế', slot: 'top', render_kind: 'TINT', color: '#0ea5e9',
      print: { tone: { strength: 5, light: -1 }, texture: { url: '/character/tex/mesh.png', opacity: 0.4 },
        layers: [{ type: 'text', text: 'SÀI GÒN RUN', font: 'athletic', color: '#FFFFFF', x: 0.5, y: 0.45, w: 9, rot: 400 },
                 { type: 'image', url: logo(CLUB), x: 0.7, y: 0.2, w: 0.15 }, { type: 'text', text: '   ' }] } })
    expect(it0.print.tone).toEqual({ strength: 1, light: -0.4 })
    expect(it0.print.layers).toHaveLength(2)
    expect(it0.print.layers[0]).toMatchObject({ text: 'SÀI GÒN RUN', color: '#ffffff', w: 1.6, rot: 180 })
    expect(await fails(saveItem(db, { code: 'top_bad', name: 'Áo', slot: 'top', render_kind: 'TINT', color: '#000000',
      print: { layers: [{ type: 'image', url: 'javascript:alert(1)' }] } }))).toContain('INVALID_LAYER')
    expect(await fails(saveItem(db, { code: 'socks_l', name: 'Tất', slot: 'socks', render_kind: 'TINT', color: '#ffffff',
      print: { layers: [{ type: 'text', text: 'A' }] } }))).toContain('PRINT_TOP_ONLY')
    expect(await saveItem(db, { code: 'bottom_l', name: 'Quần', slot: 'bottom', render_kind: 'TINT', color: '#111111',
      print: { layers: [{ type: 'text', text: '{TEN}' }], tone: { strength: 0.6 } } })).toMatchObject({ print: { layers: [{ text: '{TEN}' }], tone: { strength: 0.6 } } })
  })

  it('đồng phục CLB: ảnh trong thiết kế phải thuộc kho của chính CLB', async () => {
    const base = { name: 'Bộ SGR', color: '#16a34a' }
    expect(await fails(rpc(db, CAP, `select public.request_club_uniform($1, $2::jsonb) as r`, [CLUB,
      JSON.stringify({ ...base, print: { layers: [{ type: 'image', url: logo(id(99)) }] } })]))).toContain('INVALID_PRINT')
    const ok = await rpc<Row>(db, CAP, `select public.request_club_uniform($1, $2::jsonb) as r`, [CLUB,
      JSON.stringify({ ...base, print: { layers: [{ type: 'image', url: logo(CLUB), x: 0.7, y: 0.25, w: 0.2 }, { type: 'text', text: '{TEN}' }] },
        parts: { bottom: { color: '#111827', print: { tone: { strength: 0.8 } } } } })])
    expect(ok.print.layers).toHaveLength(2)
    expect(ok.parts.bottom.print.tone.strength).toBe(0.8)
  })
})
