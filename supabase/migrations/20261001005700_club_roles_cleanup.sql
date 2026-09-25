-- 005700: Sửa dứt điểm lỗi trao quyền Chủ nhiệm (mã UNK-…).
-- Nguyên nhân: bảng club_members trên production còn ràng buộc CŨ club_members_role_check (chỉ cho OWNER / ADMIN / MEMBER)
-- song song ràng buộc mới club_members_role_chk (OWNER / CAPTAIN / MEMBER). Migration 000500 có xóa ràng buộc cũ,
-- nhưng nếu file 500 từng dừng giữa chừng trên SQL Editor thì nó vẫn còn → đổi chủ nhiệm cũ thành CAPTAIN bị chặn.
-- Việc làm: đổi vai trò cũ ADMIN / VICE → CAPTAIN, xóa các ràng buộc cũ, giữ lại ràng buộc mới.
-- Chạy riêng được, chạy lại nhiều lần vẫn an toàn. Sau đó chạy lại 003500 (Kiểm tra hệ thống).

alter table public.club_members drop constraint if exists club_members_role_check;
alter table public.club_members drop constraint if exists club_members_status_check;
update public.club_members set role = 'CAPTAIN' where role in ('ADMIN', 'VICE');
alter table public.club_members drop constraint if exists club_members_role_chk;
alter table public.club_members add constraint club_members_role_chk check (role in ('OWNER', 'CAPTAIN', 'MEMBER'));

notify pgrst, 'reload schema';
