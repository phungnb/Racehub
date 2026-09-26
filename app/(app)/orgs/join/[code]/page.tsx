import { JoinOrgScreen } from '@/features/org'

export default async function JoinOrgPage({ params }: PageProps<'/orgs/join/[code]'>) {
  const { code } = await params
  return <JoinOrgScreen code={decodeURIComponent(code)} />
}
