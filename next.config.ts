import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Chỉ có tác dụng khi chạy `next dev`: cho phép mở app qua địa chỉ GitHub Codespaces
  // (https://<tên>-3000.app.github.dev), nếu không trình duyệt không tải được tài nguyên dev.
  allowedDevOrigins: ["*.app.github.dev"],
  // Service worker phải luôn lấy bản mới nhất, không để CDN/trình duyệt cache
  async headers() {
    // Header bảo mật cho mọi trang: chống nhúng iframe (clickjacking), chống đoán kiểu tệp, hạn chế gửi referrer,
    // chỉ cho dùng camera (quét QR điểm danh) và vị trí (ghi GPS) trên chính RaceHub, bắt buộc HTTPS.
    const security = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=(), payment=(), usb=()" },
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    ];
    return [{ source: "/:path*", headers: security }, {
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
