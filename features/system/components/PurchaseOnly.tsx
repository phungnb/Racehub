'use client'

import type { ReactNode } from 'react'
import { useCanPurchase } from '../hooks/useSystem'

/** Chỉ hiện khi được bán ở đây (web; hoặc app iOS/Android đã bật "Cho phép mua trong app") — giá, nút mua, hướng dẫn chuyển khoản */
export function PurchaseOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  return useCanPurchase() ? children : fallback
}
