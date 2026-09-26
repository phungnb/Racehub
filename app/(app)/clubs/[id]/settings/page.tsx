import { ClubSettingsScreen } from '@/features/club'
import { ClubOrgCard } from '@/features/org'

export default async function ClubSettingsPage({ params }: PageProps<'/clubs/[id]/settings'>) {
  const { id } = await params
  return (
    <div className="space-y-6">
      <ClubOrgCard clubId={id} />
      <ClubSettingsScreen clubId={id} />
    </div>
  )
}
