import { ClubChatScreen } from '@/features/club'

export default async function ClubChatPage({ params }: PageProps<'/clubs/[id]/chat'>) {
  const { id } = await params
  return <ClubChatScreen clubId={id} />
}
