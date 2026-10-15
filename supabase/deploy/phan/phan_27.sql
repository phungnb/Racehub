-- RaceHub — PHẦN 27/28 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 016900, 017000
-- Supabase → SQL Editor → New query → dán TOÀN BỘ phần này → Run. Lỗi thì không có gì thay đổi; chạy lại vẫn an toàn.
-- Xong thì chạy phần tiếp theo.
begin;
-- ===================================================================
-- 20261001016900_race_calendar_table.sql
-- ===================================================================
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

-- ===================================================================
-- 20261001017000_race_source_keep_approved.sql
-- ===================================================================
-- 017000: Xoá nguồn quét KHÔNG làm mất giải đã đưa vào bảng tổng hợp.
-- Trước: xoá nguồn → xoá hết giải đã tìm từ nguồn (kể cả giải đã duyệt). Nay: giải APPROVED được giữ lại (source_id về null);
-- chỉ các giải chưa duyệt / bị lọc / đã bỏ của nguồn đó mới bị xoá theo.
-- Chạy lại nhiều lần vẫn an toàn.
alter table public.race_candidates drop constraint if exists race_candidates_source_id_fkey;
alter table public.race_candidates add constraint race_candidates_source_id_fkey
  foreign key (source_id) references public.race_sources(id) on delete set null;

create or replace function private.race_source_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.race_candidates where source_id = old.id and status <> 'APPROVED';
  return old;
end $$;
drop trigger if exists trg_race_source_cleanup on public.race_sources;
create trigger trg_race_source_cleanup before delete on public.race_sources
  for each row execute function private.race_source_cleanup();

notify pgrst, 'reload schema';

commit;
