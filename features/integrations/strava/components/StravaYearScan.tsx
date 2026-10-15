'use client'

import { useState } from 'react'
import { History } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card } from '@/shared/ui'
import { useSession } from '@/features/auth'
import type { SyncSummary } from '../mapping'

interface ScanResult { summary: SyncSummary; nextPage: number | null; rateLimited: boolean }

const keyOf = (uid: string) => `rh:strava:year-scan-2026:${uid}`
const read = (uid: string) => { try { return localStorage.getItem(keyOf(uid)) } catch { return null } }
const write = (uid: string, v: string) => { try { localStorage.setItem(keyOf(uid), v) } catch { /* chế độ riêng tư */ } }

async function scanPage(page: number): Promise<ScanResult> {
  const res = await fetch('/api/strava/backfill-year', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page }) })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.message ?? 'Không quét được Strava.')
  return body as ScanResult
}

/**
 * Quét MỘT lần toàn bộ bài chạy Strava từ 1/1/2026 (đồng bộ thường chỉ lùi 30 ngày nên thiếu Full / Half cũ và Km năm).
 * Chia lô theo trang; gặp hạn mức Strava thì dừng và nhớ trang đang dở để bấm tiếp sau 15 phút. Xong thì thẻ tự ẩn.
 */
export function StravaYearScan({ onDone }: { onDone?: () => void }) {
  const uid = useSession().session?.user.id
  const [busy, setBusy] = useState(false)
  const [imported, setImported] = useState(0)
  const [finished, setFinished] = useState(false)
  if (!uid) return null
  const saved = read(uid)
  if (finished || saved === 'done') return null
  const resume = saved?.startsWith('page:') ? Number(saved.slice(5)) || 1 : 1

  const run = async () => {
    setBusy(true)
    let page = resume
    let total = imported
    try {
      for (;;) {
        const r = await scanPage(page)
        total += r.summary.imported
        setImported(total)
        if (r.nextPage === null) { write(uid, 'done'); setFinished(true); toast.success(`Đã quét xong Strava từ 1/1/2026 · nhập ${total} bài chạy`); onDone?.(); return }
        page = r.nextPage
        write(uid, `page:${page}`)
        if (r.rateLimited) { toast.warning('Strava đang giới hạn lượt truy cập. Bấm "Quét tiếp" sau 15 phút, tiến độ đã được nhớ.', { duration: 10000 }); onDone?.(); return }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Không quét được Strava.')
    } finally { setBusy(false) }
  }

  return (
    <Card className="space-y-2">
      <p className="flex items-center gap-2 text-sm font-bold"><History className="size-4 text-brand" aria-hidden />Quét Strava từ 1/1/2026</p>
      <p className="text-xs text-fg-muted">Đồng bộ thường chỉ lấy 30 ngày gần nhất nên thiếu các Full / Half cũ và Km năm. Quét một lần để lấy toàn bộ bài chạy từ đầu năm.</p>
      <Button size="sm" onClick={() => void run()} disabled={busy}>
        {busy ? `Đang quét… ${imported} bài` : resume > 1 ? 'Quét tiếp' : 'Quét toàn bộ'}
      </Button>
    </Card>
  )
}
