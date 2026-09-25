/** Ảnh mã VietQR (chuẩn NAPAS 247) có sẵn số tiền + nội dung — mở app ngân hàng quét là chuyển */
export function vietQrUrl(bank: { bin: string; account_no: string; account_name: string }, amount: number, note: string) {
  const q = new URLSearchParams({ amount: String(Math.round(amount)), addInfo: note, accountName: bank.account_name })
  return `https://img.vietqr.io/image/${bank.bin}-${encodeURIComponent(bank.account_no)}-compact2.png?${q.toString()}`
}

/** Bỏ dấu, chỉ giữ ký tự an toàn cho nội dung chuyển khoản */
const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^A-Za-z0-9 .-]/g, '').trim()

const tlv = (id: string, v: string) => `${id}${String(v.length).padStart(2, '0')}${v}`

/** CRC-16/CCITT-FALSE (chuẩn EMVCo) */
export function crc16(s: string) {
  let crc = 0xffff
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/**
 * Nội dung mã VietQR (EMVCo / NAPAS 247) tạo ngay trên máy, không cần dịch vụ ngoài.
 * Không có số tiền → mã tĩnh (người quét tự nhập số tiền).
 */
export function vietQrPayload(bank: { bin: string; account_no: string }, amount?: number | null, note?: string | null) {
  const account = tlv('00', 'A000000727') + tlv('01', tlv('00', bank.bin) + tlv('01', bank.account_no)) + tlv('02', 'QRIBFTTA')
  const info = note ? plain(note).slice(0, 25) : ''
  let s = tlv('00', '01') + tlv('01', amount ? '12' : '11') + tlv('38', account) + tlv('53', '704')
  if (amount) s += tlv('54', String(Math.round(amount)))
  s += tlv('58', 'VN')
  if (info) s += tlv('62', tlv('08', info))
  s += '6304'
  return s + crc16(s)
}
