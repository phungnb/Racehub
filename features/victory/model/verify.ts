/** Đường dẫn trang xác thực công khai của một mã */
export const verifyUrlOf = (origin: string, code: string) => `${origin.replace(/\/$/, '')}/v/${encodeURIComponent(code)}`
