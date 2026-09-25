-- 003300: Gợi ý tìm kiếm cho admin + sửa kho ảnh BIB.
-- • admin_search_accounts: ô trống → gợi ý (người mới tham gia + CLB đông nhất);
--   gõ 1 ký tự → khớp đầu từ; từ 2 ký tự → như 003100 (không dấu, nhiều từ, viết tắt, email, id).
-- • Kho race-media: kiểm tra đường dẫn an toàn (không lỗi "invalid input syntax for type uuid"
--   khi tên thư mục không phải uuid), nâng giới hạn ảnh lên 10 MB (app tự nén trước khi tải).
-- Cần file 003100. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

create or replace function public.admin_search_accounts(p_query text)
returns table (kind text, id uuid, name text, subtitle text, balance numeric)
language plpgsql stable security definer set search_path = public, auth as $$
declare
  q text := trim(coalesce(p_query, ''));
  k text := private.search_key(p_query);
begin
  perform private.require_admin();
  return query
  select u.kind, u.id, u.name, u.subtitle, private.balance(u.id) from (
    select 'USER'::text as kind, pr.id, coalesce(pr.display_name, 'Runner') as name, coalesce(au.email, '')::text as subtitle,
           0 as grp,
           row_number() over (order by
             case when k = '' then 0 else private.search_rank(pr.display_name, q) end,
             case when k = '' then pr.created_at end desc nulls last, pr.display_name) as rn
      from public.profiles pr left join auth.users au on au.id = pr.id
     where k = ''
        or (char_length(k) = 1 and private.search_hay(pr.display_name) like '% ' || k || '%')
        or (char_length(k) > 1 and (private.search_match(private.search_hay(pr.display_name), q) or au.email ilike '%' || q || '%' or pr.id::text = q))
    union all
    select 'CLUB'::text, c.id, c.name, (c.member_count || ' thành viên')::text,
           1,
           row_number() over (order by case when k = '' then 0 else private.search_rank(c.name, q) end, c.member_count desc)
      from public.clubs c
     where k = ''
        or (char_length(k) = 1 and private.search_hay(c.name) like '% ' || k || '%')
        or (char_length(k) > 1 and (private.search_match(private.search_hay(c.name) || coalesce(c.slug, '') || ' ', q) or c.id::text = q))
  ) u
  where (u.grp = 0 and u.rn <= case when k = '' then 6 else 12 end) or (u.grp = 1 and u.rn <= case when k = '' then 4 else 8 end)
  order by u.grp, u.rn;
end $$;

-- Đường dẫn race-media/<race_id>/<user_id>/<file>: người tải là chính mình và quản lý giải đó
create or replace function public.can_upload_race_media(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when (storage.foldername(p_name))[1] !~ '^[0-9a-fA-F-]{36}$' then false
    when (storage.foldername(p_name))[2] is distinct from auth.uid()::text then false
    else public.can_manage_race(((storage.foldername(p_name))[1])::uuid) end
$$;

drop policy if exists race_media_insert on storage.objects;
create policy race_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'race-media' and public.can_upload_race_media(name));

update storage.buckets set file_size_limit = 10485760 where id = 'race-media';

revoke all on function public.admin_search_accounts(text), public.can_upload_race_media(text) from public, anon;
grant execute on function public.admin_search_accounts(text), public.can_upload_race_media(text) to authenticated;

notify pgrst, 'reload schema';
