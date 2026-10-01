'use client'

import { useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/ui'
import { formatCoin } from '@/shared/lib/format'
import { useInvalidateProfile } from '@/features/auth'
import { SKIP_REASON_LABEL, type SyncSummary } from '../mapping'

/** null = vừa đồng bộ xong trong 1 phút qua (máy khác / webhook vừa chạy) — không phải lỗi, không cần làm gì */
async function syncNow(): Promise<SyncSummary | null> {
  const res = await fetch('/api/strava/sync', { method: 'POST' })
  const body = await res.json().catch(() => ({}))
  if (res.status === 429 && body?.error === 'TOO_SOON') return null
  if (!res.ok) throw new Error(body?.message ?? 'Không đồng bộ được Strava.')
  return body as SyncSummary
}

/** Tự đồng bộ ngầm khi mở / quay lại app nếu lần trước đã quá khoảng này (dự phòng khi webhook Strava chậm hoặc lỗi) */
const AUTO_SYNC_MS = 3 * 60_000
const LAST_KEY = 'rh:strava:auto-sync'

function useStravaRefresh() {
  const qc = useQueryClient()
  const invalidateProfile = useInvalidateProfile()
  return () => { void qc.invalidateQueries({ queryKey: ['activities'] }); invalidateProfile() }
}

/** Đồng bộ ngầm khi mở / quay lại app (không hiện gì) — đặt ở Trang chủ khi đã kết nối Strava */
export function StravaAutoSync() {
  const refresh = useStravaRefresh()
  // Chỉ báo khi có bài mới, lỗi thì im lặng (người dùng vẫn bấm Đồng bộ ở trang Tôi được)
  const auto = useMutation({
    mutationFn: syncNow,
    onSuccess: (s) => {
      if (s && s.imported > 0) {
        refresh()
        toast.success(`Đã nhận ${s.imported} bài chạy mới từ Strava` + (s.earned_xu > 0 ? ` · +${formatCoin(s.earned_xu)} Xu` : ''))
      }
    },
  })
  const autoRef = useRef(auto.mutate)
  useEffect(() => { autoRef.current = auto.mutate })
  useEffect(() => {
    const maybeSync = () => {
      if (document.visibilityState !== 'visible') return
      let last = 0
      try { last = Number(localStorage.getItem(LAST_KEY) ?? 0) } catch { /* chế độ riêng tư */ }
      if (Date.now() - last < AUTO_SYNC_MS) return
      try { localStorage.setItem(LAST_KEY, String(Date.now())) } catch { /* bỏ qua */ }
      autoRef.current()
    }
    maybeSync()
    document.addEventListener('visibilitychange', maybeSync)
    return () => document.removeEventListener('visibilitychange', maybeSync)
  }, [])
  return null
}

/** Nút "Đồng bộ" Strava (trang Tôi → Thiết bị & nguồn dữ liệu, cạnh nút Ngắt) */
export function StravaSyncButton() {
  const refresh = useStravaRefresh()
  const m = useMutation({
    mutationFn: syncNow,
    onSuccess: (s) => {
      if (!s) { toast.info('Vừa đồng bộ xong — bài chạy mới nhất đã có trong app. Thử lại sau 1 phút nếu cần.'); return }
      refresh()
      const skipped = Object.entries(s.skip_reasons ?? {}).map(([k, n]) => `${n} bài ${SKIP_REASON_LABEL[k] ?? 'không hợp lệ'}`)
      if (s.imported === 0) {
        if (skipped.length) toast.warning(`Không nhập bài nào: ${skipped.join('; ')}.`, { duration: 10000 })
        else toast.info('Không có bài chạy mới trên Strava. Bài vừa chạy có thể cần vài phút để Strava xử lý xong.')
      } else {
        toast.success(
          `Đã nhập ${s.imported} bài chạy` +
            (s.earned_xu > 0 ? ` · +${formatCoin(s.earned_xu)} Xu` : '') +
            (s.pending > 0 ? ` · ${s.pending} bài chờ xác minh` : '') +
            (skipped.length ? ` · bỏ qua ${skipped.join('; ')}` : ''),
        )
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Không đồng bộ được Strava.'),
  })
  return (
    <Button size="sm" variant="secondary" loading={m.isPending} onClick={() => m.mutate()}>
      {!m.isPending && <RefreshCw className="size-4" aria-hidden />} Đồng bộ
    </Button>
  )
}
