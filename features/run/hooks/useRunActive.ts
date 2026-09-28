'use client'

import { useSyncExternalStore } from 'react'

// Đang có bài chạy (tìm GPS / đang chạy / tạm dừng): khung app ẩn thanh trên + thanh điều hướng,
// để chạm nhầm lúc chạy không rời màn Chạy (rời màn = dừng ghi GPS).
const EVENT = 'rh-run-active'
let active = false

export function setRunActive(on: boolean) {
  if (active === on || typeof window === 'undefined') return
  active = on
  window.dispatchEvent(new Event(EVENT))
}

const subscribe = (cb: () => void) => { window.addEventListener(EVENT, cb); return () => window.removeEventListener(EVENT, cb) }
export const useRunActive = () => useSyncExternalStore(subscribe, () => active, () => false)
