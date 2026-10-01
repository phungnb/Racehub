'use client'

import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, BellOff, Bug, CheckCircle2, ChevronDown, Database, HardDrive, Megaphone, RefreshCw, Server, XCircle, type LucideIcon } from 'lucide-react'
import { Button, Card, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatRelative } from '@/shared/lib/format'
import { ClientErrorsPanel, SystemNoticeEditor } from '@/features/system'
import { getNotifyErrors, getServerCheck, getSystemCheck, registerStravaWebhook, type ServerCheckItem } from '../api/adminApi'

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
    ...(s.client_errors_24h !== undefined ? [{ key: 'client_errors', label: 'Lỗi người dùng gặp (24 giờ)',
      status: (s.not_deployed_24h ? 'fail' : s.client_errors_24h > 50 ? 'warn' : 'ok') as Status,
      detail: s.not_deployed_24h ? `${s.not_deployed_24h} lần người dùng gặp tính năng chưa cập nhật máy chủ — kiểm tra migration còn thiếu. Chi tiết ở mục "Lỗi người dùng gặp".`
        : s.client_errors_24h ? `${s.client_errors_24h} lần — xem mục "Lỗi người dùng gặp" bên dưới.` : 'Không có lỗi nào.' }] : []),
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
        ) : (
          <>
            {(server.data?.items ?? []).map((i) => <Row key={i.key} status={i.status} label={i.label} detail={i.detail} />)}
            {(server.data?.items ?? []).some((i) => i.key === 'strava_webhook' && i.status !== 'ok') && <StravaWebhookButton onDone={() => void server.refetch()} />}
            {(server.data?.items ?? []).some((i) => i.key === 'vapid' && i.status !== 'ok') && <VapidGenerator />}
          </>
        )}
      </Section>

      {d && (
        <Section icon={HardDrive} title="Kho ảnh & việc tự chạy">
          {d.buckets.map((b) => (
            <Row key={b.id} status={b.ok ? 'ok' : 'fail'} label={`Kho ảnh ${b.id}`} detail={b.ok ? `Có, tối đa ${b.limit_mb} MB/ảnh.` : 'Chưa tạo — chạy migration tương ứng.'} />
          ))}
          {dataItems.map((i) => <Row key={i.key} status={i.status} label={i.label} detail={i.detail} />)}
        </Section>
      )}

      <Section icon={Megaphone} title="Thông báo cho người dùng">
        <SystemNoticeEditor />
      </Section>

      <Section icon={Bug} title="Lỗi người dùng gặp">
        <ClientErrorsPanel />
      </Section>

      <Section icon={BellOff} title="Lỗi gửi thông báo / push">
        <NotifyErrorsPanel />
      </Section>

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

/** Lỗi ở chuỗi thông báo → push (không còn chặn thao tác chính từ migration 006900) — để biết push có đang hỏng không */
function NotifyErrorsPanel() {
  const q = useQuery({ queryKey: ['admin', 'notify-errors'], queryFn: getNotifyErrors, retry: false })
  if (q.isPending) return <Skeleton className="h-16" />
  if (q.isError) return <Row status="warn" label="Chưa xem được" detail="Chạy migration 006900 (file gộp chay_tu_003700.sql) để bật nhật ký này." />
  if (!q.data.length) return <Row status="ok" label="Không có lỗi" detail="Thông báo trong app và push đang gửi bình thường." />
  return (
    <ul className="space-y-1.5">
      {q.data.slice(0, 15).map((e, i) => (
        <li key={i} className="rounded-xl bg-surface-2 px-3 py-2 text-xs">
          <p className="font-semibold">{e.stage}{e.kind ? ` · ${e.kind}` : ''} <span className="font-normal text-fg-subtle">· {formatRelative(e.at)}</span></p>
          <p className="break-words font-mono text-fg-muted">{e.sqlstate ? `[${e.sqlstate}] ` : ''}{e.message}</p>
        </li>
      ))}
    </ul>
  )
}

/** Đăng ký webhook Strava bằng một nút: bài chạy mới tự về app sau vài phút, không cần bấm Đồng bộ */
function StravaWebhookButton({ onDone }: { onDone: () => void }) {
  const reg = useMutation({
    mutationFn: registerStravaWebhook,
    onSuccess: (r) => {
      const host = (u: string) => { try { return new URL(u).host } catch { return u } }
      toast.success(r.already ? `Webhook đã trỏ đúng ${host(r.callback)} (mã ${r.id}).`
        : `Đã đăng ký webhook Strava về ${host(r.callback)} (mã ${r.id})${r.removed.length ? ` — đã xoá webhook cũ: ${r.removed.map(host).join(', ')}` : ''}.`, { duration: 10000 })
      onDone()
    },
    onError: (e) => toast.error((e as Error).message, { duration: 12000 }),
  })
  return (
    <div className="space-y-1.5 rounded-xl border border-brand/30 bg-brand/5 p-3">
      <p className="text-sm">Đăng ký webhook để bài chạy trên Strava <b>tự về app</b> vài phút sau khi lưu. Cần biến <code className="font-mono text-xs">STRAVA_WEBHOOK_VERIFY_TOKEN</code> trên Vercel (chuỗi ngẫu nhiên bất kỳ).</p>
      <Button size="sm" loading={reg.isPending} onClick={() => reg.mutate()}>Đăng ký webhook Strava</Button>
      {reg.error && <p className="text-xs text-danger">{(reg.error as Error).message}</p>}
    </div>
  )
}

const b64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/**
 * Tạo cặp khóa VAPID ngay trên trình duyệt (Web Crypto, P-256) — thay lệnh `npx web-push generate-vapid-keys` khi chỉ có điện thoại.
 * Khóa chỉ hiện trên màn hình này, KHÔNG gửi lên máy chủ; admin tự dán vào Vercel rồi Redeploy.
 */
function VapidGenerator() {
  const [keys, setKeys] = useState<{ pub: string; priv: string } | null>(null)
  const gen = async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const pub = b64url(await crypto.subtle.exportKey('raw', pair.publicKey))
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
    setKeys({ pub, priv: jwk.d ?? '' })
  }
  const copy = (v: string) => { void navigator.clipboard?.writeText(v).then(() => toast.success('Đã chép')) }
  return (
    <div className="space-y-2 rounded-xl border border-warning/40 bg-warning/5 p-3 text-sm">
      <p>Tạo cặp khóa mới ngay trên máy này (không gửi đi đâu), rồi dán vào <b>Vercel → Settings → Environment Variables</b> và <b>Redeploy</b>.</p>
      {!keys ? <Button size="sm" variant="secondary" onClick={() => void gen()}>Tạo cặp khóa VAPID</Button> : (
        <div className="space-y-2">
          {[['NEXT_PUBLIC_VAPID_PUBLIC_KEY', keys.pub], ['VAPID_PRIVATE_KEY', keys.priv]].map(([k, v]) => (
            <div key={k} className="space-y-1">
              <p className="font-mono text-xs font-semibold">{k}</p>
              <div className="flex gap-2">
                <code className="min-w-0 flex-1 break-all rounded-lg bg-surface-2 p-2 font-mono text-[11px]">{v}</code>
                <Button size="sm" variant="secondary" className="shrink-0" onClick={() => copy(v)}>Chép</Button>
              </div>
            </div>
          ))}
          <p className="text-xs text-fg-muted">Sau khi đổi khóa, mỗi người cần bật lại thông báo một lần (Cài đặt → Thông báo). Không chụp màn hình khóa bí mật.</p>
        </div>
      )}
    </div>
  )
}
