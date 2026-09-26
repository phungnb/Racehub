// Gộp các migration chưa chạy thành MỘT file SQL để dán vào Supabase SQL Editor (chạy trọn gói; lỗi thì tự hoàn tác).
//   node scripts/db-bundle.mjs            → từ 003700 đến migration mới nhất
//   node scripts/db-bundle.mjs 004800     → từ 004800
// File ra: supabase/deploy/chay_tu_<from>.sql. Cuối file chạy lại 003500 (Kiểm tra hệ thống) để trang Quản trị → Hệ thống biết đủ migration.
// Kèm bản CHIA NHỎ supabase/deploy/phan/phan_NN.sql (mỗi phần ≤ ~90 KB, dễ copy / dán): chạy lần lượt từ phần đầu tiên còn thiếu.
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

export const PART_LIMIT = 90 * 1024

/** Chia các migration thành nhiều phần nhỏ (không cắt giữa một migration); phần cuối chạy lại 003500 */
export function buildParts(from = '003700') {
  const files = bundleFiles(from).filter((f) => f !== SYSTEM_CHECK)
  const groups = []
  let cur = [], size = 0
  for (const f of files) {
    const n = fs.statSync(path.join(DIR, f)).size
    if (cur.length && size + n > PART_LIMIT) { groups.push(cur); cur = []; size = 0 }
    cur.push(f); size += n
  }
  if (cur.length) groups.push(cur)
  groups.push([SYSTEM_CHECK])
  return groups.map((g, i) => {
    const no = String(i + 1).padStart(2, '0')
    const body = g.map((f) => `-- ===================================================================\n-- ${f}\n-- ===================================================================\n${fs.readFileSync(path.join(DIR, f), 'utf8').trim()}\n`)
    return {
      name: `phan_${no}.sql`,
      files: g,
      sql: [
        `-- RaceHub — PHẦN ${no}/${String(groups.length).padStart(2, '0')} (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).`,
        `-- Gồm: ${g.map((f) => f.slice(8, 14)).join(', ')}`,
        `-- Supabase → SQL Editor → New query → dán TOÀN BỘ phần này → Run. Lỗi thì không có gì thay đổi; chạy lại vẫn an toàn.`,
        i === groups.length - 1 ? '-- PHẦN CUỐI: luôn chạy phần này sau cùng (cập nhật trang Quản trị → Kiểm tra hệ thống).' : '-- Xong thì chạy phần tiếp theo.',
        'begin;', ...body, 'commit;', '',
      ].join('\n'),
    }
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const from = process.argv[2] ?? '003700'
  const out = path.join(ROOT, 'supabase/deploy', `chay_tu_${from}.sql`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, buildBundle(from))
  console.log(`Đã tạo ${path.relative(ROOT, out)} (${bundleFiles(from).length} file, ${Math.round(fs.statSync(out).size / 1024)} KB)`)
  // Bản chia nhỏ
  const dir = path.join(ROOT, 'supabase/deploy/phan')
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const parts = buildParts(from)
  const lines = ['# Chạy database theo từng phần nhỏ', '', 'Mỗi phần: Supabase → **SQL Editor** → New query → dán toàn bộ → **Run**. Chạy lại vẫn an toàn.',
    'Không nhớ đã chạy tới đâu: xem **Quản trị → Hệ thống → Kiểm tra hệ thống**, bắt đầu từ phần chứa migration đầu tiên bị ✗; **luôn chạy phần cuối**.', '',
    '| Phần | Gồm migration | Dung lượng |', '|---|---|---|']
  for (const p of parts) {
    fs.writeFileSync(path.join(dir, p.name), p.sql)
    lines.push(`| [${p.name}](${p.name}) | ${p.files.map((f) => f.slice(8, 14)).join(', ')} | ${Math.round(Buffer.byteLength(p.sql) / 1024)} KB |`)
  }
  fs.writeFileSync(path.join(dir, 'README.md'), lines.join('\n') + '\n')
  console.log(`Đã tạo ${parts.length} phần trong supabase/deploy/phan/`)
}
