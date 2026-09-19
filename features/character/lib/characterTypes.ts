export type GenderType = 'male' | 'female';

export interface CharacterAvatarData {
  id?: string;
  userId?: string;
  gender: GenderType;
  level: number;
  xp?: number;
  baseModelId?: string;
  skinTone?: string;
  hairStyle?: string;
}

export type EquipmentRarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface EquipmentItem {
  slot: string;
  id: string;
  name: string;
  rarity: EquipmentRarity;
  assetId: string;
  iconUrl?: string;
  owned?: boolean;
}

export interface CharacterEquipmentData {
  top?: EquipmentItem;
  bottom?: EquipmentItem;
  shoes?: EquipmentItem;
  head?: EquipmentItem;
  backpack?: EquipmentItem;
  accessory?: EquipmentItem;
  [key: string]: any; // Cho phép mở rộng linh hoạt các slot khác
}