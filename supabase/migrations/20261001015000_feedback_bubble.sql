-- 015000: HỘP THƯ GÓP Ý (bong bóng nổi trong app)
-- Người dùng gửi góp ý / điểm hài lòng / báo lỗi; admin xem và đánh dấu đã xử lý (Quản trị → Cộng đồng → Góp ý).
-- Chỉ ghi qua RPC (client không đụng bảng). Mỗi người tối đa 5 góp ý / 24 giờ. Chạy lại an toàn.
create table if not exists public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('IDEA', 'BUG', 'LOVE', 'OTHER')),
  rating smallint check (rating between 1 and 5),
  body text not null default '' check (char_length(body) <= 1000),
  platform text,
  page text,
  status text not null default 'NEW' check (status in ('NEW', 'DONE')),
  admin_note text,
  handled_by uuid references public.profiles(id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists app_feedback_status_idx on public.app_feedback (status, created_at desc);
create index if not exists app_feedback_user_idx on public.app_feedback (user_id, created_at desc);
alter table public.app_feedback enable row level security;
revoke all on public.app_feedback from anon, authenticated;

-- Gửi góp ý: cần điểm hài lòng HOẶC lời nhắn (≥ 3 ký tự)
create or replace function public.submit_feedback(p_kind text, p_rating integer default null, p_body text default null,
                                                  p_platform text default null, p_page text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_body text := trim(coalesce(p_body, ''));
begin
  if upper(coalesce(p_kind, '')) not in ('IDEA', 'BUG', 'LOVE', 'OTHER') then raise exception 'INVALID_FEEDBACK_KIND'; end if;
  if p_rating is not null and (p_rating < 1 or p_rating > 5) then raise exception 'INVALID_FEEDBACK_RATING'; end if;
  if char_length(v_body) > 1000 then raise exception 'FEEDBACK_TOO_LONG'; end if;
  if p_rating is null and char_length(v_body) < 3 then raise exception 'FEEDBACK_EMPTY'; end if;
  if (select count(*) from public.app_feedback f where f.user_id = v_uid and f.created_at > now() - interval '24 hours') >= 5 then
    raise exception 'FEEDBACK_RATE_LIMIT';
  end if;
  insert into public.app_feedback (user_id, kind, rating, body, platform, page)
  values (v_uid, upper(p_kind), p_rating, v_body, left(nullif(trim(coalesce(p_platform, '')), ''), 30), left(nullif(trim(coalesce(p_page, '')), ''), 120));
end $$;

-- Admin: danh sách góp ý (p_status: NEW | DONE | ALL) + số liệu tóm tắt
create or replace function public.admin_feedback_list(p_status text default 'NEW') returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'new_count', (select count(*) from public.app_feedback where status = 'NEW'),
    'avg_rating', (select round(avg(rating)::numeric, 2) from public.app_feedback where rating is not null),
    'rating_count', (select count(*) from public.app_feedback where rating is not null),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'user_id', x.user_id, 'name', private.display_name(x.user_id), 'email', u.email,
        'kind', x.kind, 'rating', x.rating, 'body', x.body, 'platform', x.platform, 'page', x.page,
        'status', x.status, 'admin_note', x.admin_note, 'handled_by', private.display_name(x.handled_by),
        'handled_at', x.handled_at, 'created_at', x.created_at) order by x.created_at desc)
      from (select * from public.app_feedback f
             where upper(coalesce(p_status, 'ALL')) = 'ALL' or f.status = upper(p_status)
             order by f.created_at desc limit 300) x
      left join auth.users u on u.id = x.user_id), '[]'::jsonb));
end $$;

-- Admin: đánh dấu đã xử lý / mở lại (kèm ghi chú)
create or replace function public.admin_feedback_set_status(p_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_admin uuid := private.require_admin();
begin
  if upper(coalesce(p_status, '')) not in ('NEW', 'DONE') then raise exception 'INVALID_FEEDBACK_STATUS'; end if;
  if not exists (select 1 from public.app_feedback where id = p_id) then raise exception 'FEEDBACK_NOT_FOUND'; end if;
  update public.app_feedback
     set status = upper(p_status), admin_note = nullif(trim(coalesce(p_note, '')), ''),
         handled_by = case when upper(p_status) = 'DONE' then v_admin end,
         handled_at = case when upper(p_status) = 'DONE' then now() end
   where id = p_id;
end $$;

revoke all on function public.submit_feedback(text, integer, text, text, text),
  public.admin_feedback_list(text), public.admin_feedback_set_status(uuid, text, text) from public, anon;
grant execute on function public.submit_feedback(text, integer, text, text, text),
  public.admin_feedback_list(text), public.admin_feedback_set_status(uuid, text, text) to authenticated;
notify pgrst, 'reload schema';
