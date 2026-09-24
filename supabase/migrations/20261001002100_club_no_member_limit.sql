-- 002100: Bỏ giới hạn số thành viên CLB.
-- CLB chạy bộ không cần trần thành viên; cột member_limit giữ lại (các hàm cũ còn đọc) nhưng đặt rất lớn
-- để join_club / duyệt thành viên không bao giờ báo CLUB_FULL. Chạy lại nhiều lần vẫn an toàn.

alter table public.clubs drop constraint if exists clubs_member_limit_chk;
alter table public.clubs add constraint clubs_member_limit_chk check (member_limit >= 2);
alter table public.clubs alter column member_limit set default 1000000;
update public.clubs set member_limit = 1000000 where member_limit < 1000000;
