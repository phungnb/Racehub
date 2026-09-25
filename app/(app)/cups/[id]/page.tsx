import { CupDetailScreen } from '@/features/cup'

export default async function CupPage({ params }: PageProps<'/cups/[id]'>) {
  const { id } = await params
  return <CupDetailScreen id={id} />
}
