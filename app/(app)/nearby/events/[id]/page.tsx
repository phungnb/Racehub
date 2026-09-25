import { PublicEventScreen } from '@/features/nearby'

export default async function PublicEventPage({ params }: PageProps<'/nearby/events/[id]'>) {
  const { id } = await params
  return <PublicEventScreen eventId={id} />
}
