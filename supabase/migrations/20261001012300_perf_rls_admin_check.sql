-- Tăng tốc đọc dữ liệu: các chính sách RLS gọi is_system_admin() cho TỪNG DÒNG. Bọc thành (select public.is_system_admin())
-- để Postgres tính 1 lần cho cả câu truy vấn (khuyến nghị của Supabase). Quyền truy cập giữ nguyên tuyệt đối:
-- chỉ đổi cách viết biểu thức, không thêm/bớt điều kiện. Chạy lại nhiều lần an toàn (đã bọc thì bỏ qua).
do $$
declare
  r record;
  v_qual text;
  v_check text;
  pat constant text := '(?<!SELECT )(public\.)?is_system_admin\(\)';
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and (coalesce(qual, '') ~ pat or coalesce(with_check, '') ~ pat)
  loop
    v_qual := case when r.qual is null then null else regexp_replace(r.qual, pat, '( SELECT public.is_system_admin())', 'g') end;
    v_check := case when r.with_check is null then null else regexp_replace(r.with_check, pat, '( SELECT public.is_system_admin())', 'g') end;
    if v_qual is not null and v_check is not null then
      execute format('alter policy %I on %I.%I using (%s) with check (%s)', r.policyname, r.schemaname, r.tablename, v_qual, v_check);
    elsif v_qual is not null then
      execute format('alter policy %I on %I.%I using (%s)', r.policyname, r.schemaname, r.tablename, v_qual);
    else
      execute format('alter policy %I on %I.%I with check (%s)', r.policyname, r.schemaname, r.tablename, v_check);
    end if;
  end loop;
end $$;

-- club_is_member / club_is_staff được RLS gọi cho từng dòng. Kiểm tra thành viên (1 lần tra chỉ mục) TRƯỚC,
-- chỉ khi không phải thành viên mới kiểm tra quyền admin hệ thống (nhiều lượt tra cứu). Kết quả y hệt bản cũ.
create or replace function public.club_is_member(p_club uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.club_members
                  where club_id = p_club and user_id = auth.uid() and status = 'APPROVED') then true
    else public.is_system_admin()
  end
$$;

create or replace function public.club_is_staff(p_club uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.club_members
                  where club_id = p_club and user_id = auth.uid() and status = 'APPROVED'
                    and role in ('OWNER', 'CAPTAIN')) then true
    else public.is_system_admin()
  end
$$;
