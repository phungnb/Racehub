// Cổng công khai của module character. Code ngoài module chỉ import từ '@/features/character'.
export { CharacterHub } from './components/CharacterHub'
export { Wardrobe } from './components/Wardrobe'
export { PaperDoll } from './components/PaperDoll'
export { LayerThumb } from './components/LayerThumb'
export { useCharacterOf } from './hooks/useCharacter'
export * from './model/catalog'
