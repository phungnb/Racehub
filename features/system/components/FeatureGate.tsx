'use client'

import type { ReactNode } from 'react'
import { PauseCircle } from 'lucide-react'
import { useMyProfile } from '@/features/auth'
import { EmptyState } from '@/shared/ui'
import { FEATURES, type FeatureKey } from '@/shared/lib/ops'
import { useFeature } from '../hooks/useSystem'

/**
 * Tính năng admin đã tắt (Quản trị → Hệ thống → Chính sách vận hành): người dùng thấy thông báo tạm tắt;
 * admin hệ thống vẫn vào được (để kiểm tra / chuẩn bị trước khi bật lại) kèm băng nhắc.
 */
export function FeatureGate({ feature, children }: { feature: FeatureKey; children: ReactNode }) {
  const on = useFeature(feature)
  const { profile } = useMyProfile()
  if (on) return <>{children}</>
  const label = FEATURES.find((f) => f.key === feature)?.label ?? 'Tính năng này'
  if (profile?.role === 'SYSTEM_ADMIN' || profile?.is_admin === true) {
    return (
      <>
        <p role="status" className="mb-3 flex items-center gap-2 rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning">
          <PauseCircle className="size-4 shrink-0" aria-hidden />{label} đang TẮT với người dùng — bạn thấy vì là admin.
        </p>
        {children}
      </>
    )
  }
  return <EmptyState icon={PauseCircle} title={`${label} đang tạm dừng`} description="Tính năng này đang được bảo trì hoặc tạm ngưng. Vui lòng quay lại sau." />
}
