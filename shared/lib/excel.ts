// Excel thật (.xlsx) cho xuất báo cáo / nhập danh sách — thư viện chỉ tải khi người dùng bấm (không làm nặng trang).
// Nhập: nhận .xlsx (sheet đầu) và .csv (phẩy / chấm phẩy / tab, có BOM) → mảng dòng chữ.

export type XlsxCell = string | number | null | undefined
export interface XlsxSheet { name: string; head: string[]; rows: XlsxCell[][]; widths?: number[] }

/** Tải file .xlsx nhiều sheet; dòng đầu in đậm, cố định khi cuộn, cột số căn phải */
export async function downloadXlsx(filename: string, sheets: XlsxSheet[]) {
  const { default: writeXlsxFile } = await import('write-excel-file')
  const data = sheets.map((s) => [
    s.head.map((h) => ({ value: h, fontWeight: 'bold' as const, backgroundColor: '#E8F5D0', wrap: true })),
    ...s.rows.map((r) => r.map((v) => (v === null || v === undefined || v === '' ? null
      : typeof v === 'number' ? { value: v, type: Number } : { value: String(v), type: String }))),
  ])
  const columns = sheets.map((s) => s.head.map((h, i) => ({
    width: s.widths?.[i] ?? Math.min(40, Math.max(10, h.length + 2, ...s.rows.slice(0, 200).map((r) => String(r[i] ?? '').length + 2))),
  })))
  await writeXlsxFile(data as never, {
    fileName: filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`,
    sheets: sheets.map((s) => s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1'),
    columns, stickyRowsCount: 1, fontFamily: 'Arial', fontSize: 11,
  } as never)
}

/** Đọc CSV (phẩy / chấm phẩy / tab, có ngoặc kép) → mảng dòng */
export function parseCsvText(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const first = src.split(/\r?\n/, 1)[0] ?? ''
  const sep = [';', '\t', ','].reduce((best, s) => (first.split(s).length > first.split(best).length ? s : best), ',')
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') q = false; else cell += ch
    } else if (ch === '"') q = true
    else if (ch === sep) { row.push(cell.trim()); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell.trim()); cell = ''
      if (row.some((c) => c)) rows.push(row)
      row = []
    } else cell += ch
  }
  row.push(cell.trim())
  if (row.some((c) => c)) rows.push(row)
  return rows
}

/** Đọc file người dùng chọn: .xlsx (sheet đầu tiên) hoặc .csv / .txt → mảng dòng chữ đã cắt khoảng trắng */
export async function readSpreadsheet(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xlsx') || file.type.includes('spreadsheetml')) {
    const { default: readXlsxFile } = await import('read-excel-file')
    const rows = await readXlsxFile(file)
    return rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c).trim())))
      .filter((r) => r.some((c) => c))
  }
  if (name.endsWith('.xls')) throw new Error('XLS_OLD')
  return parseCsvText(await file.text())
}

export const SPREADSHEET_ACCEPT = '.xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
