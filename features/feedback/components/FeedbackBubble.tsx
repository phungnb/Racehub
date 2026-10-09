'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { MessageSquareHeart, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Sheet, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { detectPlatform } from '@/features/pwa'
import { feedbackErrorMessage, submitFeedback } from '../api/feedbackApi'
import { FEEDBACK_KINDS, MAX_BODY, RATINGS, SHOW_DELAY_MS, bubbleVisible, canSubmit, type FeedbackKind } from '../model/feedback'

const SENT_KEY = 'rh_feedback_sent_at'
const DISMISS_KEY = 'rh_feedback_dismissed'
// Tắt bong bóng chỉ có hiệu lực trong lần mở app này: giữ ở bộ nhớ + sessionStorage (mở lại app là hiện lại)
let dismissedInMemory = false

function readSentAt(): number | null {
  try { const v = Number(localStorage.getItem(SENT_KEY)); return v > 0 ? v : null } catch { return null }
}
function readDismissed(): boolean {
  if (dismissedInMemory) return true
  try { return sessionStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
}

/**
 * Bong bóng "Góp ý" nổi ở góc trái dưới (trên thanh điều hướng): hiện sau vài giây khi mở app, chạm để mở hộp thư góp ý,
 * bấm × để tắt đến lần mở app sau. Gửi xong thì ẩn một thời gian.
 */
export function FeedbackBubble() {
  const pathname = usePathname()
  const [show, setShow] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!bubbleVisible(Date.now(), readDismissed(), readSentAt())) return
    const t = setTimeout(() => setShow(true), SHOW_DELAY_MS)
    return () => clearTimeout(t)
  }, [])

  const dismiss = () => {
    dismissedInMemory = true
    try { sessionStorage.setItem(DISMISS_KEY, '1') } catch { /* chế độ riêng tư: chỉ giữ trong bộ nhớ */ }
    setShow(false)
  }
  const sent = () => {
    try { localStorage.setItem(SENT_KEY, String(Date.now())) } catch { /* bỏ qua */ }
    setOpen(false)
    setShow(false)
  }

  return (
    <>
      {show && !open && (
        <div className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-3 z-40 flex items-center animate-pop sm:left-[max(0.75rem,calc(50vw-14rem+0.75rem))]">
          <button type="button" onClick={() => setOpen(true)} aria-label="Gửi góp ý cho RaceHub"
            className="flex h-11 items-center gap-2 rounded-full bg-brand pl-3.5 pr-9 text-sm font-bold text-brand-fg shadow-lg shadow-brand/30 hover:bg-brand-strong">
            <MessageSquareHeart className="size-5" aria-hidden />Góp ý
          </button>
          <button type="button" onClick={dismiss} aria-label="Tắt bong bóng góp ý"
            className="absolute right-1.5 grid size-7 place-items-center rounded-full text-brand-fg/80 hover:bg-black/15 hover:text-brand-fg">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}
      <FeedbackSheet open={open} onClose={() => setOpen(false)} page={pathname} onSent={sent} />
    </>
  )
}

function FeedbackSheet({ open, onClose, page, onSent }: { open: boolean; onClose: () => void; page: string; onSent: () => void }) {
  const [kind, setKind] = useState<FeedbackKind>('IDEA')
  const [rating, setRating] = useState<number | null>(null)
  const [body, setBody] = useState('')
  const send = useMutation({
    mutationFn: () => submitFeedback({
      kind, rating, body, page,
      platform: typeof navigator === 'undefined' ? 'web' : detectPlatform(navigator.userAgent, navigator.maxTouchPoints),
    }),
    onSuccess: () => { toast.success('Đã gửi góp ý — cảm ơn bạn!'); setRating(null); setBody(''); onSent() },
    onError: (e) => toast.error(feedbackErrorMessage(e)),
  })
  return (
    <Sheet open={open} onClose={onClose} title="Góp ý cho RaceHub" description="Bạn thấy RaceHub thế nào? Mọi góp ý đều được đội ngũ đọc."
      footer={<Button block loading={send.isPending} disabled={!canSubmit(rating, body)} onClick={() => send.mutate()}>Gửi góp ý</Button>}>
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-sm font-semibold">Mức hài lòng</p>
          <div className="flex justify-between gap-1" role="radiogroup" aria-label="Mức hài lòng">
            {RATINGS.map((r) => (
              <button key={r.value} type="button" role="radio" aria-checked={rating === r.value} aria-label={r.label}
                onClick={() => setRating(rating === r.value ? null : r.value)}
                className={cn('flex flex-1 flex-col items-center gap-0.5 rounded-xl border py-2 text-2xl transition-colors',
                  rating === r.value ? 'border-brand bg-brand/10' : 'border-border hover:border-fg-subtle')}>
                <span aria-hidden>{r.emoji}</span>
                <span className="text-[10px] font-medium text-fg-muted">{r.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-semibold">Bạn muốn nói về</p>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Loại góp ý">
            {FEEDBACK_KINDS.map((k) => (
              <button key={k.value} type="button" role="radio" aria-checked={kind === k.value} onClick={() => setKind(k.value)}
                className={cn('min-h-9 rounded-full border px-3 text-sm font-semibold transition-colors',
                  kind === k.value ? 'border-brand bg-brand text-brand-fg' : 'border-border text-fg-muted hover:text-fg')}>{k.label}</button>
            ))}
          </div>
        </div>
        <div>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={MAX_BODY} rows={4}
            placeholder="Điều bạn thích, chưa thích, hoặc muốn RaceHub có thêm…" aria-label="Nội dung góp ý" />
          <p className="mt-1 text-right text-xs text-fg-subtle">{body.length}/{MAX_BODY}</p>
        </div>
      </div>
    </Sheet>
  )
}
