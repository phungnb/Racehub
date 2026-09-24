'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, ChevronDown, Database, HardDrive, RefreshCw, Server, XCircle, type LucideIcon } from 'lucide-react'
import { Button, Card, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatRelative } from '@/shared/lib/format'
import { getServerCheck, getSystemCheck, type ServerCheckItem } from '../api/adminApi'

type Status = 'ok' | 'warn' | 'fail'
const ICON: Record<Status, LucideIcon> = { ok: CheckCircle2, warn: AlertTriangle, fail: XCircle }
const TONE: Record<Status, string> = { ok: 'text-brand', warn: 'text-warning', fail: 'text-danger' }

/** Việc chỉ bạn tự xác nhận được (app không đọc được giá trị cũ để so) — lưu tạm trên trình duyệt này */
const MANUAL = [
  { key: 'strava_rotated', label: 'Đã đổi Strava client secret (secret cũ từng bị lộ) và cập nhật trên Vercel' },
  { key: 'vapid_rotated', label: 'Đã tạo lại cặp khóa VAPID (khóa bí mật cũ từng bị lộ)' },
  { key: 'env_private', label: 'Không chia sẻ / chụp màn hình .env.local; khóa service role chỉ nằm trên máy chủ' },
  { key: 'backup', label: 'Đã bật sao lưu hằng ngày (Supabase → Database → Backups)' },
]

function readManual(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem('rh-admin-manual') ?? '{}') } catch { return {} }
}

/** Quản trị → Hệ thống: migration nào chưa chạy, biến môi trường, kho ảnh, thông báo đẩy, việc tự chạy hằng ngày */
export function SystemTab() {
  const db = useQuery({ queryKey: ['admin', 'system'], queryFn: getSystemCheck, retry: false })
  const server = useQuery({ queryKey: ['admin', 'system-server'], queryFn: getServerCheck, retry: false })
  const [manual, setManual] = useState<Record<string, boolean>>(readManual)
  const [showAll, setShowAll] = useState(false)
  const toggle = (k: string) => setManual((m) => {
    const next = { ...m, [k]: !m[k] }
    try { localStorage.setItem('rh-admin-manual', JSON.stringify(next)) } catch { /* trình duyệt chặn lưu */ }
    return next
  })

  const d = db.data
  const missing = d?.migrations.filter((m) => !m.ok) ?? []
  const s = d?.stats
  const dataItems: ServerCheckItem[] = s ? [
    { key: 'pg_net', label: 'pg_net (gửi thông báo đẩy từ database)', status: s.pg_net ? 'ok' : 'warn', detail: s.pg_net ? 'Đã bật.' : 'Chưa bật: Supabase → Database → Extensions → pg_net.' },
    { key: 'push_url', label: 'Địa chỉ gửi thông báo đẩy', status: s.push_url ? 'ok' : 'warn', detail: s.push_url ?? 'Chưa cấu hình: chạy select private.configure_push(\'https://<tên-miền>/api/push/dispatch\') trong SQL Editor.' },
    ...(s.push_stuck !== undefined ? [{ key: 'push_stuck', label: 'Hàng đợi thông báo đẩy', status: (s.push_stuck > 0 ? 'warn' : 'ok') as Status,
      detail: s.push_stuck > 0 ? `${s.push_stuck} thông báo chờ quá 15 phút — kiểm tra pg_net, địa chỉ gửi và khóa VAPID.` : 'Không bị kẹt.' }] : []),
    ...(s.challenges_overdue !== undefined ? [{ key: 'ch_over', label: 'Thử thách đã hết hạn chưa tất toán', status: (s.challenges_overdue > 0 ? 'warn' : 'ok') as Status,
      detail: s.challenges_overdue > 0 ? `${s.challenges_overdue} thử thách quá 1 ngày chưa chia thưởng — việc tự chạy (cron) có thể chưa hoạt động: kiểm tra CRON_SECRET và Vercel → Cron Jobs.` : 'Ổn.' }] : []),
    ...(s.battles_overdue !== undefined ? [{ key: 'bt_over', label: 'Trận CLB đấu CLB quá hạn', status: (s.battles_overdue > 0 ? 'warn' : 'ok') as Status,
      detail: s.battles_overdue > 0 ? `${s.battles_overdue} trận quá 1 ngày chưa chốt kết quả — kiểm tra cron.` : 'Ổn.' }] : []),
    ...(s.cups_overdue !== undefined ? [{ key: 'cup_over', label: 'Thách đấu CLB quá hạn', status: (s.cups_overdue > 0 ? 'warn' : 'ok') as Status,
      detail: s.cups_overdue > 0 ? `${s.cups_overdue} thách đấu quá 1 ngày chưa chốt — kiểm tra cron.` : 'Ổn.' }] : []),
    ...(s.cups_pending ? [{ key: 'cup_pending', label: 'Thách đấu CLB chờ duyệt', status: 'warn' as Status, detail: `${s.cups_pending} thách đấu — xem tab Thách đấu.` }] : []),
    ...(s.pending_reviews !== undefined ? [{ key: 'reviews', label: 'Bài chạy chờ duyệt', status: (s.pending_reviews > 20 ? 'warn' : 'ok') as Status,
      detail: s.pending_reviews ? `${s.pending_reviews} bài — xem tab Duyệt bài.` : 'Không có bài nào.' }] : []),
  ] : []
  const counts = [...(server.data?.items ?? []), ...dataItems].reduce((c, i) => ({ ...c, [i.status]: c[i.status] + 1 }), { ok: 0, warn: 0, fail: 0 })
  const fails = counts.fail + missing.length + (d?.buckets.filter((b) => !b.ok).length ?? 0)

  return (
    <div className="space-y-4">
      <Card className={cn('flex items-center gap-3 p-4', fails ? 'border-danger/50' : counts.warn ? 'border-warning/50' : 'border-brand/50')}>
        {(() => { const st: Status = fails ? 'fail' : counts.warn ? 'warn' : 'ok'; const I = ICON[st]; return <I className={cn('size-8 shrink-0', TONE[st])} aria-hidden /> })()}
        <div className="min-w-0 flex-1">
          <p className="font-bold">{db.isPending || server.isPending ? 'Đang kiểm tra…' : fails ? `${fails} việc cần xử lý` : counts.warn ? `${counts.warn} điểm cần chú ý` : 'Hệ thống sẵn sàng'}</p>
          <p className="text-xs text-fg-muted">{d ? `Kiểm tra ${formatRelative(d.checked_at)} · ${s?.users ?? 0} người dùng · ${s?.clubs ?? 0} CLB · ${s?.admins ?? 0} admin` : 'Migration, máy chủ, kho ảnh, thông báo đẩy'}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => { void db.refetch(); void server.refetch() }} aria-label="Kiểm tra lại">
          <RefreshCw className={cn('size-4', (db.isFetching || server.isFetching) && 'animate-spin')} aria-hidden />
        </Button>
      </Card>

      <Section icon={Database} title="Database (migration)">
        {db.isPending ? <Skeleton className="h-24" /> : db.isError ? (
          <Row status="fail" label="Chưa bật được trang kiểm tra"
            detail={`Chạy file 20261001003500_system_check.sql trong Supabase → SQL Editor rồi bấm kiểm tra lại. (${(db.error as { message?: string })?.message ?? ''})`} />
        ) : (
          <>
            {missing.length ? missing.map((m) => (
              <Row key={m.file} status="fail" label={`Chưa chạy: ${m.label}`} detail={`Chạy file supabase/migrations/${m.file}_*.sql trong SQL Editor (theo thứ tự số).`} />
            )) : <Row status="ok" label={`Đã chạy đủ ${d!.migrations.length} migration`} detail={`Mới nhất: ${d!.migrations[d!.migrations.length - 1].file}`} />}
            <button type="button" onClick={() => setShowAll((v) => !v)} className="flex w-full items-center justify-center gap-1 py-1 text-xs text-fg-muted">
              {showAll ? 'Ẩn danh sách' : 'Xem tất cả migration'}<ChevronDown className={cn('size-3.5 transition-transform', showAll && 'rotate-180')} aria-hidden />
            </button>
            {showAll && (
              <ul className="grid grid-cols-1 gap-1 text-xs">
                {d!.migrations.map((m) => (
                  <li key={m.file} className="flex items-center gap-2">
                    {m.ok ? <CheckCircle2 className="size-3.5 text-brand" aria-hidden /> : <XCircle className="size-3.5 text-danger" aria-hidden />}
                    <span className="font-mono text-fg-subtle">{m.file.slice(8)}</span><span className="truncate">{m.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Section>

      <Section icon={Server} title="Máy chủ (Vercel) & Strava">
        {server.isPending ? <Skeleton className="h-32" /> : server.isError ? (
          <Row status="warn" label="Không kiểm tra được máy chủ" detail={`Bản app đang chạy có thể chưa có trang này — gộp nhánh và triển khai lại. (${(server.error as Error).message})`} />
        ) : server.data!.items.map((i) => <Row key={i.key} status={i.status} label={i.label} detail={i.detail} />)}
      </Section>

      {d && (
        <Section icon={HardDrive} title="Kho ảnh & việc tự chạy">
          {d.buckets.map((b) => (
            <Row key={b.id} status={b.ok ? 'ok' : 'fail'} label={`Kho ảnh ${b.id}`} detail={b.ok ? `Có, tối đa ${b.limit_mb} MB/ảnh.` : 'Chưa tạo — chạy migration tương ứng.'} />
          ))}
          {dataItems.map((i) => <Row key={i.key} status={i.status} label={i.label} detail={i.detail} />)}
        </Section>
      )}

      <Section icon={CheckCircle2} title="Việc bạn tự xác nhận">
        {MANUAL.map((m) => (
          <label key={m.key} className="flex items-start gap-3 py-1.5 text-sm">
            <input type="checkbox" checked={!!manual[m.key]} onChange={() => toggle(m.key)} className="mt-0.5 size-5 accent-[var(--color-brand)]" />
            {m.label}
          </label>
        ))}
      </Section>
    </div>
  )
}

function Section({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <Card className="space-y-1 p-4">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-bold"><Icon className="size-4 text-fg-muted" aria-hidden />{title}</h2>
      {children}
    </Card>
  )
}

function Row({ status, label, detail }: { status: Status; label: string; detail: string }) {
  const I = ICON[status]
  return (
    <div className="flex items-start gap-2.5 border-b border-border py-2 last:border-0">
      <I className={cn('mt-0.5 size-4 shrink-0', TONE[status])} aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        <p className="break-words text-xs text-fg-muted">{detail}</p>
      </div>
    </div>
  )
}
