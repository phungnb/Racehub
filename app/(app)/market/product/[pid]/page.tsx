import { ProductScreen } from '@/features/market'

export default async function ProductPage({ params }: PageProps<'/market/product/[pid]'>) {
  const { pid } = await params
  return <ProductScreen id={pid} />
}
