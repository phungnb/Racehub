'use client'

import { useState } from 'react'
import { ImageUp } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Field, Input, Skeleton, SwitchRow, Textarea } from '@/shared/ui'
import { useSetSupportCoffee, useSupportCoffeeAdmin } from '../hooks/useSystem'
import { systemApiErrorMessage, uploadSupportQr, type SupportCoffeeAdmin } from '../api/systemApi'

/** Quản trị → Hệ thống: sửa lời nhắn, ảnh QR và thông tin tài khoản trong biểu tượng ly cà phê */
export function SupportCoffeeEditor() {
  const q = useSupportCoffeeAdmin()
  if (q.isPending) return <Skeleton className="h-48" />
  return <Editor key={q.data?.updated_at ?? 'none'} current={q.data ?? null} />
}

const MAX_BYTES = 2 * 1024 * 1024

function Editor({ current }: { current: SupportCoffeeAdmin | null }) {
  const save = useSetSupportCoffee()
  const [enabled, setEnabled] = useState(current?.enabled ?? true)
  const [message, setMessage] = useState(current?.message ?? 'Nếu thấy RaceHub bổ ích, mời admin một ly cà phê nhé. Cảm ơn bạn!')
  const [qr, setQr] = useState(current?.qr_url ?? '')
  const [bank, setBank] = useState(current?.bank_name ?? '')
  const [no, setNo] = useState(current?.account_number ?? '')
  const [name, setName] = useState(current?.account_name ?? '')
  const [uploading, setUploading] = useState(false)

  const pick = async (f: File | undefined) => {
    if (!f) return
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return void toast.error('Chỉ nhận ảnh PNG, JPG hoặc WebP.')
    if (f.size > MAX_BYTES) return void toast.error('Ảnh tối đa 2 MB.')
    setUploading(true)
    try { setQr(await uploadSupportQr(f)); toast.success('Đã tải ảnh. Bấm Lưu để áp dụng.') } catch (e) { toast.error(systemApiErrorMessage(e)) } finally { setUploading(false) }
  }
  const submit = () => save.mutate(
    { enabled, message: message.trim() || null, qr_url: qr || null, bank_name: bank.trim() || null, account_number: no.trim() || null, account_name: name.trim() || null },
    { onSuccess: () => toast.success('Đã lưu'), onError: (e) => toast.error(systemApiErrorMessage(e)) })

  return (
    <div className="space-y-3">
      <p className="text-xs text-fg-muted">Người dùng bấm biểu tượng ly cà phê trên thanh trên cùng sẽ thấy lời nhắn, mã QR và thông tin tài khoản dưới đây. Để trống cả ba hoặc tắt công tắc thì biểu tượng ẩn.</p>
      <SwitchRow checked={enabled} onChange={setEnabled} label="Hiện biểu tượng ly cà phê" />
      <Field label="Lời nhắn" htmlFor="sc-msg"><Textarea id="sc-msg" rows={3} maxLength={300} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Ảnh QR ngân hàng</p>
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border p-2 text-sm">
          {/* eslint-disable-next-line @next/next/no-img-element -- xem trước QR vừa tải */}
          {qr ? <img src={qr} alt="" className="size-20 rounded-lg bg-white object-contain p-1" /> : <ImageUp className="size-6 text-fg-muted" aria-hidden />}
          <span className="text-fg-muted">{uploading ? 'Đang tải…' : qr ? 'Đổi ảnh QR' : 'Tải ảnh QR (PNG/JPG/WebP, tối đa 2 MB)'}</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={uploading}
            onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} />
        </label>
        {qr && <Button size="sm" variant="ghost" onClick={() => setQr('')}>Gỡ ảnh QR</Button>}
      </div>
      <Field label="Ngân hàng" htmlFor="sc-bank"><Input id="sc-bank" maxLength={80} value={bank} onChange={(e) => setBank(e.target.value)} placeholder="VD: Vietcombank" /></Field>
      <Field label="Số tài khoản" htmlFor="sc-no"><Input id="sc-no" inputMode="numeric" maxLength={40} value={no} onChange={(e) => setNo(e.target.value)} /></Field>
      <Field label="Chủ tài khoản" htmlFor="sc-name"><Input id="sc-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Button className="w-full" loading={save.isPending} disabled={uploading} onClick={submit}>Lưu</Button>
    </div>
  )
}
