import { describe, it, expect } from 'vitest'
import { fitSide } from './image'

describe('thu nhỏ ảnh trước khi tải', () => {
  it('giữ tỉ lệ, cạnh dài ≤ giới hạn; ảnh nhỏ giữ nguyên', () => {
    expect(fitSide(5600, 4000, 2800)).toEqual({ w: 2800, h: 2000 })
    expect(fitSide(1000, 3000, 2800)).toEqual({ w: 933, h: 2800 })
    expect(fitSide(1400, 1000, 2800)).toEqual({ w: 1400, h: 1000 })
  })
})
