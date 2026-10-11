import type { PrizeRecipient } from '../api/prizeApi'
import type { XlsxSheet } from '@/shared/lib/excel'

export const DEFAULT_SIZES = ['S', 'M', 'L', 'XL', '2XL']

export const parseSizes = (s: string) => [...new Set(s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean))].slice(0, 12)

/** Sheet "Nhận tặng phẩm" để ghép vào file Excel xuất của BTC (downloadXlsx). Đủ cột giao hàng, người chưa điền để trống. */
export function prizeSheet(rows: PrizeRecipient[], needsSize: boolean, withRef: boolean): XlsxSheet {
  const head = ['STT', 'Tên trong app', ...(withRef ? ['BIB / cự ly'] : []), 'Người nhận', 'Số điện thoại', 'Địa chỉ', ...(needsSize ? ['Cỡ áo'] : []), 'Ghi chú', 'Đã điền']
  return {
    name: 'Nhận tặng phẩm', head, widths: head.map((h) => (h === 'Địa chỉ' ? 50 : h === 'STT' ? 6 : 0)).map((w, i) => w || Math.max(14, head[i].length + 2)),
    rows: rows.map((r, i) => [
      i + 1, r.display_name ?? '', ...(withRef ? [r.ref_label ?? ''] : []), r.full_name ?? '', r.phone ?? '', r.address ?? '',
      ...(needsSize ? [r.size ?? ''] : []), r.note ?? '', r.filled ? 'Đã điền' : 'Chưa điền',
    ]),
  }
}
