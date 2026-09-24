'use client'

import { useMemo, useState } from 'react'
import {
  AlertCircle, Banknote, BellRing, Building2, CheckCircle2, Clock, Copy, Download, FileImage, HandCoins, Lock, Pencil, Plus,
  QrCode, ReceiptText, Trash2, Undo2, Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { useMyProfile, useSession } from '@/features/auth'
import { Avatar, Button, Card, EmptyState, ErrorState, Field, Input, SectionTitle, SegmentedControl, Sheet, Skeleton, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatRelative } from '@/shared/lib/format'
import {
  addCashEntry, claimDue, closeDue, createDue, eventsErrorMessage, remindDue, setBank, setBankQr, setDuePayment, uploadReceipt, voidCashEntry,
  type ClubDue, type ClubFinance as Finance, type DueStatus,
} from '../../api/eventsApi'
import { useClub } from '../../hooks/useClub'
import { useClubMutation, useDue, useFinance } from '../../hooks/useEvents'
import { BANKS, bankName, cashCsv, formatVnd, parseVnd, transferNote, vietQrUrl, type CashEntry } from '../../model/finance'

const STATUS: Record<DueStatus, { label: string; tone: string }> = {
  UNPAID: { label: 'Chưa đóng', tone: 'bg-surface-2 text-fg-muted' },
  CLAIMED: { label: 'Chờ xác nhận', tone: 'bg-coin/15 text-coin' },
  CONFIRMED: { label: 'Đã đóng', tone: 'bg-brand/15 text-brand' },
  EXEMPT: { label: 'Miễn', tone: 'bg-surface-2 text-fg-subtle' },
}

const copy = async (text: string, what: string) => {
  try { await navigator.clipboard.writeText(text); toast.success(`Đã sao chép ${what}`) } catch { toast.error('Không sao chép được') }
}

/** Thu chi tiền VND của CLB: số dư, tài khoản nhận (VietQR), kỳ thu phí, sổ thu chi công khai */
export function ClubFinance({ clubId, openDue }: { clubId: string; openDue?: string | null }) {
  const q = useFinance(clubId)
  const [dueId, setDueId] = useState<string | null>(openDue ?? null)
  const [sheet, setSheet] = useState<'due' | 'entry' | 'bank' | null>(null)

  if (q.isPending) return <div className="space-y-3"><Skeleton className="h-40" /><Skeleton className="h-24" /><Skeleton className="h-60" /></div>
  if (q.isError) return <ErrorState message={eventsErrorMessage(q.error)} onRetry={() => void q.refetch()} />
  const f = q.data

  return (
    <div className="space-y-6">
      <Card className="space-y-4 bg-gradient-to-br from-brand/10 to-transparent">
        <div className="flex items-center gap-2 text-sm text-fg-muted"><Wallet className="size-4" aria-hidden />Quỹ tiền mặt CLB</div>
        <p className="font-mono text-4xl font-black tabular">{formatVnd(f.balance)}</p>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl bg-surface-2 p-2.5"><p className="text-xs text-fg-subtle">Thu 30 ngày</p><p className="font-mono font-bold text-brand">+{formatVnd(f.income_30d)}</p></div>
          <div className="rounded-xl bg-surface-2 p-2.5"><p className="text-xs text-fg-subtle">Chi 30 ngày</p><p className="font-mono font-bold text-danger">−{formatVnd(f.expense_30d)}</p></div>
        </div>
        {f.can_manage && (
          <div className="flex gap-2">
            <Button block onClick={() => setSheet('due')}><HandCoins className="size-4" aria-hidden />Thu phí</Button>
            <Button block variant="secondary" onClick={() => setSheet('entry')}><Plus className="size-4" aria-hidden /><span className="whitespace-nowrap">Thu / chi</span></Button>
          </div>
        )}
      </Card>

      <BankCard finance={f} onEdit={() => setSheet('bank')} />

      <section>
        <SectionTitle>Kỳ thu phí</SectionTitle>
        {f.dues.length === 0 ? (
          <EmptyState icon={HandCoins} title="Chưa có kỳ thu phí" description={f.can_manage ? 'Tạo kỳ thu (phí tháng, áo CLB…), thành viên chuyển khoản bằng mã VietQR.' : undefined} />
        ) : (
          <ul className="space-y-2">{f.dues.map((d) => <li key={d.id}><DueCard due={d} onOpen={() => setDueId(d.id)} /></li>)}</ul>
        )}
      </section>

      <Ledger clubId={clubId} entries={f.entries} canManage={f.can_manage} />

      {sheet === 'due' && <CreateDueSheet clubId={clubId} onClose={() => setSheet(null)} />}
      {sheet === 'entry' && <EntrySheet clubId={clubId} onClose={() => setSheet(null)} />}
      {sheet === 'bank' && <BankSheet clubId={clubId} bank={f.bank} qrUrl={f.bank_qr_url} onClose={() => setSheet(null)} />}
      {dueId && <DueSheet clubId={clubId} dueId={dueId} finance={f} onClose={() => setDueId(null)} />}
    </div>
  )
}

function BankCard({ finance: f, onEdit }: { finance: Finance; onEdit: () => void }) {
  const [zoom, setZoom] = useState(false)
  if (!f.bank && !f.bank_qr_url) {
    return f.can_manage ? (
      <button type="button" onClick={onEdit} className="flex w-full items-center gap-3 rounded-[var(--radius-card)] border-2 border-dashed border-border p-4 text-left hover:border-fg-subtle">
        <Building2 className="size-6 text-fg-subtle" aria-hidden />
        <span><span className="block font-semibold">Thêm tài khoản nhận tiền</span><span className="block text-xs text-fg-muted">Số tài khoản hoặc ảnh mã QR để thành viên chuyển khoản</span></span>
      </button>
    ) : null
  }
  return (
    <Card className="flex items-center gap-3">
      {f.bank_qr_url ? (
        <button type="button" onClick={() => setZoom(true)} aria-label="Xem mã QR nhận tiền" className="shrink-0 overflow-hidden rounded-xl border border-border bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element -- ảnh QR CLB trên Supabase Storage */}
          <img src={f.bank_qr_url} alt="" className="size-14 object-contain" />
        </button>
      ) : (
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2"><Building2 className="size-5 text-fg-muted" aria-hidden /></span>
      )}
      <div className="min-w-0 flex-1">
        {f.bank ? (
          <>
            <p className="text-xs text-fg-subtle">{bankName(f.bank.bin)}</p>
            <p className="font-mono font-bold">{f.bank.account_no}</p>
            <p className="truncate text-xs text-fg-muted">{f.bank.account_name}</p>
          </>
        ) : (
          <><p className="font-semibold">Mã QR nhận tiền</p><p className="text-xs text-fg-muted">Bấm vào ảnh để xem lớn và quét</p></>
        )}
      </div>
      {f.bank && <Button size="sm" variant="secondary" aria-label="Sao chép số tài khoản" onClick={() => void copy(f.bank!.account_no, 'số tài khoản')}><Copy className="size-4" aria-hidden /></Button>}
      {f.can_manage && <Button size="sm" variant="secondary" aria-label="Sửa tài khoản" onClick={onEdit}><Pencil className="size-4" aria-hidden /></Button>}
      {zoom && f.bank_qr_url && (
        <Sheet open onClose={() => setZoom(false)} title="Mã QR nhận tiền của CLB" description="Mở app ngân hàng / ví → Quét mã">
          {/* eslint-disable-next-line @next/next/no-img-element -- ảnh QR CLB trên Supabase Storage */}
          <img src={f.bank_qr_url} alt="Mã QR nhận tiền" className="mx-auto w-full max-w-xs rounded-xl bg-white p-2" />
        </Sheet>
      )}
    </Card>
  )
}

function DueCard({ due: d, onOpen }: { due: ClubDue; onOpen: () => void }) {
  const pct = d.total ? Math.round((d.confirmed / d.total) * 100) : 0
  return (
    <button type="button" onClick={onOpen} className={cn('w-full space-y-2 rounded-[var(--radius-card)] border border-border bg-surface p-3 text-left hover:border-fg-subtle', d.closed && 'opacity-70')}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{d.title}</p>
          <p className="text-xs text-fg-subtle">{formatVnd(d.amount_vnd)} / người{d.due_date ? ` · hạn ${new Date(d.due_date).toLocaleDateString('vi-VN')}` : ''}{d.closed ? ' · đã đóng kỳ' : ''}</p>
        </div>
        {d.my_status && <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold', STATUS[d.my_status].tone)}>{STATUS[d.my_status].label}</span>}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} /></div>
      <p className="text-xs text-fg-muted">{d.confirmed}/{d.total} đã đóng{d.claimed ? ` · ${d.claimed} chờ xác nhận` : ''}</p>
    </button>
  )
}

function DueSheet({ clubId, dueId, finance, onClose }: { clubId: string; dueId: string; finance: Finance; onClose: () => void }) {
  const q = useDue(dueId)
  const { club } = useClub(clubId)
  const { profile } = useMyProfile()
  const claim = useClubMutation(clubId, () => claimDue(dueId))
  const remind = useClubMutation(clubId, () => remindDue(dueId))
  const close = useClubMutation(clubId, (v: boolean) => closeDue(dueId, v))
  const d = q.data
  const note = d && club ? transferNote(club.name, d.title, profile?.display_name ?? '') : ''
  // Ảnh QR ban quản trị tải lên được ưu tiên; không có thì tự tạo VietQR (điền sẵn số tiền + nội dung)
  const qr = d && !finance.bank_qr_url && finance.bank ? vietQrUrl(finance.bank, d.amount_vnd, note) : null
  const pay = d?.my_status === 'UNPAID' || d?.my_status === 'CLAIMED'

  return (
    <Sheet open onClose={onClose} title={d?.title ?? 'Kỳ thu phí'} description={d ? `${formatVnd(d.amount_vnd)} / người${d.due_date ? ` · hạn ${new Date(d.due_date).toLocaleDateString('vi-VN')}` : ''}` : undefined}>
      {q.isPending ? <Skeleton className="h-80" /> : q.isError || !d ? <ErrorState message={eventsErrorMessage(q.error)} onRetry={() => void q.refetch()} /> : (
        <div className="space-y-5">
          {d.note && <p className="text-sm text-fg-muted">{d.note}</p>}
          {d.my_status && (
            <div className="space-y-3 rounded-2xl border border-border p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Của bạn</p>
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', STATUS[d.my_status].tone)}>{STATUS[d.my_status].label}</span>
              </div>
              {pay && !d.closed && (finance.bank_qr_url ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element -- ảnh QR CLB trên Supabase Storage */}
                  <img src={finance.bank_qr_url} alt="Mã QR nhận tiền của CLB" className="mx-auto w-60 rounded-xl bg-white p-2" />
                  <p className="text-center text-xs text-fg-muted">
                    Mở app ngân hàng → Quét QR → nhập <b className="text-fg">{formatVnd(d.amount_vnd)}</b> và dán nội dung chuyển khoản.
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" block onClick={() => void copy(note, 'nội dung')}><Copy className="size-4" aria-hidden />Nội dung CK</Button>
                    <Button size="sm" variant="secondary" block onClick={() => void copy(String(d.amount_vnd), 'số tiền')}><Copy className="size-4" aria-hidden />Số tiền</Button>
                  </div>
                </>
              ) : qr ? (
                <>
                  <QrImage src={qr} bank={finance.bank!} />
                  <p className="text-center text-xs text-fg-muted">Mở app ngân hàng → Quét QR. Số tiền và nội dung đã điền sẵn.</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" block onClick={() => void copy(note, 'nội dung')}><Copy className="size-4" aria-hidden />Nội dung CK</Button>
                    <Button size="sm" variant="secondary" block onClick={() => void copy(String(d.amount_vnd), 'số tiền')}><Copy className="size-4" aria-hidden />Số tiền</Button>
                  </div>
                </>
              ) : (
                <p className="flex items-start gap-2 text-sm text-fg-muted"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />CLB chưa có tài khoản nhận tiền. Hãy đóng trực tiếp cho thủ quỹ.</p>
              ))}
              {d.my_status === 'UNPAID' && !d.closed && (
                <Button block loading={claim.isPending}
                  onClick={() => claim.mutate(undefined, { onSuccess: () => toast.success('Đã báo thủ quỹ. Chờ xác nhận nhé!'), onError: (e) => toast.error(eventsErrorMessage(e)) })}>
                  <CheckCircle2 className="size-4" aria-hidden />Tôi đã chuyển khoản
                </Button>
              )}
              {d.my_status === 'CLAIMED' && <p className="flex items-center gap-1.5 text-xs text-coin"><Clock className="size-3.5" aria-hidden />Thủ quỹ sẽ kiểm tra tài khoản và xác nhận.</p>}
            </div>
          )}

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Thành viên · {d.members.filter((m) => m.status === 'CONFIRMED').length}/{d.members.filter((m) => m.status !== 'EXEMPT').length} đã đóng</p>
              {finance.can_manage && !d.closed && (
                <Button size="sm" variant="secondary" loading={remind.isPending}
                  onClick={() => remind.mutate(undefined, { onSuccess: (n) => toast.success(`Đã nhắc ${n} người chưa đóng`), onError: (e) => toast.error(eventsErrorMessage(e)) })}>
                  <BellRing className="size-4" aria-hidden />Nhắc
                </Button>
              )}
            </div>
            <ul className="divide-y divide-border rounded-2xl border border-border">
              {d.members.map((m) => (
                <li key={m.user_id} className="flex items-center gap-2.5 px-3 py-2">
                  <Avatar src={m.avatar_url} name={m.display_name ?? 'Runner'} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{m.display_name ?? 'Runner'}</span>
                    <span className={cn('inline-block rounded-full px-1.5 text-[12px] font-semibold', STATUS[m.status].tone)}>{STATUS[m.status].label}</span>
                  </span>
                  {finance.can_manage && !d.closed && <PaymentActions clubId={clubId} dueId={d.id} userId={m.user_id} status={m.status} />}
                </li>
              ))}
            </ul>
          </section>

          {finance.can_manage && (
            <Button variant="secondary" block loading={close.isPending}
              onClick={() => close.mutate(!d.closed, { onSuccess: () => toast.success(d.closed ? 'Đã mở lại kỳ thu' : 'Đã đóng kỳ thu'), onError: (e) => toast.error(eventsErrorMessage(e)) })}>
              <Lock className="size-4" aria-hidden />{d.closed ? 'Mở lại kỳ thu' : 'Đóng kỳ thu'}
            </Button>
          )}
        </div>
      )}
    </Sheet>
  )
}

/** Ảnh VietQR; mạng chặn img.vietqr.io thì hiện thông tin tài khoản để chuyển tay */
function QrImage({ src, bank }: { src: string; bank: NonNullable<Finance['bank']> }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div className="rounded-xl bg-surface-2 p-3 text-center text-sm">
        <p className="text-xs text-fg-subtle">Không tải được mã QR — chuyển khoản tới</p>
        <p className="font-semibold">{bankName(bank.bin)}</p>
        <button type="button" onClick={() => void copy(bank.account_no, 'số tài khoản')} className="font-mono text-lg font-bold underline decoration-dotted">{bank.account_no}</button>
        <p className="text-xs text-fg-muted">{bank.account_name}</p>
      </div>
    )
  }
  // eslint-disable-next-line @next/next/no-img-element -- ảnh mã VietQR từ img.vietqr.io
  return <img src={src} alt="Mã VietQR chuyển khoản" onError={() => setFailed(true)} className="mx-auto w-60 rounded-xl bg-white p-2" />
}

function PaymentActions({ clubId, dueId, userId, status }: { clubId: string; dueId: string; userId: string; status: DueStatus }) {
  const m = useClubMutation(clubId, (s: Exclude<DueStatus, 'CLAIMED'>) => setDuePayment(dueId, userId, s))
  const run = (s: Exclude<DueStatus, 'CLAIMED'>, ok: string) => m.mutate(s, { onSuccess: () => toast.success(ok), onError: (e) => toast.error(eventsErrorMessage(e)) })
  if (status === 'CONFIRMED' || status === 'EXEMPT') {
    return <Button size="sm" variant="secondary" loading={m.isPending} onClick={() => run('UNPAID', 'Đã chuyển về chưa đóng')} aria-label="Hoàn tác"><Undo2 className="size-4" aria-hidden /></Button>
  }
  return (
    <div className="flex gap-1">
      <Button size="sm" variant="secondary" loading={m.isPending} onClick={() => run('EXEMPT', 'Đã miễn phí')}>Miễn</Button>
      <Button size="sm" loading={m.isPending} onClick={() => run('CONFIRMED', 'Đã xác nhận, ghi vào sổ')}>Xác nhận</Button>
    </div>
  )
}

function Ledger({ clubId, entries, canManage }: { clubId: string; entries: CashEntry[]; canManage: boolean }) {
  const [voiding, setVoiding] = useState<CashEntry | null>(null)
  const exportCsv = () => {
    const blob = new Blob([cashCsv(entries)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `thu-chi-clb-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  return (
    <section>
      <SectionTitle action={entries.length ? <Button size="sm" variant="secondary" onClick={exportCsv}><Download className="size-4" aria-hidden />CSV</Button> : undefined}>
        Sổ thu chi
      </SectionTitle>
      {entries.length === 0 ? (
        <EmptyState icon={ReceiptText} title="Chưa có khoản nào" description="Khoản thu phí đã xác nhận và khoản chi có hóa đơn sẽ hiện ở đây, công khai với mọi thành viên." />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          {entries.map((e) => {
            const out = e.kind === 'EXPENSE'
            return (
              <li key={e.id} className={cn('flex items-center gap-3 px-4 py-3', e.voided_at && 'opacity-50')}>
                <span className={cn('grid size-9 shrink-0 place-items-center rounded-xl', out ? 'bg-danger/15 text-danger' : 'bg-brand/15 text-brand')}>
                  {out ? <Banknote className="size-4" aria-hidden /> : <HandCoins className="size-4" aria-hidden />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-sm font-semibold', e.voided_at && 'line-through')}>{e.kind === 'DUE' && e.user_name ? `${e.user_name} · ${e.title}` : e.title}</span>
                  <span className="block truncate text-xs text-fg-subtle">
                    {e.voided_at ? `Đã hủy: ${e.void_reason}` : `${e.created_by_name ?? ''} · ${formatRelative(e.created_at)}${e.note ? ` · ${e.note}` : ''}`}
                  </span>
                </span>
                {e.receipt_url && (
                  <a href={e.receipt_url} target="_blank" rel="noreferrer" aria-label="Xem hóa đơn" className="grid size-9 place-items-center rounded-full text-fg-muted hover:bg-surface-2">
                    <FileImage className="size-4" aria-hidden />
                  </a>
                )}
                <button type="button" disabled={!canManage || !!e.voided_at} onClick={() => setVoiding(e)}
                  className={cn('font-mono text-sm font-bold tabular', out ? 'text-danger' : 'text-brand', canManage && !e.voided_at && 'underline decoration-dotted underline-offset-4')}>
                  {out ? '−' : '+'}{formatVnd(e.amount_vnd)}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {voiding && <VoidSheet clubId={clubId} entry={voiding} onClose={() => setVoiding(null)} />}
    </section>
  )
}

function VoidSheet({ clubId, entry, onClose }: { clubId: string; entry: CashEntry; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const m = useClubMutation(clubId, () => voidCashEntry(entry.id, reason.trim()))
  return (
    <Sheet open onClose={onClose} title="Hủy khoản này?" description={`${entry.title} · ${formatVnd(entry.amount_vnd)}. Khoản đã hủy vẫn hiện trong sổ (gạch ngang) để minh bạch.`}
      footer={<Button variant="danger" block disabled={reason.trim().length < 5} loading={m.isPending}
        onClick={() => m.mutate(undefined, { onSuccess: () => { toast.success('Đã hủy khoản'); onClose() }, onError: (e) => toast.error(eventsErrorMessage(e)) })}>Hủy khoản</Button>}>
      <Field label="Lý do (bắt buộc, ít nhất 5 ký tự)" htmlFor="void-reason">
        <Input id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Nhập nhầm số tiền" />
      </Field>
    </Sheet>
  )
}

function AmountInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const n = parseVnd(value)
  return (
    <>
      <Input id={id} inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} placeholder="150k, 1,5tr hoặc 150000" className="font-mono text-lg" />
      {value && <p className={cn('mt-1 text-xs', Number.isFinite(n) ? 'text-fg-muted' : 'text-danger')}>{Number.isFinite(n) ? formatVnd(n) : 'Số tiền chưa đúng'}</p>}
    </>
  )
}

function CreateDueSheet({ clubId, onClose }: { clubId: string; onClose: () => void }) {
  const [title, setTitle] = useState(`Phí tháng ${new Date().getMonth() + 1}/${new Date().getFullYear()}`)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  const n = parseVnd(amount)
  const m = useClubMutation(clubId, () => createDue(clubId, { title: title.trim(), amount: n, dueDate: date || null, note: note.trim() || null }))
  return (
    <Sheet open onClose={onClose} title="Tạo kỳ thu phí" description="Mọi thành viên nhận thông báo kèm mã VietQR để chuyển khoản"
      footer={<Button block disabled={title.trim().length < 3 || !Number.isFinite(n) || n < 1000} loading={m.isPending}
        onClick={() => m.mutate(undefined, { onSuccess: () => { toast.success('Đã tạo kỳ thu phí'); onClose() }, onError: (e) => toast.error(eventsErrorMessage(e)) })}>Tạo kỳ thu</Button>}>
      <div className="space-y-4">
        <Field label="Tên kỳ thu" htmlFor="due-title"><Input id="due-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} /></Field>
        <Field label="Số tiền mỗi người" htmlFor="due-amount"><AmountInput id="due-amount" value={amount} onChange={setAmount} /></Field>
        <Field label="Hạn đóng (không bắt buộc)" htmlFor="due-date"><Input id="due-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Ghi chú" htmlFor="due-note"><Textarea id="due-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} placeholder="Gồm nước uống các buổi chạy nhóm và bảo hiểm" className="min-h-16" /></Field>
      </div>
    </Sheet>
  )
}

function EntrySheet({ clubId, onClose }: { clubId: string; onClose: () => void }) {
  const { session } = useSession()
  const [kind, setKind] = useState<'EXPENSE' | 'INCOME'>('EXPENSE')
  const [amount, setAmount] = useState('')
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  const n = parseVnd(amount)
  const m = useClubMutation(clubId, async () => {
    const receiptUrl = file && session ? await uploadReceipt(clubId, session.user.id, file) : null
    return addCashEntry(clubId, { kind, amount: n, title: title.trim(), note: note.trim() || null, receiptUrl })
  })
  return (
    <Sheet open onClose={onClose} title="Ghi khoản thu / chi"
      footer={<Button block disabled={title.trim().length < 2 || !Number.isFinite(n) || n < 1000} loading={m.isPending}
        onClick={() => m.mutate(undefined, { onSuccess: () => { toast.success('Đã ghi vào sổ'); onClose() }, onError: (e) => toast.error(eventsErrorMessage(e)) })}>Ghi vào sổ</Button>}>
      <div className="space-y-4">
        <SegmentedControl value={kind} onChange={setKind} options={[{ value: 'EXPENSE', label: 'Khoản chi' }, { value: 'INCOME', label: 'Khoản thu khác' }]} />
        <Field label="Số tiền" htmlFor="en-amount"><AmountInput id="en-amount" value={amount} onChange={setAmount} /></Field>
        <Field label="Nội dung" htmlFor="en-title">
          <Input id="en-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder={kind === 'EXPENSE' ? 'Nước + chuối buổi chạy 28/9' : 'Tài trợ từ cửa hàng giày'} />
        </Field>
        <Field label="Ghi chú" htmlFor="en-note"><Input id="en-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></Field>
        <Field label="Ảnh hóa đơn" hint="Nên có với mọi khoản chi để minh bạch">
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-border p-3 hover:border-fg-subtle">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- xem trước ảnh hóa đơn (blob)
              <img src={preview} alt="" className="size-14 rounded-lg object-cover" />
            ) : <FileImage className="size-6 text-fg-subtle" aria-hidden />}
            <span className="text-sm font-semibold text-fg-muted">{file ? file.name : 'Chụp / chọn ảnh hóa đơn'}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only"
              onChange={(e) => { const f = e.target.files?.[0] ?? null; if (f && f.size > 5 * 1024 * 1024) { toast.error('Ảnh tối đa 5 MB'); return } setFile(f) }} />
          </label>
        </Field>
      </div>
    </Sheet>
  )
}

function BankSheet({ clubId, bank, qrUrl, onClose }: { clubId: string; bank: Finance['bank']; qrUrl: string | null; onClose: () => void }) {
  const { session } = useSession()
  const saveQr = useClubMutation(clubId, async (file: File | null) => {
    const url = file && session ? await uploadReceipt(clubId, session.user.id, file, 'bankqr') : null
    await setBankQr(clubId, url)
  })
  const pickQr = (f: File | undefined) => {
    if (!f) return
    if (!f.type.startsWith('image/')) { toast.error('Hãy chọn một file ảnh.'); return }
    if (f.size > 5 * 1024 * 1024) { toast.error('Ảnh tối đa 5 MB'); return }
    saveQr.mutate(f, { onSuccess: () => toast.success('Đã lưu ảnh QR'), onError: (e) => toast.error(eventsErrorMessage(e)) })
  }
  const [bin, setBin] = useState(bank?.bin ?? BANKS[0].bin)
  const [account, setAccount] = useState(bank?.account_no ?? '')
  const [name, setName] = useState(bank?.account_name ?? '')
  const m = useClubMutation(clubId, (b: { bin: string; account: string; name: string } | null) => setBank(clubId, b))
  const valid = /^\d{6}$/.test(bin) && /^[0-9A-Za-z]{4,20}$/.test(account) && name.trim().length >= 2
  return (
    <Sheet open onClose={onClose} title="Tài khoản nhận tiền của CLB" description="Thành viên thấy khi đóng phí"
      footer={<div className="flex gap-2">
        {bank && <Button variant="secondary" className="shrink-0" loading={m.isPending}
          onClick={() => m.mutate(null, { onSuccess: () => { toast.success('Đã gỡ tài khoản'); onClose() }, onError: (e) => toast.error(eventsErrorMessage(e)) })}>Gỡ</Button>}
        <Button block disabled={!valid} loading={m.isPending}
          onClick={() => m.mutate({ bin, account, name }, { onSuccess: () => { toast.success('Đã lưu tài khoản'); onClose() }, onError: (e) => toast.error(eventsErrorMessage(e)) })}>Lưu</Button>
      </div>}>
      <div className="space-y-4">
        <Field label="Ảnh mã QR nhận tiền" hint="Chụp màn hình mã QR trong app ngân hàng / MoMo / ZaloPay. Có ảnh thì thành viên quét ảnh này.">
          <div className="flex items-center gap-3">
            <label className={cn('flex flex-1 cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-border p-3 hover:border-fg-subtle', saveQr.isPending && 'pointer-events-none opacity-60')}>
              {qrUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- ảnh QR CLB trên Supabase Storage
                <img src={qrUrl} alt="" className="size-16 rounded-lg bg-white object-contain" />
              ) : <QrCode className="size-8 text-fg-subtle" aria-hidden />}
              <span className="text-sm font-semibold text-fg-muted">{saveQr.isPending ? 'Đang tải lên…' : qrUrl ? 'Đổi ảnh QR' : 'Tải ảnh QR lên'}</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only"
                onChange={(e) => { pickQr(e.target.files?.[0]); e.target.value = '' }} />
            </label>
            {qrUrl && (
              <Button variant="secondary" className="shrink-0" aria-label="Gỡ ảnh QR" disabled={saveQr.isPending}
                onClick={() => saveQr.mutate(null, { onSuccess: () => toast.success('Đã gỡ ảnh QR'), onError: (e) => toast.error(eventsErrorMessage(e)) })}>
                <Trash2 className="size-4" aria-hidden />
              </Button>
            )}
          </div>
        </Field>
        <p className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">Hoặc / và số tài khoản (app tự tạo mã VietQR có sẵn số tiền)</p>
        <Field label="Ngân hàng" htmlFor="bank-bin">
          <select id="bank-bin" value={bin} onChange={(e) => setBin(e.target.value)} className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-[15px]">
            {BANKS.map((b) => <option key={b.bin} value={b.bin}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="Số tài khoản" htmlFor="bank-acc">
          <Input id="bank-acc" inputMode="numeric" value={account} onChange={(e) => setAccount(e.target.value.replace(/[^0-9A-Za-z]/g, '').slice(0, 20))} className="font-mono" />
        </Field>
        <Field label="Tên chủ tài khoản" htmlFor="bank-name" hint="Viết không dấu, đúng như trên app ngân hàng">
          <Input id="bank-name" value={name} onChange={(e) => setName(e.target.value.toUpperCase())} maxLength={60} placeholder="NGUYEN VAN A" />
        </Field>
      </div>
    </Sheet>
  )
}
