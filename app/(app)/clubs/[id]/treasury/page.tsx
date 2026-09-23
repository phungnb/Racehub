import { ClubTreasuryScreen } from '@/features/club'

export default async function ClubTreasuryPage({ params, searchParams }: PageProps<'/clubs/[id]/treasury'>) {
  const [{ id }, sp] = await Promise.all([params, searchParams])
  // ?due=<id>: mở thẳng kỳ thu phí (từ thông báo)
  return <ClubTreasuryScreen clubId={id} openDue={typeof sp.due === 'string' ? sp.due : null} />
}
