import { describe, it, expect } from 'vitest'
import { toPlaces } from './geocode'

describe('toPlaces', () => {
  it('gọn tên + địa chỉ, bỏ trùng, bỏ chỗ ngoài Việt Nam', () => {
    const f = (props: Record<string, string>, c: [number, number] = [105.84, 21.01]) => ({ geometry: { coordinates: c }, properties: props })
    const r = toPlaces({ features: [
      f({ name: 'Công viên Thống Nhất', street: 'Trần Nhân Tông', district: 'Hai Bà Trưng', city: 'Hà Nội', countrycode: 'VN' }),
      f({ name: 'Công viên Thống Nhất', street: 'Trần Nhân Tông', district: 'Hai Bà Trưng', city: 'Hà Nội', countrycode: 'VN' }),
      f({ name: 'Vientiane', countrycode: 'LA' }),
      f({ housenumber: '12', street: 'Lê Duẩn', city: 'Hà Nội', countrycode: 'VN' }),
      { properties: { name: 'Không tọa độ' } },
    ] })
    expect(r).toEqual([
      { name: 'Công viên Thống Nhất', address: 'Trần Nhân Tông, Hai Bà Trưng, Hà Nội', lat: 21.01, lng: 105.84 },
      { name: '12 Lê Duẩn', address: 'Hà Nội', lat: 21.01, lng: 105.84 },
    ])
    expect(toPlaces(null)).toEqual([])
  })
})
