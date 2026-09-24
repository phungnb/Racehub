import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Chỉ có tác dụng khi chạy `next dev`: cho phép mở app qua địa chỉ GitHub Codespaces
  // (https://<tên>-3000.app.github.dev), nếu không trình duyệt không tải được tài nguyên dev.
  allowedDevOrigins: ["*.app.github.dev"],
  // Service worker phải luôn lấy bản mới nhất, không để CDN/trình duyệt cache
  async headers() {
    return [{
      source: "/sw.js",
      headers: [
        { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Service-Worker-Allowed", value: "/" },
      ],
    }];
  },
};

export default nextConfig;
