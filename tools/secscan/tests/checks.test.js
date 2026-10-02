// Test offline cho phần lõi phát hiện. Không chạm mạng. Chạy: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyColumns, assessReadableRow } from '../src/checks/exposedTables.js'
import { assessWritable } from '../src/checks/writableTables.js'
import { assessRpc } from '../src/checks/anonRpc.js'
import { checkWritableTables } from '../src/checks/writableTables.js'
import { checkAnonRpc } from '../src/checks/anonRpc.js'
import { buildReport } from '../src/report.js'

test('classifyColumns bắt token, PII, cột nhạy cảm', () => {
  const c = classifyColumns(['id', 'display_name', 'strava_access_token', 'email', 'role', 'banned_reason'])
  assert.deepEqual(c.secrets, ['strava_access_token'])
  assert.deepEqual(c.pii, ['email'])
  assert.deepEqual(c.privilege.sort(), ['banned_reason', 'role'])
})

test('assessReadableRow: lộ token là CRITICAL', () => {
  const f = assessReadableRow('profiles', ['id', 'strava_access_token'])
  assert.equal(f.severity, 'critical')
})

test('assessReadableRow: đọc được nhưng không cột nhạy cảm là HIGH', () => {
  const f = assessReadableRow('posts', ['id', 'title', 'body'])
  assert.equal(f.severity, 'high')
})

test('assessWritable: bảng tiền/quyền ghi được là CRITICAL', () => {
  assert.equal(assessWritable('profiles', ['get', 'patch']).severity, 'critical')
  assert.equal(assessWritable('ledger_entries', ['post']).severity, 'critical')
})

test('assessWritable: bảng thường ghi được là HIGH; chỉ đọc thì không báo', () => {
  assert.equal(assessWritable('tags', ['post']).severity, 'high')
  assert.equal(assessWritable('tags', ['get']), null)
})

test('assessRpc: RPC tiền/quyền là CRITICAL, RPC thường là MEDIUM', () => {
  assert.equal(assessRpc('user_topup_xu').severity, 'critical')
  assert.equal(assessRpc('admin_adjust_user_xu').severity, 'critical')
  assert.equal(assessRpc('create_challenge_with_fee').severity, 'critical')
  assert.equal(assessRpc('get_public_leaderboard').severity, 'medium')
})

test('checkWritableTables đọc từ spec, không chạm mạng', async () => {
  const spec = { ok: true, tables: [
    { name: 'profiles', methods: ['get', 'patch'] },
    { name: 'posts', methods: ['get'] },
  ], rpcs: [] }
  const r = await checkWritableTables({ spec })
  assert.equal(r.findings.length, 1)
  assert.equal(r.findings[0].table, 'profiles')
})

test('checkAnonRpc tôn trọng allowRpc', async () => {
  const spec = { ok: true, tables: [], rpcs: ['user_topup_xu', 'get_public_leaderboard'] }
  const r = await checkAnonRpc({ spec, allowRpc: ['get_public_leaderboard'] })
  assert.equal(r.findings.length, 1)
  assert.equal(r.findings[0].rpc, 'user_topup_xu')
})

test('buildReport xếp theo mức nghiêm trọng và đếm đúng', () => {
  const results = {
    a: { findings: [{ severity: 'low', title: 'L' }, { severity: 'critical', title: 'C' }] },
    b: { findings: [{ severity: 'high', title: 'H' }] },
  }
  const rep = buildReport({ auth: { target: 't', authorizedBy: 'me' }, startedAt: 'now', results })
  assert.equal(rep.total, 3)
  assert.equal(rep.counts.critical, 1)
  // critical phải đứng trước high, high trước low
  const order = ['C', 'H', 'L'].map((t) => rep.text.indexOf(t))
  assert.ok(order[0] < order[1] && order[1] < order[2])
})
