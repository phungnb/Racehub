'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card } from '@/shared/ui'
import { listMembers } from '../../api/clubApi'

interface ScanResult { error?: string; message?: string; summary?: { imported: number }; nextPage?: number | null; rateLimited?: boolean }

const keyOf = (clubId: string) => `rh:club:${clubId}:strava-scan-2026`
const readDone = (clubId: string): string[] => { try { return JSON.parse(localStorage.getItem(keyOf(clubId)) ?? '[]') as string[] } catch { return [] } }
const writeDone = (clubId: string, ids: string[]) => { try { localStorage.setItem(keyOf(clubId), JSON.stringify(ids)) } catch { /* chế độ riêng tư */ } }

async function scan(clubId: string, userId: string, page: number): Promise<ScanResult> {
  const res = await fetch(`/api/clubs/${encodeURIComponent(clubId)}/strava-scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId, page }) })
  const body = await res.json().catch(() => ({})) as ScanResult
  if (res.status === 429) return { ...body, rateLimited: true }
  if (!res.ok) throw new Error(body.message ?? 'Không quét được Strava.')
  return body
}

/**
 * Ban quản trị: quét Strava từ 1/1/2026 cho từng thành viên đã nối Strava. Chạy tuần tự, nhớ người đã xong;
 * gặp hạn mức Strava (100 lượt / 15 phút) thì dừng, bấm "Quét tiếp" sau 15 phút. Người chưa nối Strava được bỏ qua.
 */
export function ClubStravaScan({ clubId, onDone }: { clubId: string; onDone?: () => void }) {
  const members = useQuery({ queryKey: ['club', clubId, 'members-scan'], queryFn: () => listMembers(clubId), staleTime: 5 * 60_000 })
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [, bump] = useState(0)
  const ids = (members.data ?? []).filter((m) => m.status === 'APPROVED').map((m) => m.user_id)
  if (!ids.length) return null
  const done = new Set(readDone(clubId))
  const left = ids.filter((id) => !done.has(id))
  if (!left.length) return null

  const run = async () => {
    setBusy(true)
    let imported = 0
    let skipped = 0
    try {
      for (const uid of left) {
        let page = 1
        for (;;) {
          setProgress(`Đang quét ${ids.length - left.length + left.indexOf(uid) + 1}/${ids.length} thành viên · nhập ${imported} bài`)
          const r = await scan(clubId, uid, page)
          if (r.rateLimited) { toast.warning('Strava đang giới hạn lượt truy cập. Bấm "Quét tiếp" sau 15 phút, người đã xong được nhớ.', { duration: 10000 }); onDone?.(); return }
          if (r.error) { skipped++; break }
          imported += r.summary?.imported ?? 0
          if (r.nextPage == null) break
          page = r.nextPage
        }
        done.add(uid)
        writeDone(clubId, [...done])
      }
      toast.success(`Đã quét xong cả CLB · nhập ${imported} bài chạy` + (skipped ? ` · bỏ qua ${skipped} người chưa nối Strava hoặc hết hạn` : ''))
      onDone?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Không quét được Strava.')
    } finally { setBusy(false); setProgress(''); bump((n) => n + 1) }
  }

  return (
    <Card className="space-y-2">
      <p className="flex items-center gap-2 text-sm font-bold"><Users className="size-4 text-brand" aria-hidden />Quét Strava cho cả CLB (ban quản trị)</p>
      <p className="text-xs text-fg-muted">Lấy toàn bộ bài chạy từ 1/1/2026 của các thành viên đã nối Strava, để Đại sảnh và Km năm đủ số liệu. Còn {left.length}/{ids.length} thành viên chưa quét. Strava giới hạn lượt gọi nên có thể phải quét tiếp sau 15 phút.</p>
      <Button size="sm" onClick={() => void run()} disabled={busy}>{busy ? progress || 'Đang quét…' : left.length < ids.length ? 'Quét tiếp' : 'Quét cả CLB'}</Button>
    </Card>
  )
}
