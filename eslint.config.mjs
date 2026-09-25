import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  // Không dùng `any` và không setState đồng bộ trong useEffect (dùng TanStack Query / state dẫn xuất).
  // Test DB đọc kết quả JSON tự do nên được phép dùng `any`.
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "react-hooks/set-state-in-effect": "error",
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  // Ranh giới module (docs/CAU_TRUC_THU_MUC.md): ngoài một feature chỉ được
  // import qua cổng công khai '@/features/<tên>' (hoặc '<tên>/server').
  // Bên trong feature dùng import tương đối.
  {
    files: ["app/**/*.{ts,tsx}", "features/**/*.{ts,tsx}", "shared/**/*.{ts,tsx}", "proxy.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["@/features/*/*", "!@/features/*/server"],
          message: "Import qua cổng công khai '@/features/<module>' (xem docs/CAU_TRUC_THU_MUC.md).",
        }],
      }],
    },
  },
  {
    files: ["shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{ group: ["@/features/**", "@/app/**"], message: "shared/ không được phụ thuộc features/ hoặc app/." }],
      }],
    },
  },
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "docs/**",
    // Dự án native của app cài (Capacitor) — tệp sinh tự động
    "android/**",
    "ios/**",
    "mobile/**",
  ]),
]);

export default eslintConfig;
