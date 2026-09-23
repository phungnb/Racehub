import { supabase } from '@/shared/lib/supabase';

export interface UserAvatarSummary {
  display_name: string | null;
  avatar_url: string | null;
  level: number;
  xp: number;
  gender: 'male' | 'female' | null;
}

export async function fetchUserAvatar(userId: string): Promise<UserAvatarSummary | null> {
  if (!userId) return null;
  const [profileRes, avatarRes] = await Promise.all([
    supabase.from('profiles').select('avatar_url, display_name, level, xp').eq('id', userId).maybeSingle(),
    supabase.from('user_avatar').select('gender').eq('user_id', userId).maybeSingle(),
  ]);

  if (profileRes.error) {
    console.error('Lỗi tải avatar user:', profileRes.error.message);
    return null;
  }
  if (!profileRes.data) return null;
  return {
    display_name: profileRes.data.display_name ?? null,
    avatar_url: profileRes.data.avatar_url ?? null,
    level: profileRes.data.level ?? 1,
    xp: profileRes.data.xp ?? 0,
    gender: (avatarRes.data?.gender as 'male' | 'female' | undefined) ?? null,
  };
}

export async function fetchUserEquipment(userId: string) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('user_equipment')
    .select('*')
    .eq('user_id', userId);

  if (error) {
    console.error('Lỗi tải thiết bị nhân vật:', error.message);
    return [];
  }
  return data || [];
}

export async function fetchUserInventory(userId: string) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('user_inventory')
    .select('*, avatar_items(*)')
    .eq('user_id', userId);

  if (error) {
    console.error('Lỗi tải tủ đồ inventory:', error.message);
    return [];
  }
  return data || [];
}

export async function equipItemRpc(itemId: string, category: string) {
  // Máy chủ tự xác định người gọi bằng auth.uid() và kiểm tra quyền sở hữu vật phẩm
  const { data, error } = await supabase.rpc('equip_avatar_item', {
    p_item_id: itemId,
    p_category: category,
  });

  if (error) {
    console.error('Lỗi trang bị vật phẩm:', error.message);
    throw new Error(error.message);
  }
  return data;
}
