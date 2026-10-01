'use client'

// Bảng đo tốc độ (?perf=1): thời gian mở từng trang + yêu cầu chậm nhất. Chỉ tải khi bộ đo bật.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { disablePerf, onPerf, perfData, perfRouteStart, perfVersion, requestName } from '@/shared/lib/perf'

let patched = false
function patchApiFetch() {
  if (patched) return
  patched = true
  const original = window.fetch.bind(window)
  // Đo thêm các lệnh gọi /api của chính app (Supabase đã đo sẵn qua perfFetch)
  window.fetch = async (input, init) => {
    const name = requestName(input)
    if (!name.startsWith('api/')) return original(input, init)
    const { perfFetch } = await import('@/shared/lib/perf')
    return perfFetch(input, init)
  }
}

export default function PerfOverlay() {
  const pathname = usePathname()
  const [open, setOpen] = useState(true)
  useSyncExternalStore(onPerf, perfVersion, () => 0)
  useEffect(() => { patchApiFetch() }, [])
  useEffect(() => { perfRouteStart(pathname) }, [pathname])

  const { requests, routes } = perfData()
  const cur = routes[0]
  const here = requests.filter((r) => r.route === cur?.route).slice(0, 40)
  const slow = [...here].sort((a, b) => b.ms - a.ms).slice(0, 8)
  const copy = () => void navigator.clipboard?.writeText(JSON.stringify({ routes, requests: requests.slice(0, 150) }, null, 1))

  if (!open) {
    return <button onClick={() => setOpen(true)} className="fixed bottom-24 left-2 z-[200] rounded-full bg-black/80 px-3 py-1 font-mono text-xs text-lime-300">⏱ perf</button>
  }
  return (
    <div className="fixed bottom-24 left-2 z-[200] max-h-[50vh] w-[min(22rem,calc(100vw-1rem))] overflow-y-auto rounded-xl bg-black/85 p-2 font-mono text-[11px] leading-snug text-white shadow-2xl">
      <div className="mb-1 flex items-center gap-2">
        <b className="flex-1 text-lime-300">⏱ {cur?.route ?? '—'}</b>
        <button onClick={copy} className="rounded bg-white/15 px-1.5">Chép</button>
        <button onClick={() => setOpen(false)} className="rounded bg-white/15 px-1.5">Thu</button>
        <button onClick={disablePerf} className="rounded bg-white/15 px-1.5">Tắt</button>
      </div>
      <p>Mở trang: <b className="text-lime-300">{cur?.readyMs != null ? `${cur.readyMs} ms` : 'đang tải…'}</b> · {cur?.requests ?? 0} yêu cầu</p>
      <p className="mt-1 text-white/60">Chậm nhất:</p>
      {slow.map((r, i) => (
        <p key={i} className={r.ms > 800 ? 'text-red-300' : r.ms > 300 ? 'text-amber-200' : ''}>{r.ms} ms · {r.name}{r.status >= 400 ? ` (${r.status})` : ''}</p>
      ))}
      <p className="mt-1 text-white/60">Các trang trước:</p>
      {routes.slice(1, 8).map((r, i) => <p key={i}>{r.readyMs ?? '…'} ms · {r.requests} yc · {r.route}</p>)}
    </div>
  )
}
