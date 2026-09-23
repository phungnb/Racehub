'use client'

import { useRef, useState } from 'react'
import { HandCoins } from 'lucide-react'
import { toast } from 'sonner'
import { useMyProfile } from '@/features/auth'
import { Avatar, Button, Field, Input, Sheet } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin } from '@/shared/lib/format'
import { gameErrorMessage } from '../api/gameApi'
import { useSendCheer } from '../hooks/useGame'

const AMOUNTS = [1, 2, 5, 10]
const QUICK = ['Cố lên!', 'Đỉnh quá!', 'Pace đẹp quá!', 'Chạy bền thật!']

/** Nút "Tặng Xu" — cổ vũ có giá trị (Module 4 · FR32–33). Ẩn khi là bài của chính mình. */
export function CheerButton({ toUser, toName, toAvatar, postId, activityId, total, className }: {
  toUser: string; toName: string; toAvatar?: string | null; postId?: string | null; activityId?: string | null
  total?: number; className?: string
}) {
  const { profile } = useMyProfile()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(2)
  const [msg, setMsg] = useState('')
  const key = useRef(`cheer-${crypto.randomUUID()}`)
  const send = useSendCheer()
  if (!profile || profile.id === toUser) return null
  const balance = Number(profile.xu ?? 0)

  const submit = async () => {
    try {
      await send.mutateAsync({ toUser, amount, message: msg.trim(), postId, activityId, key: key.current })
      key.current = `cheer-${crypto.randomUUID()}`
      toast.success(`Đã cổ vũ ${toName} ${amount} Xu`)
      setOpen(false); setMsg('')
    } catch (e) {
      toast.error(gameErrorMessage(e))
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className={cn('flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-coin transition-colors hover:bg-surface-2', className)}>
        <HandCoins className="size-5" aria-hidden />Tặng Xu
        {!!total && total > 0 && <span className="font-mono tabular">{formatCoin(total)}</span>}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Cổ vũ bằng Xu" description="Người nhận được toàn bộ số Xu và cả hai cùng nhận XP."
        footer={
          <Button block size="lg" variant="coin" onClick={submit} loading={send.isPending} disabled={balance < amount}>
            <HandCoins className="size-5" aria-hidden />Tặng {amount} Xu
          </Button>
        }>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar src={toAvatar} name={toName} size="md" />
            <p className="font-semibold">{toName}</p>
          </div>
          <div role="radiogroup" aria-label="Số Xu" className="grid grid-cols-4 gap-2">
            {AMOUNTS.map((a) => (
              <button key={a} role="radio" aria-checked={amount === a} onClick={() => setAmount(a)}
                className={cn('h-14 rounded-xl border font-mono text-lg font-bold', amount === a ? 'border-coin bg-coin/15 text-coin' : 'border-border text-fg-muted')}>
                {a}
              </button>
            ))}
          </div>
          <p className={cn('text-xs', balance < amount ? 'text-danger' : 'text-fg-subtle')}>Ví của bạn: {formatCoin(balance)} Xu</p>
          <Field label="Lời nhắn (không bắt buộc)" htmlFor="cheer-msg">
            <Input id="cheer-msg" value={msg} maxLength={140} onChange={(e) => setMsg(e.target.value)} placeholder="Cố lên!" />
          </Field>
          <div className="flex flex-wrap gap-2">
            {QUICK.map((m) => (
              <button key={m} onClick={() => setMsg(m)} className="rounded-full border border-border px-3 py-1.5 text-xs text-fg-muted hover:text-fg">{m}</button>
            ))}
          </div>
        </div>
      </Sheet>
    </>
  )
}
