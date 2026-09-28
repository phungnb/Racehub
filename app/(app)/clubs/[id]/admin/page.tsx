import { ClubDashboardScreen } from '@/features/club'

// Bảng điều khiển ban quản trị CLB (009600)
export default async function ClubAdminPage({ params }: PageProps<'/clubs/[id]/admin'>) {
  const { id } = await params
  return <ClubDashboardScreen clubId={id} />
}
