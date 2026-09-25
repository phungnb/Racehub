'use client'

import { useCallback, useState } from 'react'

/** Trạng thái có Hoàn tác / Làm lại. `record = false` khi đang kéo (chụp mốc một lần bằng snapshot() lúc bắt đầu kéo). */
export function useHistory<T>(initial: () => T, limit = 60) {
  const [h, setH] = useState(() => ({ past: [] as T[], present: initial(), future: [] as T[] }))
  const update = useCallback((fn: (x: T) => T, record = true) => setH((s) => {
    const next = fn(s.present)
    if (next === s.present) return s
    return record ? { past: [...s.past, s.present].slice(-limit), present: next, future: [] } : { ...s, present: next }
  }), [limit])
  const snapshot = useCallback(() => setH((s) => ({ past: [...s.past, s.present].slice(-limit), present: s.present, future: [] })), [limit])
  const undo = useCallback(() => setH((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s)), [])
  const redo = useCallback(() => setH((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s)), [])
  return { value: h.present, update, snapshot, undo, redo, canUndo: h.past.length > 0, canRedo: h.future.length > 0 }
}
