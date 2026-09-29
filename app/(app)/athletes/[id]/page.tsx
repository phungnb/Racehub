import { AthleteScreen } from '@/features/profile'

// Hồ sơ một vận động viên: bấm tên / ảnh ở bảng tin, BXH, danh sách thành viên… đều mở trang này
export default async function AthletePage({ params }: PageProps<'/athletes/[id]'>) {
  const { id } = await params
  return <AthleteScreen id={id} />
}
