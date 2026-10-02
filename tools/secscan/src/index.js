#!/usr/bin/env node
// secscan — rà soát cấu hình an toàn cho app Supabase/PostgREST.
// Phạm vi cố ý hẹp: chỉ các lớp lỗi RaceHub đã gặp và đã vá. Chỉ GET (read-only).
//
// Dùng:
//   node src/index.js --url https://app.com --anon-key <ANON_KEY> --i-am-authorized "Phụng"
//   node src/index.js --url https://app.com --anon-key <KEY> --allow-rpc search_public,get_leaderboard
//   node src/index.js --url https://app.com --anon-key <KEY> --out bao-cao.txt --json
//
// --anon-key là khóa anon CÔNG KHAI của Supabase. Không nhập service_role vào đây.
import { writeFile } from 'node:fs/promises'
import { argv, exit, stdout } from 'node:process'
import { requireAuthorization } from './auth.js'
import { fetchSpec } from './supabase.js'
import { checkExposedTables } from './checks/exposedTables.js'
import { checkWritableTables } from './checks/writableTables.js'
import { checkAnonRpc } from './checks/anonRpc.js'
import { checkKeyInBundle } from './checks/keyInBundle.js'
import { buildReport } from './report.js'

function parseArgs(args) {
  const out = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (!a.startsWith('--')) continue
    const eq = a.indexOf('=')
    if (eq !== -1) { out[a.slice(2, eq)] = a.slice(eq + 1); continue }
    const next = args[i + 1]
    if (next && !next.startsWith('--')) { out[a.slice(2)] = next; i++ } else { out[a.slice(2)] = true }
  }
  return out
}

const normBase = (url) => { const u = new URL(url); return `${u.protocol}//${u.host}` }

function usage() {
  stdout.write(
    'secscan — rà soát cấu hình an toàn (read-only)\n\n' +
    '  --url <https://...>         (bắt buộc) địa chỉ app cần kiểm tra\n' +
    '  --anon-key <KEY>            khóa anon công khai của Supabase (để kiểm tra bảng/RPC)\n' +
    '  --supabase-url <https://..> địa chỉ PostgREST nếu khác domain app\n' +
    '  --allow-rpc a,b,c           các RPC công khai có chủ đích (bỏ qua khi báo lỗi)\n' +
    '  --i-am-authorized "<ai>"    bỏ qua hỏi xác nhận (chỉ cho app của chính mình/CI)\n' +
    '  --out <file>               ghi báo cáo ra file\n' +
    '  --json                     in thêm JSON tóm tắt\n',
  )
}

async function main() {
  const args = parseArgs(argv.slice(2))
  if (args.help || !args.url) { usage(); exit(args.url ? 0 : 1) }

  const target = args.url
  const base = normBase(args['supabase-url'] || args.url)
  const anonKey = args['anon-key']
  const allowRpc = String(args['allow-rpc'] || '').split(',').map((s) => s.trim()).filter(Boolean)

  const auth = await requireAuthorization(target, args['i-am-authorized'])
  const startedAt = new Date().toISOString()
  const results = {}

  stdout.write('\n→ Kiểm tra khóa service_role lộ trong front-end...\n')
  results['key-in-bundle'] = await checkKeyInBundle({ target })

  if (anonKey) {
    stdout.write('→ Đọc OpenAPI của PostgREST (một lần, bằng khóa anon)...\n')
    const spec = await fetchSpec({ base, anonKey })
    stdout.write('→ Kiểm tra bảng cho anon đọc / token lộ...\n')
    results['exposed-tables'] = await checkExposedTables({ base, anonKey, spec })
    stdout.write('→ Kiểm tra bảng cho anon ghi...\n')
    results['writable-tables'] = await checkWritableTables({ spec })
    stdout.write('→ Kiểm tra RPC anon gọi được...\n')
    results['anon-rpc'] = await checkAnonRpc({ spec, allowRpc })
  } else {
    const skip = { ok: true, note: 'Bỏ qua: chưa cung cấp --anon-key.', findings: [] }
    results['exposed-tables'] = skip
    results['writable-tables'] = { ...skip }
    results['anon-rpc'] = { ...skip }
  }

  const report = buildReport({ auth, startedAt, results })
  stdout.write('\n' + report.text + '\n')

  if (args.out) { await writeFile(args.out, report.text, 'utf8'); stdout.write(`\nĐã ghi báo cáo: ${args.out}\n`) }
  if (args.json) {
    stdout.write('\n' + JSON.stringify({ target, startedAt, ...report.counts, total: report.total }, null, 2) + '\n')
  }

  const bad = (report.counts.critical || 0) + (report.counts.high || 0)
  exit(bad > 0 ? 2 : 0)
}

main().catch((e) => { stdout.write(`\nLỗi: ${e.message}\n`); exit(1) })
