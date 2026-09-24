import { ClubEventsScreen } from '@/features/club'

export default async function ClubEventsPage({ params }: PageProps<'/clubs/[id]/events'>) {
  const { id } = await params
  return <ClubEventsScreen clubId={id} />
}
