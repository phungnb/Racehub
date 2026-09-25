-- 004400: Thông báo hệ thống + nhật ký lỗi phía người dùng.
-- 1. Admin đặt một thông báo chung (thông tin / cảnh báo / bảo trì) hiện ở đầu app cho mọi người, có hạn tự tắt.
--    public.system_notice() đọc được cả khi chưa đăng nhập (màn đăng nhập cũng thấy thông báo bảo trì).
-- 2. App tự gửi lỗi người dùng gặp (mất kết nối máy chủ, máy chủ lỗi, tính năng chưa cập nhật…) về đây, gộp theo
--    mã lỗi mỗi ngày — admin xem ở Quản trị → Hệ thống để biết sự cố trước khi người dùng báo.
--    Chống spam: mỗi người tối đa 30 lần gửi / giờ, toàn hệ thống tối đa 2.000 mã lỗi khác nhau / ngày.
-- Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 1. Thông báo hệ thống
-- ---------------------------------------------------------------------
create table if not exists private.system_notice (
  id integer primary key default 1 check (id = 1),
  level text not null check (level in ('INFO', 'WARNING', 'MAINTENANCE')),
  title text not null,
  message text,
  until timestamptz,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
revoke all on private.system_notice from public, anon, authenticated;

create or replace function public.system_notice() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('level', n.level, 'title', n.title, 'message', n.message, 'until', n.until, 'updated_at', n.updated_at)
  from private.system_notice n
  where n.id = 1 and (n.until is null or n.until > now())
$$;

create or replace function public.admin_set_system_notice(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  v_level text := upper(coalesce(p->>'level', ''));
  v_title text := trim(coalesce(p->>'title', ''));
  v_msg text := nullif(trim(coalesce(p->>'message', '')), '');
  v_until timestamptz := nullif(p->>'until', '')::timestamptz;
begin
  -- Gửi rỗng / level trống = tắt thông báo
  if p is null or v_level = '' then
    delete from private.system_notice where id = 1;
    insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SYSTEM_NOTICE_OFF', 'system_notice', '{}'::jsonb);
    return null;
  end if;
  if v_level not in ('INFO', 'WARNING', 'MAINTENANCE') then raise exception 'INVALID_LEVEL'; end if;
  if char_length(v_title) not between 2 and 80 then raise exception 'INVALID_TITLE'; end if;
  if char_length(coalesce(v_msg, '')) > 500 then raise exception 'INVALID_MESSAGE'; end if;
  if v_until is not null and v_until <= now() then raise exception 'INVALID_TIME_RANGE'; end if;
  insert into private.system_notice (id, level, title, message, until, updated_by, updated_at)
  values (1, v_level, v_title, v_msg, v_until, v_uid, now())
  on conflict (id) do update set level = excluded.level, title = excluded.title, message = excluded.message,
    until = excluded.until, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SYSTEM_NOTICE', 'system_notice', p);
  return public.system_notice();
end $$;

revoke all on function public.system_notice(), public.admin_set_system_notice(jsonb) from public;
grant execute on function public.system_notice() to anon, authenticated;
revoke all on function public.admin_set_system_notice(jsonb) from anon;
grant execute on function public.admin_set_system_notice(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Nhật ký lỗi phía người dùng (gộp theo ngày + mã lỗi)
-- ---------------------------------------------------------------------
create table if not exists private.client_errors (
  day date not null,
  code text not null,
  kind text not null,
  message text,
  path text,
  hits integer not null default 1,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  primary key (day, code)
);
create table if not exists private.client_error_users (
  day date not null,
  code text not null,
  user_id uuid not null,
  primary key (day, code, user_id)
);
create table if not exists private.client_error_hits (user_id uuid not null, at timestamptz not null default now());
create index if not exists client_error_hits_idx on private.client_error_hits (user_id, at);
revoke all on private.client_errors, private.client_error_users, private.client_error_hits from public, anon, authenticated;

create or replace function public.log_client_error(p_kind text, p_code text, p_message text default null, p_path text default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_day date := private.vn_day(now());
  v_kind text := upper(coalesce(p_kind, ''));
  v_code text := left(coalesce(p_code, ''), 16);
begin
  if v_uid is null then return false; end if;
  if v_kind not in ('OFFLINE', 'NETWORK', 'TIMEOUT', 'AUTH', 'FORBIDDEN', 'NOT_DEPLOYED', 'RATE_LIMIT', 'SERVER', 'UNKNOWN') then return false; end if;
  if v_code !~ '^[A-Z]{3}-[0-9A-Z]{3}$' then return false; end if;
  delete from private.client_error_hits where user_id = v_uid and at < now() - interval '1 hour';
  if (select count(*) from private.client_error_hits h where h.user_id = v_uid) >= 30 then return false; end if;
  if not exists (select 1 from private.client_errors e where e.day = v_day and e.code = v_code)
     and (select count(*) from private.client_errors e where e.day = v_day) >= 2000 then return false; end if;
  insert into private.client_error_hits (user_id) values (v_uid);
  insert into private.client_errors (day, code, kind, message, path)
  values (v_day, v_code, v_kind, left(p_message, 300), left(p_path, 120))
  on conflict (day, code) do update set hits = private.client_errors.hits + 1, last_at = now(),
    message = coalesce(excluded.message, private.client_errors.message), path = coalesce(excluded.path, private.client_errors.path);
  insert into private.client_error_users (day, code, user_id) values (v_day, v_code, v_uid) on conflict do nothing;
  -- Dọn dữ liệu cũ hơn 60 ngày
  delete from private.client_errors where day < v_day - 60;
  delete from private.client_error_users where day < v_day - 60;
  return true;
end $$;

create or replace function public.admin_client_errors(p_days integer default 7) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  v_from date := private.vn_day(now()) - (least(greatest(coalesce(p_days, 7), 1), 60) - 1);
begin
  return (
    select coalesce(jsonb_agg(to_jsonb(r) - 'rn' order by r.last_at desc), '[]'::jsonb)
    from (
      select g.*, row_number() over (order by g.last_at desc) rn
      from (
        select e.code, max(e.kind) kind, (array_agg(e.message order by e.last_at desc))[1] message,
               (array_agg(e.path order by e.last_at desc))[1] path, sum(e.hits)::integer hits,
               (select count(distinct u.user_id) from private.client_error_users u where u.code = e.code and u.day >= v_from)::integer users,
               count(*)::integer days, min(e.first_at) first_at, max(e.last_at) last_at
        from private.client_errors e
        where e.day >= v_from
        group by e.code
      ) g
    ) r
    where r.rn <= 200);
end $$;

revoke all on function public.log_client_error(text, text, text, text), public.admin_client_errors(integer) from public, anon;
grant execute on function public.log_client_error(text, text, text, text), public.admin_client_errors(integer) to authenticated;

notify pgrst, 'reload schema';
