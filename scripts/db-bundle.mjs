// Gộp các migration chưa chạy thành MỘT file SQL để dán vào Supabase SQL Editor (chạy trọn gói; lỗi thì tự hoàn tác).
//   node scripts/db-bundle.mjs            → từ 003700 đến migration mới nhất
//   node scripts/db-bundle.mjs 004800     → từ 004800
// File ra: supabase/deploy/chay_tu_<from>.sql. Cuối file chạy lại 003500 (Kiểm tra hệ thống) để trang Quản trị → Hệ thống biết đủ migration.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(ROOT, 'supabase/migrations')
export const SYSTEM_CHECK = '20261001003500_system_check.sql'

export function bundleFiles(from = '003700') {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql') && f.startsWith('20261001')).sort()
  const picked = files.filter((f) => f.slice(8, 14) >= from)
  if (!picked.length) throw new Error(`Không có migration nào từ ${from}`)
  return picked.includes(SYSTEM_CHECK) ? picked : [...picked, SYSTEM_CHECK]
}

export function buildBundle(from = '003700') {
  const files = bundleFiles(from)
  const parts = files.map((f) => `-- ===================================================================\n-- ${f}\n-- ===================================================================\n${fs.readFileSync(path.join(DIR, f), 'utf8').trim()}\n`)
  return [
    `-- RaceHub: gộp ${files.length} migration (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).`,
    `-- Cách chạy: Supabase → SQL Editor → New query → dán TOÀN BỘ file → Run.`,
    `-- Chạy trong một giao dịch: lỗi ở bất kỳ đâu thì không có gì thay đổi. Chạy lại nhiều lần vẫn an toàn.`,
    `-- Gồm: ${files.map((f) => f.slice(8, 14)).join(', ')}`,
    'begin;',
    ...parts,
    'commit;',
    '',
  ].join('\n')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const from = process.argv[2] ?? '003700'
  const out = path.join(ROOT, 'supabase/deploy', `chay_tu_${from}.sql`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, buildBundle(from))
  console.log(`Đã tạo ${path.relative(ROOT, out)} (${bundleFiles(from).length} file, ${Math.round(fs.statSync(out).size / 1024)} KB)`)
}
