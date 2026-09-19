import { supabase } from '@/shared/lib/supabase'

export async function fetchUserAvatar(userId: string) {
  const { data, error } = await supabase
    .from('user_avatar')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  
  if (error) throw error
  return data
}

export async function fetchUserEquipment(userId: string) {
  const { data, error } = await supabase
    .from('user_equipment')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  
  if (error) throw error
  return data
}

export async function fetchUserInventory(userId: string) {
  const { data, error } = await supabase
    .from('user_inventory')
    .select('*, avatar_items(*)')
    .eq('user_id', userId)
  
  if (error) throw error
  return data
}

export async function equipItemRpc(itemId: string, category: string) {
  const { error } = await supabase.rpc('equip_avatar_item', {
    p_item_id: itemId,
    p_category: category
  })
  if (error) throw error
  return true
}
