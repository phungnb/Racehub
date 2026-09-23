import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
      // 'server-only' ném lỗi ngoài môi trường React Server — thay bằng module rỗng khi test
      'server-only': path.resolve(__dirname, 'tests/stubs/empty.ts'),
    },
  },
  test: { include: ['**/*.test.ts'], exclude: ['node_modules/**', '.next/**'] },
})
