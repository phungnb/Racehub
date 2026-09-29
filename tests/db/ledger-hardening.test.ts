import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 010800: khóa chống trừ Xu hai lần, admin không nhận Xu, lỗi BXH đấu CLB
const [U, ADM, OWNER] = [1, 2, 3].map((n) => `00000000-0000-0000-0000-0000001080${String(n).padStart(2, '0')}`)

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${U}', 'u108@x.vn'), ('${ADM}', 'a108@x.vn'), ('${OWNER}', 'o108@x.vn');
    insert into public.profiles (id, display_name) values ('${U}', 'An'), ('${ADM}', 'Admin'), ('${OWNER}', 'Chủ') on conflict do nothing;
    update public.profiles set role = 'SYSTEM_ADMIN' where id = '${ADM}';
  `)
}
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const credit = (acc: string, amt: number, key: string, type = 'PROMO') => `select private.ledger_post('${type}', '${key}', 'test', null,
  jsonb_build_array(jsonb_build_object('account_id', '${acc}'::uuid, 'coin_kind', 'BONUS', 'amount', ${amt}),
                    jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', ${-amt}))) as tx`
const bal = async (db: PGlite, acc: string) => Number((await db.query<{ b: string }>(`select private.balance($1) b`, [acc])).rows[0].b)

describe('sổ cái an toàn (010800)', () => {
  let db: PGlite
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 300_000)

  it('cùng mã giao dịch gửi 2 lần: chỉ ghi 1 lần, lần sau trả lại giao dịch cũ', async () => {
    const a = (await db.query<{ tx: string }>(credit(U, 100, 'k108-1'))).rows[0].tx
    const b = (await db.query<{ tx: string }>(credit(U, 100, 'k108-1'))).rows[0].tx
    expect(b).toBe(a)
    expect(await bal(db, U)).toBe(100)
    // Tiêu quá số dư bị chặn
    expect(await fails(db.query(`select private.ledger_post('GIFT', 'k108-2', 't', null, private.debit_entries($1, 150, private.system_account()))`, [U])))
      .toContain('INSUFFICIENT_BALANCE')
    expect(await bal(db, U)).toBe(100)
  })

  it('ghi thẳng vào sổ cái làm ví âm cũng bị chặn khi chốt giao dịch', async () => {
    await db.exec('begin')
    const tx = (await db.query<{ id: string }>(`insert into public.ledger_transactions (type, idempotency_key, reason) values ('HACK', 'k108-hack', 'x') returning id`)).rows[0].id
    await db.query(`insert into public.ledger_entries (transaction_id, account_id, coin_kind, amount) values ($1, $2, 'BONUS', -500), ($1, private.system_account(), 'BONUS', 500)`, [tx, U])
    expect(await fails(db.exec('commit'))).toContain('INSUFFICIENT_BALANCE')
    expect(await bal(db, U)).toBe(100)
  })

  it('tài khoản quản trị không được cộng Xu (thưởng, khuyến mãi); hoàn tiền vẫn trả', async () => {
    await db.query(credit(ADM, 500, 'k108-adm'))
    expect(await bal(db, ADM)).toBe(0)
    await db.query(`select private.award($1, 'QUEST', 'Nhiệm vụ', null, 30, 10, 'k108-award')`, [ADM])
    expect(await bal(db, ADM)).toBe(0)
    expect(Number((await db.query<{ xu: string }>(`select xu from public.game_events where dedupe_key = 'k108-award'`)).rows[0].xu)).toBe(0)
    await db.query(credit(ADM, 20, 'k108-refund', 'CHALLENGE_REFUND'))
    expect(await bal(db, ADM)).toBe(20)
    // Người thường vẫn nhận bình thường
    await db.query(`select private.award($1, 'QUEST', 'Nhiệm vụ', null, 30, 10, 'k108-award-u')`, [U])
    expect(await bal(db, U)).toBe(130)
  })

  it('BXH đấu CLB không còn lỗi kiểu dữ liệu', async () => {
    const c = (await asUser<{ r: { id: string } }>(db, OWNER, '/rpc', `select public.create_club('Hồ Tây 108', 'x') as r`)).rows[0].r
    const r = await asUser<{ r: unknown[] }>(db, OWNER, '/rpc', `select public.club_battles_of($1) as r`, [c.id])
    expect(r.rows[0].r).toEqual([])
  })
})
