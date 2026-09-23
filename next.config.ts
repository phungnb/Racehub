import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Chỉ có tác dụng khi chạy `next dev`: cho phép mở app qua địa chỉ GitHub Codespaces
  // (https://<tên>-3000.app.github.dev), nếu không trình duyệt không tải được tài nguyên dev.
  allowedDevOrigins: ["*.app.github.dev"],
};

export default nextConfig;
