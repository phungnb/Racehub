import { ClubTreasuryScreen } from '@/features/club'

export default async function ClubTreasuryPage({ params }: PageProps<'/clubs/[id]/treasury'>) {
  const { id } = await params
  return <ClubTreasuryScreen clubId={id} />
}
