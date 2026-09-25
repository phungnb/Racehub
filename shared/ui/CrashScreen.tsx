'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Home, RotateCw } from 'lucide-react'
import { describeError } from '@/shared/lib/errors'
import { reportError } from '@/shared/lib/reportError'
import { Button } from './Button'

/** Màn hình khi một trang bị lỗi không mong muốn (dùng trong error.tsx) — báo rõ, cho thử lại / về trang chủ, kèm mã lỗi */
export function CrashScreen({ error, retry, compact }: { error: Error & { digest?: string }; retry: () => void; compact?: boolean }) {
  const router = useRouter()
  const d = describeError(error)
  useEffect(() => {
    console.error('[RaceHub] Lỗi trang:', error)
    reportError(error)
  }, [error])
  const system = d.kind !== 'UNKNOWN'
  return (
    <div role="alert" className={compact ? 'flex flex-col items-center gap-3 py-12 text-center' : 'grid min-h-dvh place-items-center p-6 text-center'}>
      <div className="flex max-w-sm flex-col items-center gap-3">
        <div className="grid size-14 place-items-center rounded-full bg-danger/10"><AlertTriangle className="size-7 text-danger" aria-hidden /></div>
        <h1 className="text-lg font-bold">{system ? d.title : 'Trang này gặp sự cố'}</h1>
        <p className="text-sm text-fg-muted">
          {system ? d.message : 'Đã có lỗi khi hiển thị trang. Bấm "Thử lại"; nếu vẫn lỗi, về trang chủ và gửi mã lỗi bên dưới cho đội ngũ RaceHub.'}
        </p>
        <div className="mt-1 flex gap-2">
          <Button onClick={() => retry()}><RotateCw className="size-4" aria-hidden />Thử lại</Button>
          <Button variant="secondary" onClick={() => router.push('/feed')}><Home className="size-4" aria-hidden />Trang chủ</Button>
        </div>
        <p className="font-mono text-[11px] text-fg-subtle">Mã lỗi {d.code}{error.digest ? ` · ${error.digest}` : ''}</p>
      </div>
    </div>
  )
}
