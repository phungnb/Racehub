import Link from 'next/link'
import type { ReactNode } from 'react'
import { BarChart3, Building2, Crown, FileSpreadsheet, Flag, Network, Palette, ShieldCheck, Trophy, Users } from 'lucide-react'
import { QuoteForm } from './QuoteForm'

const PLANS = [
  { name: 'Free', price: '0 ₫', who: 'CLB nhỏ, mới thành lập', items: ['Tối đa 50 thành viên', '2 thử thách nội bộ cùng lúc, ≤ 50 người', 'Lịch, điểm danh QR, quỹ VietQR', 'BXH, bảng tin, đội nhóm'] },
  { name: 'CLB Pro', price: 'từ 129.000 ₫/tháng', who: 'CLB đang hoạt động đều', items: ['Không giới hạn thành viên', '20 thử thách cùng lúc, tới 1.000 người', 'Tường nhà: ảnh bìa, chủ đề, huy hiệu PRO', 'Trang công khai + link riêng', 'Báo cáo chuyên cần, cửa hàng, giao lưu CLB'], highlight: true },
  { name: 'Doanh nghiệp', price: 'Báo giá riêng', who: 'Doanh nghiệp, liên đoàn, trường học', items: ['Chiến dịch cho toàn tổ chức', 'BXH cá nhân · phòng ban · CLB', 'Quản lý nhiều CLB, tài trợ CLB Pro', 'Báo cáo cho nhân sự, hỗ trợ riêng'] },
]

const FEATURES = [
  { icon: Flag, title: 'Chiến dịch sức khoẻ', text: 'Tạo chiến dịch theo tổng km, số buổi hoặc số ngày chạy; mục tiêu chung cả tổ chức và mục tiêu mỗi người.' },
  { icon: Trophy, title: 'Xếp hạng theo đơn vị', text: 'Phòng ban, chi nhánh, lớp hoặc CLB thi đua với nhau — tính cả tổng và bình quân đầu người cho công bằng.' },
  { icon: Network, title: 'Quản lý nhiều CLB', text: 'Liên đoàn mời CLB tham gia; thành viên CLB tự được tính vào chiến dịch. Có thể tài trợ CLB Pro cho cả hệ thống.' },
  { icon: FileSpreadsheet, title: 'Báo cáo cho nhân sự', text: 'km, số buổi, số ngày chạy của từng người theo khoảng ngày; mã nhân viên, đơn vị; xuất Excel (CSV).' },
  { icon: Palette, title: 'Thương hiệu riêng', text: 'Logo, ảnh bìa, màu chủ đề, khẩu hiệu; bảng tin nội bộ như một CLB lớn; chứng nhận hoàn thành thiết kế theo mẫu công ty.' },
  { icon: Users, title: 'Quản lý như phòng nhân sự', text: 'Tự duyệt theo email công ty, nhập danh sách từ Excel, đơn vị nhiều cấp, trưởng đơn vị tự quản lý người của mình.' },
  { icon: Trophy, title: 'Trao giải minh bạch', text: 'Chốt kết quả, duyệt top trước khi trao, ngày hội ×2 / ×3, quay thưởng may mắn có mã kiểm chứng.' },
  { icon: ShieldCheck, title: 'Chống gian lận, tôn trọng riêng tư', text: 'Chỉ tính bài chạy hợp lệ (GPS, pace, duyệt); người chạy tắt chia sẻ bài nào thì bài đó không vào bảng.' },
]

/** Trang giới thiệu gói Doanh nghiệp + form báo giá (xem được khi chưa đăng nhập) */
export function EnterpriseLanding({ more }: { more?: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 pb-16">
      <header className="relative -mx-4 overflow-hidden px-5 pb-10 pt-12 text-center"
        style={{ background: 'radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--color-brand) 30%, transparent), transparent 70%)' }}>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
          <Building2 className="size-3.5" aria-hidden />RaceHub Doanh nghiệp
        </span>
        <h1 className="mt-4 text-3xl font-extrabold leading-tight sm:text-4xl">Phong trào chạy bộ cho cả tổ chức</h1>
        <p className="mx-auto mt-3 max-w-xl text-fg-muted">
          Chiến dịch, bảng xếp hạng phòng ban, quản lý nhiều CLB và báo cáo cho nhân sự — tự động từ Strava và GPS, không cần bảng tính.
        </p>
        <a href="#bao-gia" className="mt-6 inline-flex h-12 items-center rounded-2xl bg-brand px-6 font-bold text-brand-fg shadow-lg">Nhận báo giá</a>
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-2xl border border-border bg-surface p-4">
            <f.icon className="size-6 text-brand" aria-hidden />
            <h2 className="mt-2 font-semibold">{f.title}</h2>
            <p className="mt-1 text-sm text-fg-muted">{f.text}</p>
          </div>
        ))}
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
