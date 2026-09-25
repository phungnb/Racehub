'use client'

// Tài nguyên có sẵn cho trình thiết kế của một giải: link QR tự sinh, QR phí tham gia đã lưu của CLB, gợi ý QR
import { useQuery } from '@tanstack/react-query'
import { vietQrPayload } from '@/shared/lib/vietqr'
import { getDesignAssets, type Race } from '../../api/raceApi'
import type { QrLayer } from '../../model/design'
import type { QrSuggestion } from './Studio'

export function raceLinks(r: Pick<Race, 'id' | 'club'>, bib?: string) {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  return {
    verify: origin && bib ? `${origin}/races/${r.id}?bib=${encodeURIComponent(bib)}` : null,
    race: origin ? `${origin}/races/${r.id}` : null,
    club: origin && r.club ? `${origin}/clubs/${r.club.id}` : null,
  }
}

export function useRaceAssets(r: Race) {
  const q = useQuery({ queryKey: ['race', r.id, 'design-assets'], queryFn: () => getDesignAssets(r.id), staleTime: 5 * 60_000 })
  const a = q.data
  const fee: Partial<QrLayer> | null = a?.bank_qr_url
    ? { source: 'fee', src: a.bank_qr_url, url: '', label: 'Quét để đóng phí' }
    : a?.bank ? { source: 'fee', src: null, url: vietQrPayload(a.bank, null, `Phi giai ${r.bib_prefix}`), label: 'Quét để đóng phí' } : null
  const orgName = r.club?.name ?? r.organizer?.display_name ?? 'BTC'
  const suggestions: QrSuggestion[] = [
    { key: 'verify', title: 'QR xác thực VĐV', hint: 'Mỗi VĐV một mã riêng — trọng tài quét kiểm tra BIB', ready: true,
      layer: { source: 'verify', label: 'Quét để xác thực' } },
    { key: 'club', title: 'QR đơn vị tổ chức', hint: r.club ? `Mở trang CLB ${r.club.name} (tạo sẵn)` : 'Giải cá nhân chưa có trang CLB — dùng "Thêm ảnh QR khác"',
      ready: !!r.club, layer: { source: 'club', label: orgName } },
    { key: 'fee', title: 'QR phí tham gia',
      hint: a?.bank_qr_url ? 'Lấy QR nhận tiền đã lưu trong Quỹ CLB' : a?.bank ? `VietQR tự tạo từ TK ${a.bank.account_no} đã lưu trong Quỹ CLB`
        : q.isPending ? 'Đang kiểm tra QR đã lưu…' : 'Chưa lưu QR nhận tiền trong Quỹ CLB — thêm trống rồi tải ảnh QR lên',
      ready: !q.isPending, layer: fee ?? { source: 'fee', label: 'Quét để đóng phí' } },
    { key: 'race', title: 'QR trang giải', hint: 'Mở trang giải: đăng ký, kết quả, BXH', ready: true, layer: { source: 'race', label: 'Trang giải' } },
  ]
  return { fee, suggestions, club: a?.club ?? null }
}
