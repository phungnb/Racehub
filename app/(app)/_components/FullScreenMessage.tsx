import type { ReactNode } from 'react'

export function FullScreenMessage({ children }: { children: ReactNode }) {
  return <div className="grid min-h-dvh place-items-center p-6 text-center text-sm text-fg-muted">{children}</div>
}
