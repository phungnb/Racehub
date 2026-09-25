-- 003400: Chặn lộ mã mời và tài khoản ngân hàng CLB.
-- Trước đây ai (kể cả chưa đăng nhập) cũng đọc được clubs.invite_code qua API → tự vào CLB "chỉ qua mã mời",
-- và đọc được số tài khoản ngân hàng quỹ CLB. Nay bảng clubs chỉ cho đọc các cột công khai;
-- mã mời lấy qua club_invite_code (ban quản trị; thành viên nếu CLB không "chỉ qua mã mời"),
-- thông tin ngân hàng vẫn qua màn Quỹ (RPC riêng, chỉ thành viên).
-- Sửa lỗi: CLB "chỉ qua mã mời" trước đây không ai vào được (join_club_by_code gọi join_club, hàm này chặn INVITE_ONLY).
-- Nay có mã mời hợp lệ là vào thẳng CLB chỉ-qua-mã-mời; CLB "cần duyệt" vẫn chờ duyệt như cũ.
-- Cột mới thêm sau này mặc định KHÔNG đọc được, phải grant rõ ràng. Chạy lại nhiều lần vẫn an toàn.

revoke select on public.clubs from anon, authenticated;
grant select (id, name, description, logo_url, owner_id, created_at, treasury_balance, avatar_url, member_count, member_limit,
              join_policy, announcement, announced_at, announced_by, avatar_path, accent_color, plan, pro_until, slug)
  on public.clubs to anon, authenticated;

-- Mã mời của CLB
create or replace function public.club_invite_code(p_club_id uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare c public.clubs := (select x from public.clubs x where x.id = p_club_id);
begin
  if c.id is null then raise exception 'CLUB_NOT_FOUND'; end if;
  if public.club_is_staff(c.id) or (public.club_is_member(c.id) and c.join_policy <> 'INVITE_ONLY') then
    return c.invite_code;
  end if;
  raise exception 'FORBIDDEN';
end $$;

-- Bấm lại link mời cũ khi đã là thành viên → biết CLB nào để mở (chỉ trả khi đúng là thành viên)
create or replace function public.my_club_by_invite(p_code text) returns uuid
language sql stable security definer set search_path = public as $$
  select c.id from public.clubs c
   where c.invite_code = lower(trim(p_code))
     and exists (select 1 from public.club_members m where m.club_id = c.id and m.user_id = auth.uid() and m.status in ('APPROVED', 'PENDING'))
$$;

create or replace function public.join_club_by_code(p_code text) returns public.club_members
language plpgsql security definer set search_path = public as $$
declare
  v_club public.clubs := (select c from public.clubs c where c.invite_code = lower(trim(coalesce(p_code, ''))));
  v_cur public.club_members;
  v_row public.club_members;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_club.id is null then raise exception 'INVALID_INVITE'; end if;
  if v_club.join_policy <> 'INVITE_ONLY' then return public.join_club(v_club.id); end if;
  if v_club.member_count >= v_club.member_limit then raise exception 'CLUB_FULL'; end if;
  v_cur := (select m from public.club_members m where m.club_id = v_club.id and m.user_id = auth.uid());
  if v_cur.id is not null and v_cur.status = 'BANNED' then raise exception 'BANNED'; end if;
  if v_cur.id is not null and v_cur.status in ('PENDING', 'APPROVED') then raise exception 'ALREADY_MEMBER'; end if;
  insert into public.club_members (club_id, user_id, role, status)
  values (v_club.id, auth.uid(), 'MEMBER', 'APPROVED')
  on conflict (club_id, user_id) do update set status = 'APPROVED', role = 'MEMBER', joined_at = now()
  returning * into v_row;
  return v_row;
end $$;

-- Tìm CLB (003100): bỏ luôn thông tin ngân hàng khỏi kết quả
create or replace function public.search_clubs(p_query text default '', p_limit int default 20) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.j order by x.rk, x.member_count desc, x.name), '[]'::jsonb)
    from (
      select to_jsonb(c) - 'invite_code' - 'bank_bin' - 'bank_account_no' - 'bank_account_name' - 'bank_qr_url' as j, c.name, c.member_count,
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

revoke all on function public.join_club_by_code(text) from public, anon;
grant execute on function public.join_club_by_code(text) to authenticated;

revoke all on function public.club_invite_code(uuid), public.my_club_by_invite(text) from public, anon;
grant execute on function public.club_invite_code(uuid), public.my_club_by_invite(text) to authenticated;

notify pgrst, 'reload schema';
