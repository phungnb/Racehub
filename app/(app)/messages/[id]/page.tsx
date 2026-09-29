import { DirectChatScreen } from '@/features/social'

// Trò chuyện 1-1 với một runner (id = hồ sơ người kia)
export default async function DirectMessagePage({ params }: PageProps<'/messages/[id]'>) {
  const { id } = await params
  return <DirectChatScreen userId={id} />
}
