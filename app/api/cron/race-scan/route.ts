import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/shared/lib/supabase-server'
import { isCronAuthorized } from '@/shared/lib/cron-auth'
import { scanSource } from '@/shared/lib/race-scan-run'
import { scanKnowledgeSource } from '@/shared/lib/knowledge-scan'

// Thứ Hai 06:00 giờ VN (xem vercel.json): quét các nguồn đang bật (giải chạy → hàng chờ duyệt giải; tin kiến thức → hàng chờ biên tập).
// Không tự đăng. Idempotent (trang đã thấy không tải lại).
export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req.headers.get('authorization'))) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.from('race_sources').select('id,url,kind,query,target,category_id').eq('active', true).order('last_scanned_at', { ascending: true, nullsFirst: true }).limit(10)
  if (error) { console.error('[cron/race-scan]', error.message); return NextResponse.json({ error: 'FAILED' }, { status: 500 }) }
  const deadline = Date.now() + 50_000
  const results = []
  for (const src of data ?? []) {
    if (Date.now() > deadline) break
    results.push(await (src.target === 'KNOWLEDGE' ? scanKnowledgeSource : scanSource)(admin, src, deadline))
  }
  return NextResponse.json({ scanned: results.length, results })
}
