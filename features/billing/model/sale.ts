// Đợt giảm giá / tặng thêm Xu (migration 004300) — tính giống create_order ở máy chủ để hiển thị trước.
export interface Sale { id: string; title: string; message: string | null; discount_pct: number; bonus_pct: number; applies_to: 'ALL' | 'PLAN' | 'XU'; plan_code: string | null; ends_at: string | null }

/** Đợt tốt nhất cho một món: giảm nhiều nhất, rồi tặng thêm nhiều nhất */
export function bestSale(sales: Sale[], kind: 'PLAN' | 'XU', planCode?: string | null): Sale | null {
  const ok = sales.filter((s) => (s.applies_to === 'ALL' || s.applies_to === kind) && (!s.plan_code || s.plan_code === planCode))
  return ok.sort((a, b) => b.discount_pct - a.discount_pct || b.bonus_pct - a.bonus_pct)[0] ?? null
}

/** Giá sau giảm, làm tròn tới 1.000đ, tối thiểu 1.000đ */
export function salePrice(list: number, sale: Sale | null) {
  if (!sale?.discount_pct) return list
  return Math.max(1000, Math.round((list * (100 - sale.discount_pct)) / 100 / 1000) * 1000)
}

/** Xu tặng thêm của gói nạp khi có đợt "nạp thêm %" */
export function saleBonusXu(xu: number, bonus: number, sale: Sale | null) {
  return bonus + Math.floor((xu * (sale?.bonus_pct ?? 0)) / 100)
}
