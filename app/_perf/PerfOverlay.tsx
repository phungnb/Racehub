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

export interface BootTiming { serverMs: number; htmlMs: number; jsKb: number; jsMs: number; appMs: number; sw: boolean }

/** Khởi động app (lần mở đầu): máy chủ trả trang, tải HTML, tải JS, app chạy được — đo bằng Navigation/Resource Timing */
function readBoot(): BootTiming | null {
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  if (!nav) return null
  const js = (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).filter((r) => r.name.includes('/_next/static/') && r.name.endsWith('.js'))
  return {
    serverMs: Math.round(nav.responseStart - nav.startTime),
    htmlMs: Math.round(nav.responseEnd - nav.startTime),
    jsKb: Math.round(js.reduce((a, r) => a + (r.transferSize || 0), 0) / 1024),
    jsMs: Math.round(js.reduce((a, r) => Math.max(a, r.responseEnd), 0)),
    appMs: Math.round(performance.now()),
    sw: !!navigator.serviceWorker?.controller,
  }
}

export default function PerfOverlay() {
  const pathname = usePathname()
  const [open, setOpen] = useState(true)
  useSyncExternalStore(onPerf, perfVersion, () => 0)
  const [boot] = useState(readBoot)
  useEffect(() => { patchApiFetch() }, [])
  useEffect(() => { perfRouteStart(pathname) }, [pathname])

  const { requests, routes, inflight } = perfData()
  // Có yêu cầu đang chờ: vẽ lại mỗi giây để thấy nó treo bao lâu
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (!inflight.length) return
    const t = setInterval(() => setNow(performance.now()), 1000)
    return () => clearInterval(t)
  }, [inflight.length])
  const cur = routes[0]
  const here = requests.filter((r) => r.route === cur?.route).slice(0, 40)
  const slow = [...here].sort((a, b) => b.ms - a.ms).slice(0, 8)
  const copy = () => void navigator.clipboard?.writeText(JSON.stringify({ boot, waiting: inflight.map((r) => ({ name: r.name, ms: Math.round(performance.now() - r.t0) })), routes, requests: requests.slice(0, 150) }, null, 1))

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
      {boot && (
        <p className="mb-1 text-white/80">
          Khởi động: máy chủ <b className={boot.serverMs > 800 ? 'text-red-300' : ''}>{boot.serverMs}</b> · HTML {boot.htmlMs} · JS {boot.jsKb} KB xong lúc {boot.jsMs} · app chạy lúc <b className={boot.appMs > 3000 ? 'text-red-300' : ''}>{boot.appMs}</b> ms{boot.sw ? '' : ' · chưa có SW'}
        </p>
      )}
      <p>Mở trang: <b className="text-lime-300">{cur?.readyMs != null ? `${cur.readyMs} ms` : 'đang tải…'}</b> · {cur?.requests ?? 0} yêu cầu</p>
      {inflight.length > 0 && <p className="mt-1 text-white/60">Đang chờ:</p>}
      {inflight.map((r, i) => <p key={i} className="text-red-300">{now ? `${Math.max(0, Math.round(now - r.t0))} ms` : "…"} · {r.name}</p>)}
      <p className="mt-1 text-white/60">Chậm nhất:</p>
      {slow.map((r, i) => (
        <p key={i} className={r.ms > 800 ? 'text-red-300' : r.ms > 300 ? 'text-amber-200' : ''}>{r.ms} ms · {r.name}{r.status >= 400 ? ` (${r.status})` : ''}</p>
      ))}
      <p className="mt-1 text-white/60">Các trang trước:</p>
      {routes.slice(1, 8).map((r, i) => <p key={i}>{r.readyMs ?? '…'} ms · {r.requests} yc · {r.route}</p>)}
    </div>
  )
}
