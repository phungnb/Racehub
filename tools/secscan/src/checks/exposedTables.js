// LỖI 1 (profiles lộ mọi cột) + LỖI 2 (token OAuth nằm trong bảng ai cũng đọc).
//
// Cách làm, hoàn toàn read-only:
//   1. GET /rest/v1/  → PostgREST trả bản mô tả OpenAPI liệt kê mọi bảng/view đang
//      phơi ra API. Đây là thông tin app tự công bố, không phải dò mò.
//   2. Với mỗi bảng, GET ...?select=*&limit=1 bằng KHÓA ANON và KHÔNG đăng nhập.
//      Nếu trả về dòng dữ liệu → anon đọc được bảng đó (RLS tắt, hoặc policy USING true).
//      Đây đúng là lỗ hổng bạn của chủ RaceHub đã khai thác.
//   3. Với dòng đọc được, soi tên cột: cột nhạy cảm (token, email, sđt, vai trò…) bị
//      lộ thì nâng mức nghiêm trọng.
import { get, parseJson } from '../http.js'

// Cột lộ ra là nghiêm trọng (CRITICAL nếu là bí mật xác thực).
const SECRET_COLS = [/access_token/i, /refresh_token/i, /secret/i, /password/i, /api[_-]?key/i, /private_key/i]
const PII_COLS = [/email/i, /phone/i, /sdt/i, /address/i, /dia_chi/i, /dob/i, /ngay_sinh/i, /cccd/i, /cmnd/i]
const PRIV_COLS = [/^role$/i, /is_admin/i, /banned_reason/i, /referral_code/i, /\bxu\b/i, /balance/i, /treasury/i]

function classifyColumns(keys) {
  const hit = (pats) => keys.filter((k) => pats.some((p) => p.test(k)))
  return {
    secrets: hit(SECRET_COLS),
    pii: hit(PII_COLS),
    privilege: hit(PRIV_COLS),
  }
}

async function listTables(base, anonKey) {
  const r = await get(`${base}/rest/v1/`, { apikey: anonKey, Authorization: `Bearer ${anonKey}` })
  const spec = parseJson(r.text)
  if (!spec || !spec.paths) return []
  // paths có dạng "/<table>"; bỏ path gốc "/" và các RPC "/rpc/..."
  return Object.keys(spec.paths)
    .filter((p) => p.startsWith('/') && p !== '/' && !p.startsWith('/rpc/'))
    .map((p) => p.slice(1))
    .filter(Boolean)
}

export async function checkExposedTables({ base, anonKey }) {
  const findings = []
  const tables = await listTables(base, anonKey)
  if (!tables.length) {
    return {
      ok: true,
      note: 'Không lấy được danh sách bảng từ /rest/v1/ (có thể đã khóa, hoặc không phải PostgREST).',
      findings,
    }
  }

  for (const table of tables) {
    // KHÔNG gắn JWT người dùng → đây là vai trò anon.
    const url = `${base}/rest/v1/${encodeURIComponent(table)}?select=*&limit=1`
    const r = await get(url, { apikey: anonKey, Authorization: `Bearer ${anonKey}` })
    if (r.status !== 200) continue // 401/403/404 = anon không đọc được: tốt
    const rows = parseJson(r.text)
    if (!Array.isArray(rows) || rows.length === 0) {
      // 200 + rỗng: anon "đọc được" nhưng RLS lọc hết. Vẫn nên khóa ở lớp quyền bảng.
      findings.push({
        severity: 'low',
        table,
        title: `Bảng "${table}" phản hồi 200 cho anon (RLS lọc hết dòng)`,
        detail: 'Chưa lộ dữ liệu, nhưng nên thu hồi SELECT của anon ở mức quyền bảng để chặn thêm một lớp.',
      })
      continue
    }

    const keys = Object.keys(rows[0] || {})
    const cls = classifyColumns(keys)
    let severity = 'high'
    const bits = [`anon đọc được dữ liệu thật (mẫu ${keys.length} cột)`]
    if (cls.secrets.length) { severity = 'critical'; bits.push(`LỘ BÍ MẬT XÁC THỰC: ${cls.secrets.join(', ')}`) }
    if (cls.pii.length) bits.push(`lộ dữ liệu cá nhân: ${cls.pii.join(', ')}`)
    if (cls.privilege.length) bits.push(`lộ cột nhạy cảm: ${cls.privilege.join(', ')}`)

    findings.push({
      severity,
      table,
      title: `Bảng "${table}" cho anon đọc dữ liệu`,
      detail: bits.join('; ') + '.',
      fix: 'Bật RLS + bỏ policy USING(true) cho anon; nếu cần cho người đã đăng nhập đọc vài cột, '
        + 'dùng grant theo cột như profiles trong migration 011900. Token/bí mật chuyển sang schema private '
        + 'hoặc bảng chỉ service_role đọc (như connected_accounts trong migration 000100).',
    })
  }

  return { ok: findings.every((f) => f.severity === 'low'), tablesScanned: tables.length, findings }
}
