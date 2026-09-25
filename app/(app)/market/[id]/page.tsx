import { PartnerProfile } from '@/features/market'

export default async function PartnerPage({ params }: PageProps<'/market/[id]'>) {
  const { id } = await params
  return <PartnerProfile id={id} />
}
