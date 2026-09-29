-- 011200: THỬ THÁCH ĐÃ HỦY KHÔNG CÒN HIỆN TRÊN TRANG CHỦ / BẢNG TIN CLB
--   • Hủy thử thách (người tạo, ban quản trị CLB hay admin — mọi đường hủy) → bài "Thử thách mới" trên bảng tin CLB tự ẩn,
--     nên không còn hiện ở Bảng tin cộng đồng (trang chủ) và bảng tin CLB. Trang chi tiết thử thách vẫn mở được (báo "đã bị hủy").
--   • Dọn luôn bài của các thử thách đã hủy trước đây.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create or replace function private.hide_cancelled_challenge_posts() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.club_posts set deleted_at = now()
   where kind = 'CHALLENGE' and deleted_at is null and meta->>'challenge_id' = new.id::text;
  return null;
end $$;
revoke all on function private.hide_cancelled_challenge_posts() from public, anon, authenticated;

drop trigger if exists trg_hide_cancelled_challenge_posts on public.challenges;
create trigger trg_hide_cancelled_challenge_posts after update of status on public.challenges
  for each row when (new.status = 'CANCELLED' and old.status is distinct from 'CANCELLED')
  execute function private.hide_cancelled_challenge_posts();

update public.club_posts p set deleted_at = now()
  from public.challenges c
 where p.kind = 'CHALLENGE' and p.deleted_at is null and c.status = 'CANCELLED' and p.meta->>'challenge_id' = c.id::text;
