'use client'

import { useRef } from 'react'
import { Flame, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Sheet } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin } from '@/shared/lib/format'
import { gameErrorMessage } from '../api/gameApi'
import { useBuyShield, useSetWeeklyGoal } from '../hooks/useGame'
import type { StreakState } from '../model/game'

/** Đặt mục tiêu tuần + mua khiên giữ chuỗi */
export function StreakSheet({ open, onClose, streak, balance }: { open: boolean; onClose: () => void; streak: StreakState; balance: number }) {
  const setGoal = useSetWeeklyGoal()
  const buy = useBuyShield()
  const key = useRef(`shield-${crypto.randomUUID()}`)
  const full = streak.shields >= streak.max_shields
  const poor = balance < streak.shield_price

  const onBuy = async () => {
    try {
      await buy.mutateAsync(key.current)
      key.current = `shield-${crypto.randomUUID()}`
      toast.success('Đã thêm 1 khiên giữ chuỗi')
    } catch (e) {
      toast.error(gameErrorMessage(e))
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Chuỗi tuần" description="Mỗi tuần chạy đủ số ngày mục tiêu để nối dài chuỗi.">
      <div className="space-y-5">
        <div className="flex items-center gap-4 rounded-2xl bg-live/10 p-4">
          <Flame className="size-10 text-live" aria-hidden />
          <div>
            <p className="font-mono text-3xl font-bold">{streak.current} <span className="text-base font-semibold text-fg-muted">tuần</span></p>
            <p className="text-sm text-fg-muted">Kỷ lục {streak.best} tuần · {streak.daily} ngày chạy liên tiếp</p>
          </div>
        </div>

        <section className="space-y-2">
          <p className="text-sm font-semibold">Mục tiêu mỗi tuần</p>
          <div role="radiogroup" aria-label="Số ngày chạy mỗi tuần" className="grid grid-cols-7 gap-1.5">
            {[1, 2, 3, 4, 5, 6, 7].map((g) => (
              <button key={g} role="radio" aria-checked={streak.goal === g} disabled={setGoal.isPending}
                onClick={() => setGoal.mutate(g, { onError: (e) => toast.error(gameErrorMessage(e)) })}
                className={cn('h-11 rounded-xl border font-mono text-sm font-bold',
                  streak.goal === g ? 'border-brand bg-brand text-brand-fg' : 'border-border text-fg-muted')}>
                {g}
              </button>
            ))}
          </div>
          <p className="text-xs text-fg-subtle">Ngày chạy = ngày có ít nhất một bài chạy hợp lệ. Người mới nên bắt đầu với 2–3 ngày.</p>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Khiên giữ chuỗi</p>
            <span className="flex gap-1" aria-label={`${streak.shields}/${streak.max_shields} khiên`}>
              {Array.from({ length: streak.max_shields }, (_, i) => (
                <ShieldCheck key={i} className={cn('size-6', i < streak.shields ? 'text-xp' : 'text-border')} aria-hidden />
              ))}
            </span>
          </div>
          <p className="text-sm text-fg-muted">Tuần nào chưa đủ ngày, khiên tự dùng để chuỗi không bị đứt. Có tối đa {streak.max_shields} khiên.</p>
          <Button block variant="secondary" onClick={onBuy} loading={buy.isPending} disabled={full || poor}>
            {full ? 'Đã đủ khiên' : `Mua khiên · ${formatCoin(streak.shield_price)} Xu`}
          </Button>
          {!full && poor && <p className="text-center text-xs text-fg-subtle">Ví có {formatCoin(balance)} Xu — chạy thêm hoặc làm nhiệm vụ để kiếm Xu.</p>}
        </section>
      </div>
    </Sheet>
  )
}
