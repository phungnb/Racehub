'use client' // Error boundary phải là Client Component

import { CrashScreen } from '@/shared/ui'

// Lỗi trong một màn: giữ nguyên thanh trên / thanh tab (layout), chỉ thay phần nội dung
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <CrashScreen error={error} retry={retry} compact />
}
