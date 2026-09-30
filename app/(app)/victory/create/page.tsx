import { redirect } from 'next/navigation'
import { VictoryEditor, type VicKind } from '@/features/victory'
import { routes } from '@/shared/config/routes'

const KINDS: VicKind[] = ['CHALLENGE', 'RUN', 'TOTAL_KM', 'LEVEL', 'BADGE']

// Màn thiết kế ảnh vinh danh: ?kind=…&ref=…[&user=…][&pick=1]
export default async function VictoryCreatePage({ searchParams }: PageProps<'/victory/create'>) {
  const sp = await searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
  const kind = one(sp.kind).toUpperCase() as VicKind
  const ref = one(sp.ref)
  if (!KINDS.includes(kind) || !ref) redirect(routes.victory)
  const user = one(sp.user) || null
  return <VictoryEditor key={`${kind}:${ref}:${user ?? ''}`} kind={kind} refId={ref} user={user} pick={one(sp.pick) === '1'} />
}
