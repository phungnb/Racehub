'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { searchAthletes, type AthleteSearchResult } from '../api/athleteApi'
import AthleteProfile, { AthleteAvatar } from './AthleteProfile'

/* ────────────────────────────────────────────────────────────
 * AthleteSearch – tìm vận động viên theo tên, bấm để mở hồ sơ
 *  Đặt tại: features/profile/components/AthleteSearch.tsx
 * ──────────────────────────────────────────────────────────── */

export default function AthleteSearch() {
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const q = query.trim()
  // Chờ 350ms sau lần gõ cuối rồi mới tìm (setState trong callback hẹn giờ, không đồng bộ trong effect)
  const [debounced, setDebounced] = useState(q)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 350)
    return () => clearTimeout(t)
  }, [q])
  const search = useQuery({ queryKey: ['athletes', 'search', debounced], queryFn: () => searchAthletes(debounced), enabled: debounced.length >= 2, placeholderData: (prev) => prev })
  const results: AthleteSearchResult[] = q.length >= 2 ? search.data ?? [] : []
  const loading = q !== debounced || search.isFetching
  const error = search.isError

  return (
    <section aria-labelledby="athlete-search" className="space-y-2 text-xs">
      <h3 id="athlete-search" className="text-sm font-bold text-white">
        Tìm vận động viên
      </h3>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Nhập tên vận động viên…"
        aria-label="Tìm vận động viên"
        className="w-full bg-bg border border-border rounded-xl px-3 py-2.5 text-xs text-white placeholder:text-fg-subtle outline-none focus:border-brand"
      />

      {q.length >= 2 && (
        <div aria-live="polite">
          {error ? (
            <p className="text-rose-300 px-1">Không tìm được lúc này. Thử lại sau.</p>
          ) : loading && results.length === 0 ? (
            <p className="text-fg-subtle px-1">Đang tìm…</p>
          ) : results.length === 0 ? (
            <p className="text-fg-subtle px-1">Không thấy vận động viên nào tên “{q}”.</p>
          ) : (
            <ul className="space-y-2">
              {results.map((a) => (
                <li key={a.id}>
                  <button
                    onClick={() => setOpenId(a.id)}
                    className="w-full flex items-center gap-3 bg-surface hover:bg-surface-2/80 border border-border rounded-2xl p-3 text-left cursor-pointer transition-colors"
                  >
                    <AthleteAvatar name={a.display_name || 'Runner'} url={a.avatar_url} size={40} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold text-white truncate">{a.display_name || 'Runner'}</span>
                      <span className="block text-xs text-fg-subtle">
                        Level {a.level ?? 1}
                        {a.region ? ` • ${a.region}` : ''}
                      </span>
                    </span>
                    <span className="text-fg-subtle" aria-hidden>›</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {openId && <AthleteProfile userId={openId} onClose={() => setOpenId(null)} />}
    </section>
  )
}
