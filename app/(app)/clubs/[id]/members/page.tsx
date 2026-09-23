import { ClubMembersScreen } from '@/features/club'

export default async function ClubMembersPage({ params }: PageProps<'/clubs/[id]/members'>) {
  const { id } = await params
  return <ClubMembersScreen clubId={id} />
}
