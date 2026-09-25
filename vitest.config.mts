import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
      // 'server-only' ném lỗi ngoài môi trường React Server — thay bằng module rỗng khi test
      'server-only': path.resolve(__dirname, 'tests/stubs/empty.ts'),
      // next/font chỉ có khi build Next — module nhân vật / thiết kế nạp font khi dùng, test dùng font giả
      'next/font/google': path.resolve(__dirname, 'tests/stubs/next-font.ts'),
    },
  },
  test: { include: ['**/*.test.ts'], exclude: ['node_modules/**', '.next/**'] },
})
