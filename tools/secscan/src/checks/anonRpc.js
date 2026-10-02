// LỖI: RPC nguy hiểm gọi được bởi anon. RaceHub từng để anon gọi user_topup_xu,
// execute_ledger_transaction, admin_adjust_user_xu, create_challenge_with_fee… →
// tự tạo Xu, tự cộng quỹ, giả danh admin. Migration 000100 đã revoke execute khỏi anon.
//
// Phát hiện KHÔNG GỌI RPC: PostgREST chỉ liệt kê trong OpenAPI những RPC mà vai trò
// anon có quyền execute. RPC còn xuất hiện với khóa anon = anon vẫn gọi được.
// Chỉ ĐỌC danh sách tên, không POST tới /rpc/ nào.

// Tên gợi ý thao tác tiền/quyền/ghi — gọi được bởi anon là nghiêm trọng.
const DANGER = [/topup/i, /adjust/i, /\badmin/i, /grant/i, /award/i, /issue/i, /ledger/i, /fund/i,
  /mint/i, /add_?xu/i, /set_/i, /_fee/i, /transaction/i, /reward/i, /redeem/i, /refund/i, /delete/i,
  /promote/i, /ban\b/i, /role/i, /payout/i, /withdraw/i, /topup/i]

/** Tách riêng để test: từ tên RPC ra finding. */
export function assessRpc(name) {
  const danger = DANGER.some((p) => p.test(name))
  return {
    severity: danger ? 'critical' : 'medium',
    rpc: name,
    title: `anon gọi được RPC "${name}"`,
    detail: danger
      ? 'Tên gợi ý thao tác tiền/quyền/ghi. anon gọi được = có thể tự tạo tài sản hoặc nâng quyền.'
      : 'anon gọi được RPC này. Kiểm xem có cần cho khách chưa đăng nhập không; nếu không, revoke execute.',
    fix: 'revoke all on function … from public, anon, authenticated; chỉ grant execute cho vai trò cần thiết '
      + '(service_role, hoặc authenticated với kiểm auth.uid() bên trong) — như migration 000100.',
  }
}

export async function checkAnonRpc({ spec, allowRpc = [] }) {
  const findings = []
  if (!spec?.ok) return { ok: true, note: spec?.note || 'Không có spec để kiểm tra RPC.', findings }
  const allow = new Set(allowRpc)
  for (const name of spec.rpcs) {
    if (allow.has(name)) continue // RPC công khai có chủ đích (ví dụ tra cứu công khai)
    findings.push(assessRpc(name))
  }
  const bad = findings.some((f) => f.severity === 'critical')
  return { ok: !bad, note: findings.length ? undefined
    : 'Không có RPC nào anon gọi được (hoặc tất cả đã khai báo an toàn).', findings }
}
