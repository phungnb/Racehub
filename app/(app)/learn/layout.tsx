import type { ReactNode } from 'react'
import { FeatureGate } from '@/features/system'

// Bật / tắt tính năng: Quản trị → Hệ thống → Chính sách vận hành (migration 009100)
export default function Layout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="knowledge">{children}</FeatureGate>
}
