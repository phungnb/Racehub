import type { ReactNode } from 'react'
import { FeatureGate } from '@/features/system'

// Hội quán đi cùng công tắc "Quanh đây" (Quản trị → Hệ thống → Chính sách vận hành)
export default function Layout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="nearby">{children}</FeatureGate>
}
