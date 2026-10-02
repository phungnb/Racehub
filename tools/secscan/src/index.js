#!/usr/bin/env node
// secscan — rà soát cấu hình an toàn cho app Supabase/PostgREST.
// Phạm vi cố ý hẹp: chỉ các lớp lỗi RaceHub đã gặp và đã vá. Chỉ GET (read-only).
//
// Dùng:
//   node src/index.js --url https://app-cua-ban.com --anon-key <ANON_KEY>
//   node src/index.js --url https://... --anon-key <KEY> --i-am-authorized "Tên anh"
//   node src/index.js --url https://... --anon-key <KEY> --out bao-cao.txt
//
// --anon-key là khóa anon CÔNG KHAI của Supabase (nằm sẵn trong app). Không nhập
// service_role vào đây. Thiếu --anon-key thì bỏ qua bước kiểm tra bảng.
import { writeFile } from 'node:fs/promises'
import { argv, exit, stdout } from 'node:process'
import { requireAuthorization } from './auth.js'
import { checkExposedTables } from './checks/exposedTables.js'
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

function normBase(url) {
  const u = new URL(url)
  return `${u.protocol}//${u.host}`
}

async function main() {
  const args = parseArgs(argv.slice(2))
  if (args.help || !args.url) {
    stdout.write(
      'secscan — rà soát cấu hình an toàn (read-only)\n\n' +
      '  --url <https://...>         (bắt buộc) địa chỉ app cần kiểm tra\n' +
      '  --anon-key <KEY>            khóa anon công khai của Supabase (để kiểm tra bảng)\n' +
      '  --supabase-url <https://..> địa chỉ PostgREST nếu khác domain app\n' +
      '  --i-am-authorized "<ai>"    bỏ qua hỏi xác nhận (chỉ cho app của chính mình/CI)\n' +
      '  --out <file>               ghi báo cáo ra file\n' +
      '  --json                     in thêm JSON tóm tắt\n',
    )
    exit(args.url ? 0 : 1)
  }

  const target = args.url
  const base = normBase(args['supabase-url'] || args.url)
  const anonKey = args['anon-key']

  const auth = await requireAuthorization(target, args['i-am-authorized'])
  const startedAt = new Date().toISOString()

  const results = {}
  stdout.write('\n→ Kiểm tra khóa service_role lộ trong front-end...\n')
  results['key-in-bundle'] = await checkKeyInBundle({ target })

  if (anonKey) {
    stdout.write('→ Kiểm tra bảng cho anon đọc / token lộ (dùng khóa anon)...\n')
    results['exposed-tables'] = await checkExposedTables({ base, anonKey })
  } else {
    results['exposed-tables'] = { ok: true, note: 'Bỏ qua: chưa cung cấp --anon-key.', findings: [] }
  }

  const report = buildReport({ auth, startedAt, results })
  stdout.write('\n' + report.text + '\n')

  if (args.out) {
    await writeFile(args.out, report.text, 'utf8')
    stdout.write(`\nĐã ghi báo cáo: ${args.out}\n`)
  }
  if (args.json) {
    stdout.write('\n' + JSON.stringify({ target, startedAt, ...report.counts, total: report.total }, null, 2) + '\n')
  }

  // Thoát mã != 0 nếu có lỗi critical/high (tiện gắn vào CI của chính mình).
  const bad = (report.counts.critical || 0) + (report.counts.high || 0)
  exit(bad > 0 ? 2 : 0)
}

main().catch((e) => { stdout.write(`\nLỗi: ${e.message}\n`); exit(1) })
