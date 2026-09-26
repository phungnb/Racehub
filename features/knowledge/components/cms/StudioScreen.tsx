'use client'

import Link from 'next/link'
import { ArrowLeft, PenSquare } from 'lucide-react'
import { EmptyState, Skeleton } from '@/shared/ui'
import { routes } from '@/shared/config/routes'
import { useContentRole } from '../../hooks/useKnowledge'
import { CmsScreen } from './CmsScreen'

/** /learn/studio: CMS cho ban nội dung (biên tập viên, cộng tác viết, chuyên gia) — không cần quyền admin hệ thống */
export function StudioScreen() {
  const role = useContentRole()
  return (
    <div className="space-y-4">
      <Link href={routes.learn} className="-ml-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden />Kiến thức Runner
      </Link>
      <h1 className="text-2xl font-bold">Soạn bài Knowledge</h1>
      {role.isPending ? <Skeleton className="h-64" />
        : !role.data ? <EmptyState icon={PenSquare} title="Dành cho ban nội dung" description="Muốn cộng tác viết bài (HLV, chuyên gia, runner có kinh nghiệm)? Liên hệ RaceHub để được thêm vào ban nội dung." />
        : <CmsScreen />}
    </div>
  )
}
