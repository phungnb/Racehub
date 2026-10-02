// LỖI 1 (profiles lộ mọi cột) + LỖI 2 (token OAuth nằm trong bảng ai cũng đọc).
//
// Read-only: với mỗi bảng anon NHÌN THẤY, GET ...?select=*&limit=1 bằng khóa anon
// và KHÔNG đăng nhập. Có dòng trả về → anon đọc được (RLS tắt hoặc policy USING true).
// Soi tên cột của dòng đó để nâng mức nếu lộ token/PII/cột nhạy cảm.
import { get, parseJson } from '../http.js'

const SECRET_COLS = [/access_token/i, /refresh_token/i, /secret/i, /password/i, /api[_-]?key/i, /private_key/i]
const PII_COLS = [/email/i, /phone/i, /sdt/i, /address/i, /dia_chi/i, /dob/i, /ngay_sinh/i, /cccd/i, /cmnd/i]
const PRIV_COLS = [/^role$/i, /is_admin/i, /banned_reason/i, /referral_code/i, /^xu$/i, /balance/i, /treasury/i]

export function classifyColumns(keys) {
  const hit = (pats) => keys.filter((k) => pats.some((p) => p.test(k)))
  return { secrets: hit(SECRET_COLS), pii: hit(PII_COLS), privilege: hit(PRIV_COLS) }
}

/** Phân loại một dòng đọc được thành finding. Tách riêng để test offline. */
export function assessReadableRow(table, keys) {
  const cls = classifyColumns(keys)
  let severity = 'high'
  const bits = [`anon đọc được dữ liệu thật (mẫu ${keys.length} cột)`]
  if (cls.secrets.length) { severity = 'critical'; bits.push(`LỘ BÍ MẬT XÁC THỰC: ${cls.secrets.join(', ')}`) }
  if (cls.pii.length) bits.push(`lộ dữ liệu cá nhân: ${cls.pii.join(', ')}`)
  if (cls.privilege.length) bits.push(`lộ cột nhạy cảm: ${cls.privilege.join(', ')}`)
  return {
    severity,
    table,
    title: `Bảng "${table}" cho anon đọc dữ liệu`,
    detail: bits.join('; ') + '.',
    fix: 'Bật RLS + bỏ policy USING(true) cho anon; cho người đã đăng nhập đọc vài cột thì grant theo cột '
      + '(như profiles trong migration 011900). Token/bí mật chuyển sang schema private hoặc bảng chỉ '
      + 'service_role đọc (connected_accounts trong migration 000100).',
  }
}

export async function checkExposedTables({ base, anonKey, spec }) {
  const findings = []
  if (!spec?.ok || !spec.tables.length) {
    return { ok: true, note: spec?.note || 'Không có danh sách bảng để kiểm tra.', findings }
  }
  for (const { name: table } of spec.tables) {
    const url = `${base}/rest/v1/${encodeURIComponent(table)}?select=*&limit=1`
    const r = await get(url, { apikey: anonKey, Authorization: `Bearer ${anonKey}` })
    if (r.status !== 200) continue // 401/403/404 = anon không đọc được: tốt
    const rows = parseJson(r.text)
    if (!Array.isArray(rows) || rows.length === 0) {
      findings.push({
        severity: 'low',
        table,
        title: `Bảng "${table}" phản hồi 200 cho anon (RLS lọc hết dòng)`,
        detail: 'Chưa lộ dữ liệu, nhưng nên thu hồi SELECT của anon ở mức quyền bảng để chặn thêm một lớp.',
      })
      continue
    }
    findings.push(assessReadableRow(table, Object.keys(rows[0] || {})))
  }
  return { ok: findings.every((f) => f.severity === 'low'), tablesScanned: spec.tables.length, findings }
}
