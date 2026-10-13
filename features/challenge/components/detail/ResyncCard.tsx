'use client'

import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card } from '@/shared/ui'
import { isSystemAdmin } from '@/features/admin'
import { useMyProfile } from '@/features/auth'
import { challengeKeys } from '../../hooks/useChallenge'
import type { ChallengeDetail } from '../../api/challengeApi'

interface Member { user_id: string; name: string | null }
interface Targets { start_date: string; end_date: string; members: Member[]; not_connected: number }
interface MemberResult {
  summary?: { imported: number }
  nextPage?: number | null
  rateLimited?: boolean
  error?: string
  message?: string
}

const post = async <T,>(id: string, body: object): Promise<{ status: number; data: T & { message?: string } }> => {
  const res = await fetch(`/api/challenges/${id}/resync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, data: await res.json().catch(() => ({})) }
}

/**
 * "Đồng bộ lại dữ liệu": lấy lại bài Strava của từng thành viên từ ngày bắt đầu thử thách (đồng bộ thường chỉ lùi 30 ngày).
 * Chạy tuần tự từng thành viên, từng lô ≤ 300 bài; sắp chạm hạn mức Strava (100 lượt / 15 phút) thì dừng và cho bấm "Tiếp tục".
 */
export function ResyncChallengeCard({ d }: { d: ChallengeDetail }) {
  const c = d.challenge
  const { profile } = useMyProfile()
  const qc = useQueryClient()
  const [now] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState('')
  const [paused, setPaused] = useState(false)
  // Vị trí đang chạy dở: giữ lại khi dừng vì hạn mức để "Tiếp tục" chạy đúng chỗ
  const cursor = useRef<{ targets: Targets; idx: number; page: number; imported: number; failed: string[] } | null>(null)

  if (!(d.can_manage || isSystemAdmin(profile)) || c.status !== 'ACTIVE' || now < Date.parse(c.start_date)) return null

  const run = async () => {
    setBusy(true); setPaused(false)
    try {
      if (!cursor.current) {
        setText('Đang chuẩn bị…')
        const t = await post<Targets>(c.id, {})
        if (t.status !== 200) throw new Error(t.data.message ?? 'Không đồng bộ lại được.')
        cursor.current = { targets: t.data, idx: 0, page: 1, imported: 0, failed: [] }
      }
      const cur = cursor.current
      const { members } = cur.targets
      while (cur.idx < members.length) {
        const m = members[cur.idx]
        setText(`Đang lấy dữ liệu ${cur.idx + 1}/${members.length}: ${m.name ?? 'Thành viên'}…`)
        const r = await post<MemberResult>(c.id, { step: 'member', userId: m.user_id, page: cur.page })
        if (r.status === 429 || r.data.rateLimited) {
          // Hạn mức Strava là của cả ứng dụng: dừng, giữ nguyên vị trí (kể cả trang đang dở), chờ rồi tiếp tục
          if (r.data.summary) cur.imported += r.data.summary.imported
          if (r.data.nextPage) cur.page = r.data.nextPage
          setPaused(true)
          setText(`Strava đang giới hạn lượt truy cập — đã xong ${cur.idx}/${members.length} thành viên. Chờ khoảng 15 phút rồi bấm "Tiếp tục" (tiến độ được giữ lại).`)
          return
        }
        if (r.status !== 200 || r.data.error) {
          cur.failed.push(`${m.name ?? 'Thành viên'}: ${r.data.message ?? 'lỗi'}`)
          cur.idx++; cur.page = 1
          continue
        }
        cur.imported += r.data.summary?.imported ?? 0
        if (r.data.nextPage) cur.page = r.data.nextPage
        else { cur.idx++; cur.page = 1 }
        await new Promise((ok) => setTimeout(ok, 400))
      }
      setText('Đang tính lại vào thử thách…')
      const f = await post<{ applied?: number }>(c.id, { step: 'finish' })
      if (f.status !== 200) throw new Error(f.data.message ?? 'Không tính lại được vào thử thách.')
      const failed = cur.failed
      cursor.current = null
      void qc.invalidateQueries({ queryKey: challengeKeys.detail(c.id) })
      void qc.invalidateQueries({ queryKey: challengeKeys.leaderboard(c.id) })
      void qc.invalidateQueries({ queryKey: ['activities'] })
      setText(`Xong: nhận thêm ${cur.imported} bài từ Strava, cập nhật ${f.data.applied ?? 0} bài vào thử thách.` + (failed.length ? ` Không lấy được: ${failed.join('; ')}.` : ''))
      toast.success('Đã đồng bộ lại dữ liệu thử thách')
    } catch (e) {
      setText(e instanceof Error ? e.message : 'Không đồng bộ lại được. Thử lại sau.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="flex items-start gap-3">
      <RefreshCw className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
      <div className="min-w-0 flex-1 space-y-2 text-sm">
        <div>
          <p className="font-semibold">Đồng bộ lại dữ liệu</p>
          <p className="text-fg-muted">Lấy lại bài chạy Strava của thành viên từ ngày bắt đầu thử thách (kể cả khi đã quá 30 ngày). Chạy từng người, từng lô để không vượt hạn mức Strava.</p>
        </div>
        {text && <p className="text-fg-muted" role="status">{text}</p>}
        <Button size="sm" loading={busy} onClick={() => void run()}>{paused ? 'Tiếp tục' : 'Đồng bộ lại'}</Button>
      </div>
    </Card>
  )
}
