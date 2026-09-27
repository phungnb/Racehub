import Link from 'next/link'
import type { ReactNode } from 'react'
import { BarChart3, Building2, Crown, FileSpreadsheet, Flag, Network, Palette, ShieldCheck, Trophy, Users } from 'lucide-react'
import { QuoteForm } from './QuoteForm'
import { DEFAULT_ENTERPRISE, type EnterpriseContent } from '@/shared/lib/ops'
import type { PlanFacts } from '@/shared/lib/ops-server'

/** Biểu tượng thẻ tính năng theo thứ tự (nội dung thẻ do admin soạn ở Chính sách vận hành) */
const ICONS = [Flag, Trophy, Network, FileSpreadsheet, Palette, Users, Trophy, ShieldCheck, Building2, BarChart3, Crown, Users]

const vnd = (n: number) => `${Math.round(n / 1000) * 1000}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' ₫'
const num = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

function plans(f: PlanFacts) {
  return [
    { name: 'Free', price: '0 ₫', who: 'CLB nhỏ, mới thành lập', items: [`Tối đa ${num(f.freeMaxMembers)} thành viên`, `${f.freeMaxOpen} thử thách nội bộ cùng lúc, ≤ ${num(f.freeMaxSlots)} người`, 'Lịch, điểm danh QR, quỹ VietQR', 'BXH, bảng tin, đội nhóm'] },
    { name: 'CLB Pro', price: f.proFromMonthly ? `từ ${vnd(f.proFromMonthly)}/tháng` : 'Xem bảng giá', who: 'CLB đang hoạt động đều', items: ['Không giới hạn thành viên', `${f.proMaxOpen} thử thách cùng lúc, tới ${num(f.proMaxSlots)} người`, 'Tường nhà: ảnh bìa, chủ đề, huy hiệu PRO', 'Trang công khai + link riêng', 'Báo cáo chuyên cần, cửa hàng, giao lưu CLB'], highlight: true },
    { name: 'Doanh nghiệp', price: 'Báo giá riêng', who: 'Doanh nghiệp, liên đoàn, trường học', items: ['Chiến dịch cho toàn tổ chức', 'BXH cá nhân · phòng ban · CLB', 'Quản lý nhiều CLB, tài trợ CLB Pro', 'Báo cáo cho nhân sự, hỗ trợ riêng'] },
  ]
}

/** Trang giới thiệu gói Doanh nghiệp + form báo giá (xem được khi chưa đăng nhập) */
export function EnterpriseLanding({ more, content = DEFAULT_ENTERPRISE, facts }: { more?: ReactNode; content?: EnterpriseContent; facts: PlanFacts }) {
  const PLANS = plans(facts)
  return (
    <main className="mx-auto max-w-3xl px-4 pb-16">
      <header className="relative -mx-4 overflow-hidden px-5 pb-10 pt-12 text-center"
        style={{ background: 'radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--color-brand) 30%, transparent), transparent 70%)' }}>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
          <Building2 className="size-3.5" aria-hidden />RaceHub Doanh nghiệp
        </span>
        <h1 className="mt-4 text-3xl font-extrabold leading-tight sm:text-4xl">{content.title}</h1>
        {content.subtitle && <p className="mx-auto mt-3 max-w-xl text-fg-muted">{content.subtitle}</p>}
        <a href="#bao-gia" className="mt-6 inline-flex h-12 items-center rounded-2xl bg-brand px-6 font-bold text-brand-fg shadow-lg">Nhận báo giá</a>
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        {content.features.map((f, i) => {
          const Icon = ICONS[i % ICONS.length]
          return (
          <div key={`${i}-${f.title}`} className="rounded-2xl border border-border bg-surface p-4">
            <Icon className="size-6 text-brand" aria-hidden />
            <h2 className="mt-2 font-semibold">{f.title}</h2>
            <p className="mt-1 text-sm text-fg-muted">{f.text}</p>
          </div>
          )
        })}
      </section>

      {more && (
        <section className="mt-10 rounded-2xl border border-border bg-surface p-4 sm:p-6">
          <h2 className="mb-3 text-xl font-bold">Tìm hiểu thêm</h2>
          {more}
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-center text-xl font-bold">Chọn gói phù hợp</h2>
        <p className="mt-1 text-center text-sm text-fg-muted">Bắt đầu miễn phí, nâng cấp khi phong trào lớn lên. <Link href="/goi" className="font-semibold text-brand">So sánh chi tiết →</Link></p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {PLANS.map((p) => (
            <div key={p.name} className={`flex flex-col rounded-2xl border p-4 ${p.highlight ? 'border-coin/60 bg-gradient-to-b from-coin/10 to-surface' : 'border-border bg-surface'}`}>
              <p className="flex items-center gap-1.5 font-bold">{p.highlight && <Crown className="size-4 text-coin" aria-hidden />}{p.name}</p>
              <p className="mt-1 font-mono text-lg font-extrabold">{p.price}</p>
              <p className="text-xs text-fg-subtle">{p.who}</p>
              <ul className="mt-3 flex-1 space-y-1.5 text-sm">
                {p.items.map((i) => <li key={i} className="flex gap-2"><span className="text-brand" aria-hidden>✓</span><span>{i}</span></li>)}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10 grid gap-3 rounded-2xl border border-border bg-surface p-4 sm:grid-cols-3">
        {[{ icon: Users, t: 'Tính theo số người', d: 'Giá theo số chỗ và thời hạn hợp đồng' },
          { icon: BarChart3, t: 'Dùng thử có hướng dẫn', d: 'Chạy thử một chiến dịch trước khi ký' },
          { icon: ShieldCheck, t: 'Hoá đơn đầy đủ', d: 'Hợp đồng, hoá đơn VAT; RaceHub không giữ tiền của thành viên' }].map((x) => (
          <div key={x.t} className="flex gap-3">
            <x.icon className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
            <div><p className="text-sm font-semibold">{x.t}</p><p className="text-xs text-fg-muted">{x.d}</p></div>
          </div>
        ))}
      </section>

      <section id="bao-gia" className="mt-10 scroll-mt-6 rounded-2xl border border-brand/30 bg-surface p-4 sm:p-6">
        <h2 className="text-xl font-bold">Yêu cầu báo giá</h2>
        <p className="mb-4 text-sm text-fg-muted">Để lại thông tin, RaceHub gọi lại trong 1 ngày làm việc.</p>
        <QuoteForm />
      </section>
      <p className="mt-6 text-center text-sm text-fg-muted">Đã có tổ chức trên RaceHub? <Link href="/orgs" className="font-semibold text-brand">Vào tổ chức của tôi →</Link></p>
    </main>
  )
}
