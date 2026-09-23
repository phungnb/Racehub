'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Card } from '@/shared/ui'
import { routes } from '@/shared/config/routes'
import { checkinEvent, eventsErrorMessage } from '../../api/eventsApi'

/** Trang mở ra khi quét QR điểm danh bằng camera điện thoại: tự điểm danh một lần rồi báo kết quả */
export function EventCheckinScreen({ clubId, eventId, token }: { clubId: string; eventId: string; token: string | null }) {
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'ok'; title: string; again: boolean } | { kind: 'error'; message: string }>(
    token ? { kind: 'loading' } : { kind: 'error', message: 'Link điểm danh thiếu mã. Hãy quét lại mã QR.' })
  const ran = useRef(false)
  const qc = useQueryClient()

  useEffect(() => {
    if (!token || ran.current) return
    ran.current = true
    checkinEvent(token)
      .then((r) => {
        setState({ kind: 'ok', title: r.title, again: !r.new })
        void qc.invalidateQueries({ queryKey: ['club-event', eventId] })
        void qc.invalidateQueries({ queryKey: ['club', clubId] })
      })
      .catch((e) => setState({ kind: 'error', message: eventsErrorMessage(e) }))
  }, [token, eventId, clubId, qc])

  const detail = `${routes.club(clubId)}/events/${eventId}`
  return (
    <Card className="flex flex-col items-center gap-3 py-10 text-center">
      {state.kind === 'loading' ? (
        <><Loader2 className="size-12 animate-spin text-brand" aria-hidden /><p className="font-semibold">Đang điểm danh…</p></>
      ) : state.kind === 'ok' ? (
        <>
          <CheckCircle2 className="size-14 text-brand" aria-hidden />
          <p className="text-xl font-bold">{state.again ? 'Bạn đã điểm danh rồi' : 'Điểm danh thành công!'}</p>
          <p className="text-sm text-fg-muted">{state.title}</p>
          <Link href={detail}><Button>Xem buổi chạy</Button></Link>
        </>
      ) : (
        <>
          <XCircle className="size-14 text-danger" aria-hidden />
          <p className="text-xl font-bold">Chưa điểm danh được</p>
          <p className="max-w-xs text-sm text-fg-muted">{state.message}</p>
          <Link href={detail}><Button variant="secondary">Về buổi chạy</Button></Link>
        </>
      )}
    </Card>
  )
}
