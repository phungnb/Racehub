// Cổng xác nhận quyền. secscan chỉ chạy trên mục tiêu mà người dùng SỞ HỮU
// hoặc được CHO PHÉP KIỂM TRA bằng văn bản. Quét web người khác khi chưa được
// phép là vi phạm pháp luật; cổng này buộc người chạy khai báo rõ trách nhiệm,
// và ghi lời khai đó vào báo cáo để lưu vết.
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

const CONFIRM = 'TOI CO QUYEN'

/**
 * Trả về { target, authorizedBy } nếu được xác nhận; ném lỗi nếu không.
 * - Khi có cờ --i-am-authorized="<ai cho phép>": bỏ qua bước hỏi (dùng cho CI của chính mình).
 * - Nếu không: hỏi tương tác, người dùng phải gõ đúng câu xác nhận.
 */
export async function requireAuthorization(target, flagValue) {
  if (flagValue && String(flagValue).trim()) {
    return { target, authorizedBy: String(flagValue).trim(), mode: 'flag' }
  }
  if (!stdin.isTTY) {
    throw new Error(
      'Thiếu xác nhận quyền. Chạy lại kèm --i-am-authorized="tên người/đơn vị cho phép" ' +
      'khi không có bàn phím (ví dụ trong CI của chính anh).',
    )
  }
  const rl = createInterface({ input: stdin, output: stdout })
  try {
    stdout.write(
      `\n  MỤC TIÊU: ${target}\n` +
      '  Chỉ tiếp tục nếu anh SỞ HỮU mục tiêu này, hoặc có văn bản cho phép kiểm tra.\n' +
      `  Gõ đúng "${CONFIRM}" để xác nhận: `,
    )
    const answer = await rl.question('')
    if (answer.trim() !== CONFIRM) {
      throw new Error('Chưa xác nhận quyền — dừng lại.')
    }
    const who = (await rl.question('  Ai cho phép? (tên anh nếu là app của anh): ')).trim()
    return { target, authorizedBy: who || 'chủ sở hữu', mode: 'interactive' }
  } finally {
    rl.close()
  }
}
