import { ClubEventScreen } from '@/features/club'

export default async function ClubEventPage({ params }: PageProps<'/clubs/[id]/events/[eventId]'>) {
  const { id, eventId } = await params
  return <ClubEventScreen clubId={id} eventId={eventId} />
}
