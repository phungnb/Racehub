'use client'

import { usePendingRunSync } from '../hooks/usePendingRuns'

/** Gửi nền các bài chạy lưu trên máy lúc mất mạng (gắn một lần trong khung app) */
export function PendingRunSync() {
  usePendingRunSync()
  return null
}
