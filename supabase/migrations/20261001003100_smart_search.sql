-- 003100: Tìm kiếm linh hoạt cho CLB, VĐV, tài khoản (admin).
-- • Không phân biệt dấu / hoa thường / cách gõ (Unicode dựng sẵn hay tổ hợp của Unikey đều được):
--   "ho tay", "Hồ Tây", "HO TAY" đều ra "Hồ Tây Runners".
-- • Nhiều từ, không cần đúng thứ tự: "an nguyen" ra "Nguyễn Văn An".
-- • Viết tắt chữ cái đầu: "nbnr" ra "No Beer No Run"; CLB tìm được cả theo link riêng (slug).
-- • Xếp hạng: trùng khớp > bắt đầu bằng > đầu một từ > chứa; rồi CLB đông người / VĐV cấp cao.
-- • CLB "chỉ qua mã mời" không hiện ở danh sách khám phá, nhưng gõ đúng / đủ tên thì vẫn tìm thấy.
-- Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- Chuẩn hóa: dựng sẵn (NFC) → bỏ dấu tiếng Việt → chữ thường → chỉ giữ a-z0-9, các từ cách nhau 1 dấu cách
create or replace function private.search_key(p text) returns text
language sql immutable parallel safe as $$
  select trim(regexp_replace(lower(translate(normalize(coalesce(p, ''), NFC),
    'àáảãạằắẳẵặăầấẩẫậâèéẻẽẹềếểễệêìíỉĩịòóỏõọồốổỗộôờớởỡợơùúủũụừứửữựưỳýỷỹỵđÀÁẢÃẠẰẮẲẴẶĂẦẤẨẪẬÂÈÉẺẼẸỀẾỂỄỆÊÌÍỈĨỊÒÓỎÕỌỒỐỔỖỘÔỜỚỞỠỢƠÙÚỦŨỤỪỨỬỮỰƯỲÝỶỸỴĐ',
    'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyydaaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd')), '[^a-z0-9]+', ' ', 'g'))
$$;

-- Chuỗi để dò: tên đã chuẩn hóa + chữ cái đầu mỗi từ (khi có từ 2 từ)
create or replace function private.search_hay(p text) returns text
language sql immutable parallel safe as $$
  select ' ' || k || coalesce(' ' || (select case when count(*) > 1 then string_agg(left(w, 1), '') end
                                        from regexp_split_to_table(k, ' ') w where w <> ''), '') || ' '
    from (select private.search_key(p) as k) s
$$;

-- Mọi từ trong câu tìm đều phải xuất hiện (không cần đúng thứ tự)
create or replace function private.search_match(p_hay text, p_query text) returns boolean
language sql immutable parallel safe as $$
  select private.search_key(p_query) <> ''
     and not exists (select 1 from regexp_split_to_table(private.search_key(p_query), ' ') t
                      where t <> '' and position(t in p_hay) = 0)
$$;

-- Điểm xếp hạng (nhỏ = khớp hơn): 0 trùng, 1 bắt đầu bằng, 2 đầu một từ / viết tắt, 3 chứa
create or replace function private.search_rank(p_name text, p_query text) returns int
language sql immutable parallel safe as $$
  select case
    when k = q then 0
    when k like q || '%' then 1
    when private.search_hay(p_name) like '% ' || q || '%' then 2
    else 3 end
    from (select private.search_key(p_name) as k, private.search_key(p_query) as q) s
$$;

-- ---------------------------------------------------------------------
-- 1. Tìm CLB (thay truy vấn ilike ở client). Không trả mã mời.
-- ---------------------------------------------------------------------
create or replace function public.search_clubs(p_query text default '', p_limit int default 20) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.j order by x.rk, x.member_count desc, x.name), '[]'::jsonb)
    from (
      select to_jsonb(c) - 'invite_code' as j, c.name, c.member_count,
             case when private.search_key(p_query) = '' then 0 else private.search_rank(c.name, p_query) end as rk,
             row_number() over (order by case when private.search_key(p_query) = '' then 0 else private.search_rank(c.name, p_query) end,
                                         c.member_count desc, c.name) as rn
        from public.clubs c
       where case when private.search_key(p_query) = '' then c.join_policy <> 'INVITE_ONLY'
                  else (private.search_match(private.search_hay(c.name) || coalesce(c.slug, '') || ' ', p_query)
                        and (c.join_policy <> 'INVITE_ONLY' or private.search_rank(c.name, p_query) <= 1 or c.slug = lower(trim(p_query)))) end
    ) x
   where x.rn <= least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

-- ---------------------------------------------------------------------
-- 2. Tìm VĐV (thay bản ilike cũ)
-- ---------------------------------------------------------------------
create or replace function public.search_athletes(p_query text, p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if char_length(private.search_key(p_query)) < 2 then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'display_name', t.display_name, 'avatar_url', t.avatar_url,
                                                       'level', t.level, 'region', t.region) order by t.rn), '[]'::jsonb)
    from (select p.id, p.display_name, p.avatar_url, p.level, s.region,
                 row_number() over (order by private.search_rank(p.display_name, p_query), p.level desc nulls last, p.display_name) as rn
            from public.profiles p
            left join public.profile_settings s on s.user_id = p.id
           where private.search_match(private.search_hay(p.display_name), p_query)
             and p.id <> auth.uid()
             and coalesce(s.profile_visibility, 'PUBLIC') <> 'PRIVATE') t
   where t.rn <= least(greatest(coalesce(p_limit, 20), 1), 30));
end $$;

-- ---------------------------------------------------------------------
-- 3. Admin: tìm tài khoản (tên / email / id) và CLB để điều phối Xu
-- ---------------------------------------------------------------------
create or replace function public.admin_search_accounts(p_query text)
returns table (kind text, id uuid, name text, subtitle text, balance numeric)
language plpgsql stable security definer set search_path = public, auth as $$
declare q text := trim(coalesce(p_query, ''));
begin
  perform private.require_admin();
  if char_length(q) < 2 then return; end if;
  return query
  select u.kind, u.id, u.name, u.subtitle, u.balance from (
    select 'USER'::text as kind, pr.id, coalesce(pr.display_name, 'Runner') as name, coalesce(au.email, '') as subtitle, private.balance(pr.id) as balance,
           0 as grp, row_number() over (order by private.search_rank(pr.display_name, q), pr.display_name) as rn
      from public.profiles pr left join auth.users au on au.id = pr.id
     where private.search_match(private.search_hay(pr.display_name), q) or au.email ilike '%' || q || '%' or pr.id::text = q
    union all
    select 'CLUB'::text, c.id, c.name, c.member_count || ' thành viên', private.balance(c.id),
           1, row_number() over (order by private.search_rank(c.name, q), c.member_count desc)
      from public.clubs c
     where private.search_match(private.search_hay(c.name) || coalesce(c.slug, '') || ' ', q) or c.id::text = q
  ) u
  where (u.grp = 0 and u.rn <= 15) or (u.grp = 1 and u.rn <= 10)
  order by u.grp, u.rn;
end $$;

-- Admin: danh sách CLB (CLB Pro)
create or replace function public.admin_list_clubs(p_query text default '') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url, 'accent_color', c.accent_color,
            'member_count', c.member_count, 'plan', c.plan, 'pro_until', c.pro_until, 'slug', c.slug, 'active', private.club_is_pro(c.id))
            order by c.rn), '[]'::jsonb)
    from (select x.*, row_number() over (order by
                   case when private.search_key(p_query) = '' then 0 else private.search_rank(x.name, p_query) end,
                   (x.plan = 'PRO') desc, x.member_count desc) as rn
            from public.clubs x
           where private.search_key(p_query) = ''
              or private.search_match(private.search_hay(x.name) || coalesce(x.slug, '') || ' ', p_query)) c
   where c.rn <= 50);
end $$;

revoke all on function private.search_key(text), private.search_hay(text), private.search_match(text, text), private.search_rank(text, text)
  from public, anon, authenticated;
revoke all on function public.search_clubs(text, int), public.search_athletes(text, integer), public.admin_search_accounts(text), public.admin_list_clubs(text) from public, anon;
grant execute on function public.search_clubs(text, int), public.search_athletes(text, integer), public.admin_search_accounts(text), public.admin_list_clubs(text) to authenticated;

notify pgrst, 'reload schema';
