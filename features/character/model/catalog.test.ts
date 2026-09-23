import { describe, expect, it } from 'vitest'
import { itemStatus, modelUrl, normalizeBone, outfitDiff, type CharacterItem } from './catalog'

const it0 = (p: Partial<CharacterItem>): CharacterItem => ({ code: 'top_x', name: 'x', description: null, slot: 'top', rarity: 'common',
  model_key: 'top_tee', model_urls: null, color: null, color2: null, price_xu: 20, unlock_level: 1, is_default: false, ...p })

describe('nhân vật — hàm thuần', () => {
  it('URL mô hình: asset riêng ưu tiên, không thì theo model_key + giới tính', () => {
    expect(modelUrl(it0({}), 'female')).toBe('/models/character/top_tee_female.glb')
    expect(modelUrl(it0({ model_urls: { male: 'https://cdn/x.glb' } }), 'male')).toBe('https://cdn/x.glb')
    expect(modelUrl(it0({ model_urls: { male: 'https://cdn/x.glb' } }), 'female')).toBe('/models/character/top_tee_female.glb')
    expect(modelUrl(it0({ model_key: null }), 'male')).toBeNull()
  })
  it('chuẩn hóa tên xương Mixamo', () => {
    expect(normalizeBone('mixamorig:LeftForeArm')).toBe('LeftForeArm')
    expect(normalizeBone('mixamorigHips')).toBe('Hips')
    expect(normalizeBone('Head')).toBe('Head')
  })
  it('trạng thái vật phẩm và phần thay đổi của bộ đồ', () => {
    expect(itemStatus(it0({ owned: true }), 1, { top: 'top_x' })).toBe('EQUIPPED')
    expect(itemStatus(it0({ owned: true }), 1, {})).toBe('OWNED')
    expect(itemStatus(it0({ unlock_level: 3 }), 2, {})).toBe('LOCKED')
    expect(itemStatus(it0({}), 2, {})).toBe('BUY')
    expect(outfitDiff({ top: 'a', hat: 'h' }, { top: 'b' })).toEqual({ top: 'b', hat: null })
    expect(outfitDiff({ top: 'a' }, { top: 'a' })).toEqual({})
  })
})
