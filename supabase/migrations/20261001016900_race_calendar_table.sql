-- 016900: Bảng tổng hợp giải chạy (offline + online) thay cho đăng từng bài rời.
-- • race_candidates thêm: kind (OFFLINE / ONLINE), reg_deadline (hạn đăng ký), reg_url (link đăng ký), race_url (link trang giải).
-- • Admin chọn nhiều dòng trong hàng chờ rồi "Đưa vào bảng" (status APPROVED, không cần tạo tin giải riêng cho từng giải).
-- • race_calendar(): mọi người đăng nhập đọc được bảng các giải đã duyệt, chưa kết thúc. Chỉ trả cột cần hiển thị.
-- Chạy lại nhiều lần vẫn an toàn.
alter table public.race_candidates add column if not exists kind text not null default 'OFFLINE';
alter table public.race_candidates add column if not exists reg_deadline date;
alter table public.race_candidates add column if not exists reg_url text;
alter table public.race_candidates add column if not exists race_url text;
alter table public.race_candidates drop constraint if exists race_candidates_kind_check;
alter table public.race_candidates add constraint race_candidates_kind_check check (kind in ('OFFLINE', 'ONLINE'));
alter table public.race_candidates drop constraint if exists race_candidates_reg_url_check;
alter table public.race_candidates add constraint race_candidates_reg_url_check
  check (reg_url is null or (reg_url ~* '^https?://[^[:space:]]+$' and char_length(reg_url) <= 1000));
alter table public.race_candidates drop constraint if exists race_candidates_race_url_check;
alter table public.race_candidates add constraint race_candidates_race_url_check
  check (race_url is null or (race_url ~* '^https?://[^[:space:]]+$' and char_length(race_url) <= 1000));

create or replace function public.race_calendar() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'kind', c.kind, 'title', c.title, 'location', c.location, 'race_date', c.race_date, 'end_date', c.end_date,
    'reg_deadline', c.reg_deadline, 'race_url', coalesce(c.race_url, split_part(c.url, '#', 1)), 'reg_url', c.reg_url,
    'distances', c.distances, 'organizer', c.organizer
  ) order by c.kind, c.race_date, c.title), '[]'::jsonb)
  from public.race_candidates c
  where c.status = 'APPROVED'
    and coalesce(c.end_date, c.race_date) >= (now() at time zone 'Asia/Ho_Chi_Minh')::date - 1
    and auth.uid() is not null;
$$;
revoke all on function public.race_calendar() from public, anon;
grant execute on function public.race_calendar() to authenticated;

notify pgrst, 'reload schema';
