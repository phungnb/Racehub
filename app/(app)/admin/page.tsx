'use client'

import { ShieldAlert } from 'lucide-react'
import AdminTab from '@/features/admin/components/AdminTab'
import AdminDashboard from '@/features/admin/components/AdminDashboard'
import { useMyProfile } from '@/features/auth/model/session'
import { isSystemAdmin } from '@/shared/lib/adminConfig'
import { EmptyState, Skeleton } from '@/shared/ui'

// Ẩn/hiện giao diện; quyền thật được kiểm tra trong RPC (is_system_admin)
export default function AdminPage() {
  const { profile, isPending } = useMyProfile()
  if (isPending) return <Skeleton className="h-96" />
  if (!isSystemAdmin(profile)) {
    return <EmptyState icon={ShieldAlert} title="Không có quyền truy cập" description="Khu vực dành cho quản trị viên hệ thống." />
  }
  return (
    <div className="space-y-6">
      <AdminTab profile={profile} />
      <AdminDashboard profile={profile} />
    </div>
  )
}
