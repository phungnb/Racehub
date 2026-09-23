import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

process.env.NEXT_PUBLIC_STRAVA_CLIENT_ID = '123'
process.env.STRAVA_CLIENT_SECRET = 'secret'
const { syncStravaActivities, handleStravaWebhookEvent } = await import('./strava.server')

/** Supabase admin client giả lập: ghi lại mọi lời gọi */
function fakeAdmin(conn: Record<string, unknown> | null) {
  const calls = { rpc: [] as Array<[string, Record<string, unknown>]>, updates: [] as Record<string, unknown>[] }
  const chain = {
    select: () => chain, eq: () => chain,
    maybeSingle: async () => ({ data: conn, error: null }),
    update: (v: Record<string, unknown>) => { calls.updates.push(v); return { eq: () => ({ eq: async () => ({ error: null }) }) } },
  }
  const admin = {
    from: () => chain,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.rpc.push([fn, args])
      return { data: { result: 'IMPORTED', validation_status: 'APPROVED', earned_xu: 5 }, error: null }
    },
  } as unknown as SupabaseClient
  return { admin, calls }
}

const run = (id: number, start: string) => ({ id, name: `Run ${id}`, sport_type: 'Run', start_date: start, moving_time: 1800, elapsed_time: 1800, distance: 5000, map: { summary_polyline: 'x' } })

describe('syncStravaActivities', () => {
  const fetchMock = vi.fn()
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
  afterEach(() => vi.unstubAllGlobals())

  it('làm mới token hết hạn, nhập bài từ cũ đến mới, cập nhật mốc đồng bộ', async () => {
    const { admin, calls } = fakeAdmin({ user_id: 'u1', provider_user_id: '9', access_token: 'old', refresh_token: 'r1', expires_at: '2000-01-01T00:00:00Z', last_synced_at: null })
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'new', refresh_token: 'r2', expires_at: 4102444800 })))
      .mockResolvedValueOnce(new Response(JSON.stringify([run(2, '2026-09-21T00:00:00Z'), run(1, '2026-09-20T00:00:00Z')])))

    const s = await syncStravaActivities(admin, 'u1')

    expect(fetchMock.mock.calls[0][0]).toBe('https://www.strava.com/oauth/token')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'r1' })
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer new')
    expect(calls.rpc.map(([, a]) => a.p_external_id)).toEqual(['1', '2'])          // cũ trước
    expect(calls.updates[0]).toMatchObject({ access_token: 'new', refresh_token: 'r2' })
    expect(calls.updates.at(-1)).toHaveProperty('last_synced_at')
    expect(s).toEqual({ imported: 2, pending: 0, skipped: 0, duplicates: 0, earned_xu: 10 })
  })

  it('chưa kết nối / token bị thu hồi → lỗi rõ ràng', async () => {
    await expect(syncStravaActivities(fakeAdmin(null).admin, 'u1')).rejects.toThrow('STRAVA_NOT_CONNECTED')
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }))
    const { admin } = fakeAdmin({ user_id: 'u1', access_token: 'ok', refresh_token: 'r', expires_at: '2100-01-01T00:00:00Z', last_synced_at: null })
    await expect(syncStravaActivities(admin, 'u1')).rejects.toThrow('STRAVA_REAUTH_REQUIRED')
  })
})

describe('handleStravaWebhookEvent', () => {
  const fetchMock = vi.fn()
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
  afterEach(() => vi.unstubAllGlobals())
  const conn = { user_id: 'u1', provider_user_id: '9', access_token: 'tok', refresh_token: 'r', expires_at: '2100-01-01T00:00:00Z', last_synced_at: null }

  it('create → lấy bài từ API Strava rồi nhập', async () => {
    const { admin, calls } = fakeAdmin(conn)
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(run(77, '2026-09-21T00:00:00Z'))))
    await handleStravaWebhookEvent(admin, { object_type: 'activity', aspect_type: 'create', object_id: 77, owner_id: 9 })
    expect(fetchMock.mock.calls[0][0]).toBe('https://www.strava.com/api/v3/activities/77')
    expect(calls.rpc[0][0]).toBe('ingest_provider_activity')
  })

  it('delete → thu hồi; thu hồi quyền → hủy kết nối; không gọi API Strava', async () => {
    const { admin, calls } = fakeAdmin(conn)
    await handleStravaWebhookEvent(admin, { object_type: 'activity', aspect_type: 'delete', object_id: 77, owner_id: 9 })
    await handleStravaWebhookEvent(admin, { object_type: 'athlete', aspect_type: 'update', object_id: 9, owner_id: 9, updates: { authorized: 'false' } })
    expect(calls.rpc.map(([fn]) => fn)).toEqual(['remove_provider_activity', 'unlink_provider_connection'])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('vận động viên lạ → bỏ qua', async () => {
    const { admin, calls } = fakeAdmin(null)
    expect(await handleStravaWebhookEvent(admin, { object_type: 'activity', aspect_type: 'create', object_id: 1, owner_id: 1 }))
      .toEqual({ result: 'UNKNOWN_ATHLETE' })
    expect(calls.rpc).toHaveLength(0)
  })
})
