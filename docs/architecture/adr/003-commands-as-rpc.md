# ADR-003: Command có giá trị là Postgres RPC dùng `auth.uid()`

**Bối cảnh.** Hiện client gọi `insert/update` trực tiếp lên `profiles`, `activities`, `challenge_participants`, và nhiều RPC nhận `p_user_id` từ client. Người dùng có thể mở DevTools và gọi Supabase với bất kỳ tham số nào.

**Quyết định.**
1. Client **không có quyền ghi** vào bảng tài sản/trạng thái (ledger, xp, level, trust, progress, status). Chỉ `GRANT UPDATE` cột an toàn (tên, avatar…).
2. Mọi thay đổi có giá trị đi qua RPC `SECURITY DEFINER`, `set search_path = ''`, lấy người gọi từ `auth.uid()`, **không nhận `p_user_id`**.
3. RPC ném lỗi bằng mã ổn định. Client dịch mã sang thông báo.
4. REST (Next.js Route Handler) chỉ dùng khi cần secret hoặc gọi dịch vụ ngoài.

**Hệ quả.**
- Phải viết lại: `submit_and_process_activity`, `equip_item`, `has_permission`, `create_challenge_with_ledger` (bỏ `p_user_id`); `AdminDashboard` duyệt bài qua `review_activity`; tạo profile bằng trigger.
- Xóa `shared/lib/racehubEngine.ts` khỏi client.
- Rate limit cho RPC dễ bị spam (comment, friend request) bằng bảng đếm theo phút hoặc dùng `pg_net` + Upstash.
