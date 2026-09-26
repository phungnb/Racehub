import 'server-only'
import { cache } from 'react'
import { createSupabaseServerClient } from './supabase-server'

/** Đọc một trang menu admin soạn (help_pages, 007300/008500) phía máy chủ; chưa có / lỗi mạng → null để trang dùng bản dự phòng */
export const loadHelpPage = cache(async <T,>(slug: string): Promise<T | null> => {
  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.rpc('help_page', { p_slug: slug })
    return error ? null : ((data as T | null) ?? null)
  } catch {
    return null
  }
})
