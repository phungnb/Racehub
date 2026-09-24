# ADR-011: Ranh giới pháp lý của Xu và cơ chế cược

**Bối cảnh.** Tài liệu có: nạp Xu bằng tiền thật (MH 25 "nạp/rút"), đặt cược Xu giữa người dùng, sàn thu 5%, đổi Xu lấy voucher có giá trị thật, chợ nhượng BIB bằng VNĐ. Tổ hợp "nạp tiền thật → cược → rút ra tiền/giá trị thật" có nguy cơ bị xem là **kinh doanh cá cược / trò chơi có thưởng**. Lĩnh vực này bị quản lý chặt ở Việt Nam, và App Store / Google Play cũng có chính sách riêng về gambling.

**Quyết định (đề xuất kỹ thuật, cần luật sư xác nhận).**
- **Không có chức năng rút Xu ra tiền mặt.** Xu là điểm thưởng trong app.
- Ledger hỗ trợ tách hai loại ví nếu luật sư yêu cầu: `WALLET_EARNED` (kiếm bằng chạy, được dùng để cược/đổi voucher) và `WALLET_PURCHASED` (nạp bằng tiền, chỉ dùng cho shop/cheer). Mô hình `ledger_accounts.code` đã hỗ trợ việc này mà không cần đổi schema.
- Có giới hạn mức cược tối đa (50–1000 Xu theo tài liệu) và giới hạn theo ngày. Admin cấu hình được.
- BIB resell và coach booking xử lý bằng VNĐ qua cổng thanh toán, **tách hẳn khỏi Xu**.
- Cờ tính năng (feature flag) cho phép tắt cược theo thị trường hoặc theo nền tảng (ví dụ tắt trên bản iOS nếu bị từ chối review).

**Hệ quả.** Cần tư vấn pháp lý **trước** khi làm luồng nạp tiền (GĐ 4). Kiến trúc đã chừa sẵn đường để tuân thủ mà không phải làm lại.
