import { describe, expect, it } from 'vitest'
import { bestSale, saleBonusXu, salePrice, type Sale } from './sale'

const s = (p: Partial<Sale>): Sale => ({ id: 'x', title: 't', message: null, discount_pct: 0, bonus_pct: 0, applies_to: 'ALL', plan_code: null, ends_at: null, ...p })

describe('đợt khuyến mãi (khớp create_order)', () => {
  it('chọn đợt phù hợp và tính giá / Xu tặng thêm', () => {
    const sales = [s({ id: 'a', discount_pct: 20, applies_to: 'PLAN' }), s({ id: 'b', bonus_pct: 100, applies_to: 'XU' }), s({ id: 'c', discount_pct: 30, plan_code: 'VIP3' })]
    expect(bestSale(sales, 'PLAN', 'VIP1')?.id).toBe('a')
    expect(bestSale(sales, 'PLAN', 'VIP3')?.id).toBe('c')
    expect(bestSale(sales, 'XU')?.id).toBe('b')
    expect(salePrice(29000, bestSale(sales, 'PLAN', 'VIP1'))).toBe(23000)
    expect(salePrice(10000, null)).toBe(10000)
    expect(saleBonusXu(1000, 80, bestSale(sales, 'XU'))).toBe(1080)
  })
})
