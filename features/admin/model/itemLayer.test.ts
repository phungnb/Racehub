import { describe, expect, it, vi } from 'vitest'

// Cổng '@/features/character' kéo theo client Supabase (cần biến môi trường) — không dùng trong hàm thuần
vi.mock('@/shared/lib/supabase', () => ({ supabase: {} }))

import { checkLayer, suggestCode, type LayerStats } from './itemLayer'

const ok: LayerStats = { width: 900, height: 1350, bytes: 40_000, type: 'image/png', opaqueRatio: 0.03, cornerAlpha: 0 }

describe('kiểm tra file lớp vật phẩm', () => {
  it('file đúng chuẩn không có lỗi', () => {
    expect(checkLayer(ok, 'hat')).toEqual({ errors: [], warnings: [] })
  })
  it('sai khung, sai định dạng, quá nặng, phủ kín, trống → lỗi', () => {
    expect(checkLayer({ ...ok, width: 1024, height: 1536 }, 'hat').errors[0]).toContain('900×1350')
    expect(checkLayer({ ...ok, type: 'image/jpeg' }, 'hat').errors).toHaveLength(1)
    expect(checkLayer({ ...ok, bytes: 2_000_000 }, 'hat').errors).toHaveLength(1)
    expect(checkLayer({ ...ok, opaqueRatio: 0.9, cornerAlpha: 255 }, 'hat').errors).toHaveLength(1)
    expect(checkLayer({ ...ok, opaqueRatio: 0 }, 'hat').errors).toHaveLength(1)
  })
  it('hiệu ứng được phủ rộng; file hơi nặng hoặc góc đục chỉ cảnh báo', () => {
    expect(checkLayer({ ...ok, opaqueRatio: 0.9, cornerAlpha: 255 }, 'effect').errors).toEqual([])
    expect(checkLayer({ ...ok, bytes: 500_000 }, 'hat').warnings).toHaveLength(1)
    expect(checkLayer({ ...ok, cornerAlpha: 200 }, 'hat').warnings).toHaveLength(1)
  })
})

describe('mã vật phẩm', () => {
  it('bỏ dấu tiếng Việt, thêm tiền tố ô', () => {
    expect(suggestCode('hat', 'Mũ lưỡi trai Đỏ')).toBe('hat_mu_luoi_trai_do')
    expect(suggestCode('top', 'Áo CLB Hồ Tây 2026!')).toBe('top_ao_clb_ho_tay_2026')
    expect(suggestCode('hat', 'hat cap')).toBe('hat_cap')
  })
})
