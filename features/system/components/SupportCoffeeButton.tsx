'use client'

import { useState } from 'react'
import { Coffee, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Sheet } from '@/shared/ui'
import { useSupportCoffee } from '../hooks/useSystem'

/** Biểu tượng ly cà phê trên thanh trên cùng: bấm để xem lời nhắn, mã QR và tài khoản ngân hàng do admin đặt. Ẩn khi admin chưa đặt / tắt. */
export function SupportCoffeeButton() {
  const { data } = useSupportCoffee()
  const [open, setOpen] = useState(false)
  if (!data) return null
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success('Đã sao chép số tài khoản') } catch { toast.error('Không sao chép được') }
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Mời admin ly cà phê"
        className="grid size-11 place-items-center rounded-full text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg">
        <Coffee className="size-5" aria-hidden />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Mời admin ly cà phê">
        <div className="space-y-4 text-center">
          {data.message && <p className="whitespace-pre-line text-sm text-fg-muted">{data.message}</p>}
          {data.qr_url && (
            // eslint-disable-next-line @next/next/no-img-element -- QR do admin tải lên, kích thước tuỳ ảnh
            <img src={data.qr_url} alt="Mã QR chuyển khoản ngân hàng" className="mx-auto max-h-72 w-auto max-w-full rounded-xl border border-border bg-white p-2" />
          )}
          {(data.bank_name || data.account_number || data.account_name) && (
            <dl className="space-y-1 rounded-xl bg-surface-2 p-3 text-sm">
              {data.bank_name && <div className="flex justify-between gap-3"><dt className="text-fg-muted">Ngân hàng</dt><dd className="font-semibold">{data.bank_name}</dd></div>}
              {data.account_number && (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-fg-muted">Số tài khoản</dt>
                  <dd className="flex items-center gap-1 font-mono font-semibold">
                    {data.account_number}
                    <button type="button" onClick={() => void copy(data.account_number!)} aria-label="Sao chép số tài khoản"
                      className="grid size-8 place-items-center rounded-full text-fg-muted hover:bg-surface hover:text-fg"><Copy className="size-4" aria-hidden /></button>
                  </dd>
                </div>
              )}
              {data.account_name && <div className="flex justify-between gap-3"><dt className="text-fg-muted">Chủ tài khoản</dt><dd className="font-semibold">{data.account_name}</dd></div>}
            </dl>
          )}
        </div>
      </Sheet>
    </>
  )
}
