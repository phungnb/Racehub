import { ActivityDetailScreen } from '@/features/activity'

export default async function ActivityPage({ params }: PageProps<'/activities/[id]'>) {
  const { id } = await params
  return <ActivityDetailScreen id={id} />
}
