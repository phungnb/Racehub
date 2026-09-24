import { ClubSettingsScreen } from '@/features/club'

export default async function ClubSettingsPage({ params }: PageProps<'/clubs/[id]/settings'>) {
  const { id } = await params
  return <ClubSettingsScreen clubId={id} />
}
