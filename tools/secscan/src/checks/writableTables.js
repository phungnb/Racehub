// LỖI: anon tự INSERT/UPDATE (RaceHub từng dính ở clubs, activities, challenges,
// user_inventory/equipment/badges/titles, và cột xu/role/is_admin của profiles).
//
// Phát hiện KHÔNG GỬI LỆNH GHI: bản OpenAPI do PostgREST sinh theo vai trò anon chỉ
// liệt kê method mà anon được cấp. Bảng nào hiện post/patch/put/delete nghĩa là anon
// có quyền ghi — đó chính là lỗ hổng. Migration 000100 đã revoke các quyền này.
import { WRITE_METHODS } from '../supabase.js'

// Bảng mà ghi được là đặc biệt nguy hiểm (tiền, vật phẩm, vai trò).
const HOT = [/profile/i, /ledger/i, /wallet/i, /transaction/i, /treasury/i, /club/i, /challenge/i,
  /inventory/i, /equipment/i, /badge/i, /title/i, /activit/i, /fraud/i, /admin/i, /config/i, /setting/i]

/** Tách riêng để test: từ (tên bảng, method) ra finding hoặc null. */
export function assessWritable(table, methods) {
  const writes = methods.filter((m) => WRITE_METHODS.includes(m))
  if (!writes.length) return null
  const hot = HOT.some((p) => p.test(table))
  return {
    severity: hot ? 'critical' : 'high',
    table,
    title: `anon ghi được bảng "${table}" (${writes.join('/')})`,
    detail: hot
      ? 'Bảng nhạy cảm (tiền/vật phẩm/vai trò/CLB). anon có quyền ghi = tự tạo tài sản hoặc nâng quyền.'
      : 'anon có quyền ghi vào bảng này.',
    fix: 'revoke insert, update, delete … from anon, authenticated (như migration 000100); '
      + 'cho ghi hợp lệ thì đi qua RPC SECURITY DEFINER kiểm auth.uid(), hoặc grant theo cột tối thiểu.',
  }
}

export async function checkWritableTables({ spec }) {
  const findings = []
  if (!spec?.ok) return { ok: true, note: spec?.note || 'Không có spec để kiểm tra quyền ghi.', findings }
  for (const { name, methods } of spec.tables) {
    const f = assessWritable(name, methods)
    if (f) findings.push(f)
  }
  return { ok: findings.length === 0, findings }
}
