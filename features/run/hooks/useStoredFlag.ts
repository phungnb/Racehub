'use client'

import { useCallback, useState } from 'react'

const read = (key: string, dflt: boolean) => {
  try { const v = localStorage.getItem(key); return v === null ? dflt : v === '1' } catch { return dflt }
}
const write = (key: string, on: boolean) => { try { localStorage.setItem(key, on ? '1' : '0') } catch { /* trình duyệt chặn lưu */ } }

/** Công tắc bật / tắt nhớ trên máy. `force` (vd ?qa=1 trên URL) ghi đè và lưu lại luôn. */
export function useStoredFlag(key: string, dflt: boolean, force?: boolean) {
  const [on, setOn] = useState(() => {
    if (typeof window === 'undefined') return dflt
    if (force !== undefined) { write(key, force); return force }
    return read(key, dflt)
  })
  const set = useCallback((v: boolean) => { setOn(v); write(key, v) }, [key])
  return [on, set] as const
}
