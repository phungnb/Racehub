'use client'

import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/ui'
import { getClubPlan } from '../api/clubApi'
import { ProLockedButton } from './settings/ProLock'

/**
 * Nút "Xuất Excel" cho ban tổ chức thuộc CLB: CLB Pro bấm xuất được, CLB Miễn phí thấy nút khóa kèm đường nâng cấp.
 * `onExport` trả lỗi thì báo toast; truyền `disabled` khi chưa có dữ liệu để xuất.
 */
export function ClubProExportButton({ clubId, feature, onExport, disabled, label = 'Xuất Excel' }: {
  clubId: string; feature: string; onExport: () => Promise<void> | void; disabled?: boolean; label?: string
}) {
  const plan = useQuery({ queryKey: ['club', clubId, 'plan'], queryFn: () => getClubPlan(clubId), staleTime: 60_000 })
  if (!plan.data) return null
  if (!plan.data.active) {
    return <ProLockedButton icon={<Download className="size-4" />} label={`${label} (CLB Pro)`} feature={feature} />
  }
  return (
    <Button variant="secondary" disabled={disabled}
      onClick={() => { void Promise.resolve(onExport()).catch(() => toast.error('Không tạo được file Excel, thử lại.')) }}>
      <Download className="size-4" aria-hidden />{label}
    </Button>
  )
}
