import { ClubShell } from '@/features/club'
import { ClubMatchBanner } from '@/features/cup'

export default async function ClubLayout({ children, params }: LayoutProps<'/clubs/[id]'>) {
  const { id } = await params
  // Dải nhắc đấu CLB (đăng ký thi đấu / đang đấu / lời mời) hiện ở mọi tab của CLB
  return <ClubShell clubId={id} banner={<ClubMatchBanner clubId={id} />}>{children}</ClubShell>
}
