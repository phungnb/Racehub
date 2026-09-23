import { CharacterAvatarData, CharacterEquipmentData } from './characterTypes';

export interface PresetRunnerProfile {
  id: 'male' | 'female';
  name: string;
  previewImage: string;
  avatar: CharacterAvatarData;
  equipment: CharacterEquipmentData;
}

export const PRESET_RUNNERS: Record<'male' | 'female', PresetRunnerProfile> = {
  male: {
    id: 'male',
    name: 'Kaelen (Nam Runner)',
    previewImage: '/avatars/runner_male.png',
    avatar: {
      gender: 'male',
      level: 1,
      skinTone: 'light',
    },
    equipment: {
      top: { slot: 'top', id: 'top_blue', name: 'Blue Technical Shirt', rarity: 'epic', assetId: 'top_blue', iconUrl: '', owned: true },
      bottom: { slot: 'bottom', id: 'bottom_shorts', name: 'Performance Shorts', rarity: 'common', assetId: 'bottom_shorts', iconUrl: '', owned: true },
      shoes: { slot: 'shoes', id: 'shoes_blue', name: 'Blue Carbon Racers', rarity: 'legendary', assetId: 'shoes_blue', iconUrl: '', owned: true },
    }
  },
  female: {
    id: 'female',
    name: 'Seraphina (Nữ Runner)',
    previewImage: '/avatars/runner_female.png',
    avatar: {
      gender: 'female',
      level: 1,
      skinTone: 'light',
    },
    equipment: {
      top: { slot: 'top', id: 'top_coral', name: 'Coral Pink Croptop', rarity: 'epic', assetId: 'top_coral', iconUrl: '', owned: true },
      bottom: { slot: 'bottom', id: 'bottom_fitted', name: 'Athletic Fitted Shorts', rarity: 'common', assetId: 'bottom_fitted', iconUrl: '', owned: true },
      shoes: { slot: 'shoes', id: 'shoes_coral', name: 'Coral Pink Racers', rarity: 'legendary', assetId: 'shoes_coral', iconUrl: '', owned: true },
    }
  }
};

export const DEFAULT_AVATAR = PRESET_RUNNERS.male.avatar;
export const DEFAULT_EQUIPMENT = PRESET_RUNNERS.male.equipment;