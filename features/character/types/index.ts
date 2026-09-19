export type ItemCategory = 
  | 'base' | 'hair' | 'top' | 'bottom' | 'shoes' 
  | 'hat' | 'glasses' | 'watch' | 'accessory' | 'effect';

export type ItemRarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface AvatarItem {
  id: string;
  name: string;
  category: ItemCategory;
  rarity: ItemRarity;
  asset_url: string;
  is_active: boolean;
  metadata: Record<string, any>;
}

export interface UserAvatar {
  id: string;
  user_id: string;
  gender: 'male' | 'female';
  skin_tone: string;
  hair_style: string;
  hair_color: string;
  level: number;
  xp: number;
  coins: number;
}

export interface UserEquipment {
  user_id: string;
  base_item_id?: string;
  hair_item_id?: string;
  top_item_id?: string;
  bottom_item_id?: string;
  shoes_item_id?: string;
  hat_item_id?: string;
  glasses_item_id?: string;
  watch_item_id?: string;
  accessory_item_id?: string;
  effect_item_id?: string;
}

export interface InventoryItem {
  id: string;
  user_id: string;
  item_id: string;
  acquired_at: string;
  acquired_reason: string;
  avatar_items: AvatarItem;
}

export interface RunnerStats {
  endurance: number;
  speed: number;
  consistency: number;
  explorer: number;
  team: number;
}
