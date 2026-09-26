import { describe, expect, it } from 'vitest'
import { parseCsv, unitOptions } from './org'

describe('org model', () => {
  it('đọc CSV phẩy / chấm phẩy, ngoặc kép, BOM', () => {
    expect(parseCsv('\uFEFFemail,đơn vị\r\na@x.vn,"Miền Bắc / Hà Nội, KT"\n\n')).toEqual([['email', 'đơn vị'], ['a@x.vn', 'Miền Bắc / Hà Nội, KT']])
    expect(parseCsv('email;mã\nb@x.vn;NV01')).toEqual([['email', 'mã'], ['b@x.vn', 'NV01']])
  })
  it('cây đơn vị theo thứ tự cha → con, có đường dẫn', () => {
    const u = [{ id: 'c', name: 'KT', parent_id: 'b' }, { id: 'a', name: 'Miền Bắc', parent_id: null }, { id: 'b', name: 'Hà Nội', parent_id: 'a' }]
    expect(unitOptions(u).map((x) => [x.id, x.depth, x.path])).toEqual([['a', 0, 'Miền Bắc'], ['b', 1, 'Miền Bắc / Hà Nội'], ['c', 2, 'Miền Bắc / Hà Nội / KT']])
    expect(unitOptions(u, ['b', 'c']).map((x) => x.id)).toEqual(['b', 'c'])
  })
})
