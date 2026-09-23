import { supabase } from '@/shared/lib/supabase';

export async function fetchUserAvatar(userId: string) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('avatar_url, display_name, level, xp')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error('Lỗi tải avatar user:', error.message);
    return null;
  }
  return data;
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
    .select('*')
    .eq('user_id', userId);

  if (error) {
    console.error('Lỗi tải tủ đồ inventory:', error.message);
    return [];
  }
  return data || [];
}

export async function equipItemRpc(userId: string, itemId: string) {
  const { data, error } = await supabase.rpc('equip_item', {
    p_user_id: userId,
    p_item_id: itemId
  });

  if (error) {
    console.error('Lỗi trang bị vật phẩm:', error.message);
    throw new Error(error.message);
  }
  return data;
}
