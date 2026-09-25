/** Ảnh mã VietQR (chuẩn NAPAS 247) có sẵn số tiền + nội dung — mở app ngân hàng quét là chuyển */
export function vietQrUrl(bank: { bin: string; account_no: string; account_name: string }, amount: number, note: string) {
  const q = new URLSearchParams({ amount: String(Math.round(amount)), addInfo: note, accountName: bank.account_name })
  return `https://img.vietqr.io/image/${bank.bin}-${encodeURIComponent(bank.account_no)}-compact2.png?${q.toString()}`
}
