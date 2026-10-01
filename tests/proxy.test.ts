import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const getUser = vi.fn(async () => ({ data: { user: null } }))
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: { getUser } }) }))

const { proxy } = await import('../proxy')

const cookie = (expiresAt: number, chunked = false) => {
  const v = 'base64-' + Buffer.from(JSON.stringify({ access_token: 'x', expires_at: expiresAt })).toString('base64url')
  if (!chunked) return `sb-abc-auth-token=${v}`
  const mid = Math.floor(v.length / 2)
  return `sb-abc-auth-token.1=${v.slice(mid)}; sb-abc-auth-token.0=${v.slice(0, mid)}`
}
const req = (c: string) => new NextRequest('https://racehub.test/', { headers: { cookie: c, 'sec-fetch-dest': 'document' } })

describe('proxy: chỉ gọi Supabase Auth khi phiên sắp hết hạn', () => {
  beforeEach(() => {
    getUser.mockClear()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
  })
  const now = () => Math.floor(Date.now() / 1000)

  it('phiên còn hạn lâu → không gọi mạng', async () => {
    await proxy(req(cookie(now() + 3000)))
    await proxy(req(cookie(now() + 3000, true)))
    expect(getUser).not.toHaveBeenCalled()
  })
  it('phiên sắp hết / đã hết hạn → làm mới như cũ', async () => {
    await proxy(req(cookie(now() + 30)))
    await proxy(req(cookie(now() - 100, true)))
    expect(getUser).toHaveBeenCalledTimes(2)
  })
  it('cookie không đọc được → làm mới như cũ', async () => {
    await proxy(req('sb-abc-auth-token=base64-!!!'))
    expect(getUser).toHaveBeenCalledTimes(1)
  })
})
