'use client' // Error boundary phải là Client Component

import { useEffect } from 'react'

// Lỗi ở chính layout gốc: trang này thay cả <html>, không có CSS chung → dùng style viết thẳng
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error('[RaceHub] Lỗi nghiêm trọng:', error) }, [error])
  const btn = { padding: '10px 16px', borderRadius: 12, border: '1px solid #2a3140', fontWeight: 600, fontSize: 15, cursor: 'pointer' } as const
  return (
    <html lang="vi">
      <body style={{ margin: 0, minHeight: '100dvh', display: 'grid', placeItems: 'center', background: '#0a0d12', color: '#f2f5f9', fontFamily: 'system-ui, sans-serif', padding: 24, textAlign: 'center' }}>
        <title>RaceHub gặp sự cố</title>
        <div style={{ maxWidth: 360 }}>
          <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>RaceHub đang gặp sự cố</h1>
          <p style={{ color: '#9aa4b5', fontSize: 14, margin: '0 0 20px' }}>Ứng dụng không mở được. Thử tải lại; nếu vẫn lỗi, vui lòng quay lại sau ít phút — đội ngũ RaceHub đang xử lý.</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button style={{ ...btn, background: '#b6ff3b', color: '#0a0d12', borderColor: '#b6ff3b' }} onClick={() => retry()}>Thử lại</button>
            {/* layout gốc hỏng: tải lại cả trang thay vì dùng router */}
            <a href="/feed" style={{ ...btn, background: '#121720', color: '#f2f5f9', textDecoration: 'none' }}>Về trang chủ</a>
          </div>
          {error.digest && <p style={{ marginTop: 16, fontFamily: 'monospace', fontSize: 11, color: '#6b7587' }}>Mã lỗi {error.digest}</p>}
        </div>
      </body>
    </html>
  )
}
