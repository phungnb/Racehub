'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2, Send } from 'lucide-react'
import { Button, Field, Input, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { orgErrorMessage, requestQuote, type OrgKind } from '../api/orgApi'
import { KIND_LABEL } from '../model/org'

/** Form yêu cầu báo giá gói Doanh nghiệp — gửi được khi chưa đăng nhập */
export function QuoteForm({ className }: { className?: string }) {
  const [f, setF] = useState({ contact_name: '', org_name: '', kind: 'COMPANY' as OrgKind, size: '', phone: '', email: '', note: '' })
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch })
  const send = useMutation({
    mutationFn: () => requestQuote({ ...f, size: f.size ? Number(f.size) : null }),
  })
  if (send.isSuccess) {
    return (
      <div className={cn('rounded-2xl border border-brand/40 bg-brand/10 p-5 text-center', className)}>
        <CheckCircle2 className="mx-auto size-10 text-brand" aria-hidden />
        <p className="mt-2 font-bold">Đã nhận yêu cầu</p>
        <p className="text-sm text-fg-muted">RaceHub sẽ gọi lại trong 1 ngày làm việc để tư vấn và gửi báo giá.</p>
      </div>
    )
  }
  const valid = f.contact_name.trim().length >= 2 && f.org_name.trim().length >= 2 && /^[0-9+ .()-]{8,20}$/.test(f.phone.trim())
  return (
    <form className={cn('space-y-3', className)} onSubmit={(e) => { e.preventDefault(); if (valid) send.mutate() }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Người liên hệ" htmlFor="q-name"><Input id="q-name" value={f.contact_name} maxLength={80} onChange={(e) => set({ contact_name: e.target.value })} autoComplete="name" /></Field>
        <Field label="Số điện thoại" htmlFor="q-phone"><Input id="q-phone" inputMode="tel" value={f.phone} maxLength={20} onChange={(e) => set({ phone: e.target.value })} autoComplete="tel" /></Field>
      </div>
      <Field label="Tên doanh nghiệp / tổ chức" htmlFor="q-org"><Input id="q-org" value={f.org_name} maxLength={120} onChange={(e) => set({ org_name: e.target.value })} autoComplete="organization" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Loại hình" htmlFor="q-kind">
          <select id="q-kind" value={f.kind} onChange={(e) => set({ kind: e.target.value as OrgKind })}
            className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-[15px]">
            {(Object.keys(KIND_LABEL) as OrgKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label="Số người dự kiến" htmlFor="q-size"><Input id="q-size" inputMode="numeric" value={f.size} onChange={(e) => set({ size: e.target.value.replace(/\D/g, '').slice(0, 7) })} placeholder="200" /></Field>
      </div>
      <Field label="Email (không bắt buộc)" htmlFor="q-email"><Input id="q-email" type="email" value={f.email} maxLength={120} onChange={(e) => set({ email: e.target.value })} autoComplete="email" /></Field>
      <Field label="Nhu cầu" htmlFor="q-note">
        <Textarea id="q-note" value={f.note} maxLength={1000} onChange={(e) => set({ note: e.target.value })}
          placeholder="VD: Giải chạy nội bộ 3 tháng cho 300 nhân viên, xếp hạng theo phòng ban, báo cáo cho phòng nhân sự." />
      </Field>
      {send.isError && <p role="alert" className="text-sm text-danger">{orgErrorMessage(send.error)}</p>}
      <Button type="submit" block loading={send.isPending} disabled={!valid}><Send className="size-4" aria-hidden />Gửi yêu cầu báo giá</Button>
      <p className="text-center text-xs text-fg-subtle">Thông tin chỉ dùng để RaceHub liên hệ tư vấn, không chia sẻ cho bên thứ ba.</p>
    </form>
  )
}
