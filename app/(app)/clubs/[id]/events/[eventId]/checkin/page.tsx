import { EventCheckinScreen } from '@/features/club'

// Mở từ mã QR điểm danh: /clubs/<id>/events/<eventId>/checkin?t=<mã ký>
export default async function EventCheckinPage({ params, searchParams }: PageProps<'/clubs/[id]/events/[eventId]/checkin'>) {
  const [{ id, eventId }, sp] = await Promise.all([params, searchParams])
  const t = typeof sp.t === 'string' ? sp.t : null
  return <EventCheckinScreen clubId={id} eventId={eventId} token={t} />
}
