# ADR-002: Sổ cái kép (double-entry ledger) cho RaceCoin

**Bối cảnh.** Xu xuất hiện ở rất nhiều luồng: thưởng chạy, nhiệm vụ, cọc 1-1 / đội / tiếp sức, escrow, phí sàn 5%, shop, cheer, quỹ CLB, ký quỹ tạo CLB (bị hủy 50% / chia 50% khi giải thể), referral, nạp tiền, voucher. Code hiện tại lưu `profiles.xu` và `clubs.treasury_balance` dạng một con số, nên không truy vết và không đối soát được.

**Quyết định.** Mọi số dư là một `ledger_account`. Mọi thay đổi là một `ledger_transaction` gồm ≥ 2 `ledger_entries` có tổng = 0, ghi qua **một hàm duy nhất** `post_ledger_transaction` (idempotent, khóa dòng, chặn âm). Bút toán không được sửa hay xóa. Muốn sửa sai thì ghi `REVERSAL`. Xu được phát hành từ `SYSTEM:MINT` và hủy vào `SYSTEM:BURN`.

**Lý do.** Đây là mô hình chuẩn của ngành tài chính. Nó trả lời được mọi câu hỏi "Xu này từ đâu ra?", cho phép thống kê cung tiền (FR39/FR40), phát hiện lỗi hoặc gian lận, và hỗ trợ escrow tự nhiên.

**Hệ quả.**
- Không còn cột `profiles.xu`. Số dư đọc từ `ledger_accounts.balance`, là cache được cập nhật cùng transaction.
- Job đối soát hằng ngày kiểm tra `balance = sum(entries)`.
- Dùng `numeric(18,2)` để thưởng 0.2 Xu/km chính xác, không lỗi làm tròn như float.
