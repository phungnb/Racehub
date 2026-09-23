// Cổng công khai của module character. Code ngoài module chỉ import từ '@/features/character'.
export { CharacterHub } from './components/CharacterHub'
export { Wardrobe } from './components/Wardrobe'
export { PaperDoll } from './components/PaperDoll'
export { useCharacterOf } from './hooks/useCharacter'
export * from './model/catalog'
