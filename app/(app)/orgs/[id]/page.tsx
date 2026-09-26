import { Suspense } from 'react'
import { OrgScreen } from '@/features/org'

export default async function OrgPage({ params }: PageProps<'/orgs/[id]'>) {
  const { id } = await params
  return <Suspense><OrgScreen orgId={id} /></Suspense>
}
