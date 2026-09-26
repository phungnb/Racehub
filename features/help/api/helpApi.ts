// Menu Hướng dẫn & Chính sách (migration 007300). Đọc được khi chưa đăng nhập; sửa chỉ admin.
import { supabase } from '@/shared/lib/supabase'
import { must, systemErrorMessage } from '@/shared/lib/errors'
import type { HelpAdminPage, HelpMenu, HelpPage, HelpSection, SiteInfo } from '../model/help'

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}

export const helpMenu = () => call<HelpMenu>('help_menu').then(must<HelpMenu>('NOT_DEPLOYED'))
export const helpPage = (slug: string) => call<HelpPage>('help_page', { p_slug: slug }).then(must<HelpPage>('PAGE_NOT_FOUND'))

export interface HelpInput {
  slug: string; section: HelpSection; title: string; icon: string | null; summary: string | null; body: string
  version: string; effective_at: string | null; sort: number; is_published: boolean; needs_review: boolean
}
export const adminHelpList = () => call<{ pages: HelpAdminPage[]; site: SiteInfo }>('admin_help_list')
export const adminHelpSave = (p: HelpInput) => call<string>('admin_help_save', { p })
export const adminHelpDelete = (slug: string) => call<void>('admin_help_delete', { p_slug: slug })
export const adminSiteInfoSave = (p: SiteInfo) => call<SiteInfo>('admin_site_info_save', { p })

const MESSAGES: Record<string, string> = {
  PAGE_NOT_FOUND: 'Không tìm thấy trang.',
  INVALID_SLUG: 'Đường dẫn chỉ gồm chữ thường không dấu, số và dấu gạch ngang (2–60 ký tự).',
  INVALID_SECTION: 'Chọn nhóm cho trang.',
  INVALID_TITLE: 'Tiêu đề cần 2–120 ký tự.',
  FORBIDDEN: 'Chỉ quản trị viên hệ thống mới sửa được.',
}
export function helpErrorMessage(e: unknown): string {
  const raw = (e as { message?: string } | null)?.message ?? ''
  const key = Object.keys(MESSAGES).find((k) => raw.includes(k))
  return key ? MESSAGES[key] : systemErrorMessage(e, 'Không tải được. Hãy thử lại.')
}
