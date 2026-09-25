import Link from 'next/link'
import { Compass } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="flex max-w-sm flex-col items-center gap-3">
        <div className="grid size-14 place-items-center rounded-full bg-surface-2"><Compass className="size-7 text-fg-muted" aria-hidden /></div>
        <h1 className="text-lg font-bold">Không tìm thấy trang</h1>
        <p className="text-sm text-fg-muted">Đường dẫn có thể đã sai, hoặc nội dung đã bị xóa / chuyển sang chế độ riêng tư.</p>
        <Link href="/feed" className="mt-1 inline-flex h-11 items-center rounded-xl bg-brand px-4 text-[15px] font-semibold text-brand-fg">Về trang chủ</Link>
      </div>
    </div>
  )
}
