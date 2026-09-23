// Thu chi CLB (tiền VND): định dạng, VietQR, danh sách ngân hàng, xuất CSV. Hàm thuần.

/** Mã BIN (NAPAS) các ngân hàng phổ biến — dùng cho VietQR */
export const BANKS: { bin: string; name: string }[] = [
  { bin: '970436', name: 'Vietcombank' },
  { bin: '970415', name: 'VietinBank' },
  { bin: '970418', name: 'BIDV' },
  { bin: '970405', name: 'Agribank' },
  { bin: '970407', name: 'Techcombank' },
  { bin: '970422', name: 'MB Bank' },
  { bin: '970416', name: 'ACB' },
  { bin: '970432', name: 'VPBank' },
  { bin: '970423', name: 'TPBank' },
  { bin: '970403', name: 'Sacombank' },
  { bin: '970441', name: 'VIB' },
  { bin: '970437', name: 'HDBank' },
  { bin: '970443', name: 'SHB' },
  { bin: '970426', name: 'MSB' },
  { bin: '970448', name: 'OCB' },
  { bin: '970440', name: 'SeABank' },
  { bin: '970431', name: 'Eximbank' },
  { bin: '970449', name: 'LPBank' },
  { bin: '970428', name: 'Nam A Bank' },
  { bin: '970409', name: 'Bac A Bank' },
  { bin: '970454', name: 'Viet Capital Bank' },
  { bin: '970412', name: 'PVcomBank' },
  { bin: '970452', name: 'Kienlongbank' },
  { bin: '970425', name: 'ABBANK' },
  { bin: '546034', name: 'Cake by VPBank' },
]
export const bankName = (bin: string | null | undefined) => BANKS.find((b) => b.bin === bin)?.name ?? (bin ? `Ngân hàng ${bin}` : '')

const vnd = new Intl.NumberFormat('vi-VN')
export const formatVnd = (n: number | string | null | undefined) => `${vnd.format(Math.round(Number(n ?? 0)))}đ`

/** Bỏ dấu tiếng Việt, chỉ giữ chữ + số + khoảng trắng, in hoa (nội dung chuyển khoản ngân hàng) */
export function plainUpper(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase()
}

/** Nội dung chuyển khoản: "<CLB> <kỳ phí> <tên người đóng>", tối đa 50 ký tự (giới hạn phổ biến của ngân hàng) */
export function transferNote(club: string, due: string, payer: string) {
  const short = (s: string, n: number) => plainUpper(s).slice(0, n).trim()
  return `${short(club, 14)} ${short(due, 16)} ${short(payer, 18)}`.replace(/\s+/g, ' ').trim().slice(0, 50)
}

/** Ảnh mã VietQR (chuẩn NAPAS 247) có sẵn số tiền + nội dung — mở app ngân hàng quét là chuyển */
export function vietQrUrl(bank: { bin: string; account_no: string; account_name: string }, amount: number, note: string) {
  const q = new URLSearchParams({ amount: String(Math.round(amount)), addInfo: note, accountName: bank.account_name })
  return `https://img.vietqr.io/image/${bank.bin}-${encodeURIComponent(bank.account_no)}-compact2.png?${q.toString()}`
}

/** Số tiền nhập kiểu "150.000" / "150k" / "1,5tr" → số */
export function parseVnd(input: string): number {
  const s = input.trim().toLowerCase().replace(/\s/g, '')
  const m = /^(\d+(?:[.,]\d+)?)(k|tr|m)?$/.exec(s.replace(/\.(?=\d{3}(\D|$))/g, ''))
  if (!m) return NaN
  const n = Number(m[1].replace(',', '.'))
  return Math.round(m[2] === 'k' ? n * 1000 : m[2] === 'tr' || m[2] === 'm' ? n * 1_000_000 : n)
}

export interface CashEntry {
  id: string
  kind: 'DUE' | 'INCOME' | 'EXPENSE'
  amount_vnd: number
  title: string
  note: string | null
  receipt_url: string | null
  user_name: string | null
  created_by_name: string | null
  created_at: string
  voided_at: string | null
  void_reason: string | null
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Sổ thu chi → CSV (mở bằng Excel / Google Sheets). Có BOM để Excel đọc đúng tiếng Việt. */
export function cashCsv(entries: CashEntry[]) {
  const KIND = { DUE: 'Thu phí', INCOME: 'Thu khác', EXPENSE: 'Chi' } as const
  const rows = [['Ngày', 'Loại', 'Nội dung', 'Người đóng', 'Số tiền (VND)', 'Ghi chú', 'Người ghi', 'Trạng thái', 'Hóa đơn']]
  for (const e of entries) {
    rows.push([
      new Date(e.created_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }), KIND[e.kind], e.title, e.user_name ?? '',
      String(e.kind === 'EXPENSE' ? -e.amount_vnd : e.amount_vnd), e.note ?? '', e.created_by_name ?? '',
      e.voided_at ? `Đã hủy: ${e.void_reason ?? ''}` : 'Hợp lệ', e.receipt_url ?? '',
    ])
  }
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\n')
}
