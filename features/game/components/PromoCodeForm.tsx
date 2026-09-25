'use client'

import { useState } from 'react'
import { TicketPercent } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Input } from '@/shared/ui'
import { gameErrorMessage } from '../api/gameApi'
import { useRedeemPromo } from '../hooks/useGame'

/** Nhập mã khuyến mãi (Xu / lượt tạo / gói VIP) — mỗi mã dùng một lần mỗi tài khoản */
export function PromoCodeForm() {
  const [code, setCode] = useState('')
  const redeem = useRedeemPromo()
  const submit = async () => {
    try {
      const r = await redeem.mutateAsync(code.trim())
      const parts = [r.reward?.xu ? `${r.reward.xu} Xu` : null, r.reward?.passes ? `${r.reward.passes.qty} lượt tạo` : null,
        r.reward?.plan ? `gói ${r.reward.plan.code} ${r.reward.plan.months} tháng` : null].filter(Boolean)
      toast.success(`${r.title ?? 'Đã nhận khuyến mãi'}${parts.length ? ` — ${parts.join(', ')}` : ''}`)
      setCode('')
    } catch (e) {
      toast.error(gameErrorMessage(e))
    }
  }
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim().length >= 4) void submit() }}>
      <div className="relative flex-1">
        <TicketPercent className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
        <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24))}
          placeholder="Nhập mã khuyến mãi" aria-label="Mã khuyến mãi" className="pl-9 font-mono uppercase" />
      </div>
      <Button type="submit" variant="secondary" className="shrink-0" loading={redeem.isPending} disabled={code.trim().length < 4}>Dùng mã</Button>
    </form>
  )
}
