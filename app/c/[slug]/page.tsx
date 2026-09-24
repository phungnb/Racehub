'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ShieldX } from 'lucide-react'
import { resolveClubSlug } from '@/features/club'
import { Button, EmptyState } from '@/shared/ui'
import { routes } from '@/shared/config/routes'

// Link mời riêng của CLB Pro: /c/<slug> → trang vào CLB bằng mã mời (migration 002800)
export default function ClubSlugPage({ params }: PageProps<'/c/[slug]'>) {
  const { slug } = use(params)
  const router = useRouter()
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    let cancelled = false
    resolveClubSlug(slug)
      .then((code) => { if (!cancelled) { if (code) router.replace(`/club/join/${code}`); else setMissing(true) } })
      .catch(() => { if (!cancelled) setMissing(true) })
    return () => { cancelled = true }
  }, [slug, router])
  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-items-center p-6">
      {missing ? (
        <EmptyState icon={ShieldX} title="Link mời không còn hiệu lực" description="Hãy xin ban quản trị CLB link mời mới."
          action={<Button onClick={() => router.replace(routes.clubs)}>Tới danh sách CLB</Button>} />
      ) : <Loader2 className="size-8 animate-spin text-brand" aria-label="Đang mở CLB" />}
    </main>
  )
}
