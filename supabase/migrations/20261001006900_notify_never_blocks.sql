-- 006900: Thông báo / push KHÔNG BAO GIỜ được làm hỏng thao tác chính.
-- Sự cố thật (09/2026): gán CLB Pro cho một CLB báo "chỉ quản trị hệ thống…" (thực chất là lỗi quyền 42501 phát sinh
-- trong chuỗi gửi thông báo → push cho ban quản trị CLB đó), và bài Strava có thể không vào được vì cùng chuỗi này
-- (nhập bài → đăng bảng tin CLB → thông báo → push). Trước đây lỗi ở bước phụ làm hỏng cả giao dịch.
-- Nay: lỗi khi tạo thông báo / xếp hàng push / gọi pg_net chỉ ghi cảnh báo (log Postgres) + lưu vào private.notify_errors
-- để admin xem; thao tác chính (gán gói, nhập bài, đăng tin…) vẫn thành công.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT. Chạy lại nhiều lần vẫn an toàn.

create table if not exists private.notify_errors (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  stage text not null,
  kind text,
  user_id uuid,
  sqlstate text,
  message text
);
revoke all on private.notify_errors from public, anon, authenticated;

create or replace function private.log_notify_error(p_stage text, p_kind text, p_user uuid, p_state text, p_msg text) returns void
language plpgsql security definer set search_path = public as $$
begin
  raise warning 'notify %: % % (%)', p_stage, p_kind, p_msg, p_state;
  begin
    insert into private.notify_errors (stage, kind, user_id, sqlstate, message) values (p_stage, p_kind, p_user, p_state, left(p_msg, 500));
  exception when others then null;          -- ghi log thất bại cũng không được chặn
  end;
end $$;

-- 1. Tạo thông báo (giữ nguyên logic 000500, chỉ bọc lỗi)
create or replace function private.notify(
  p_user uuid, p_club uuid, p_kind text, p_title text, p_body text, p_link text,
  p_actor uuid default null, p_important boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare v_level text;
begin
  if p_user is null or p_user = p_actor then return; end if;
  begin
    if p_club is not null then
      v_level := (select level from public.notification_settings where user_id = p_user and club_id = p_club);
      if v_level = 'NONE' or (v_level = 'IMPORTANT' and not p_important) then return; end if;
    end if;
    insert into public.notifications (user_id, club_id, actor_id, kind, title, body, link)
    values (p_user, p_club, p_actor, p_kind, left(p_title, 160), left(p_body, 300), p_link);
  exception when others then
    perform private.log_notify_error('notify', p_kind, p_user, sqlstate, sqlerrm);
  end;
end $$;

-- 2. Gọi route gửi push qua pg_net (giữ nguyên logic 001700, bọc lỗi)
create or replace function private.push_kick() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_url text := (select value from private.app_settings where key = 'push_dispatch_url');
  v_secret text := (select value from private.app_settings where key = 'push_secret');
begin
  if v_url is null or v_secret is null or to_regproc('net.http_post') is null then return; end if;
  begin
    execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 8000)'
      using v_url, '{}'::jsonb, jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret);
  exception when others then
    perform private.log_notify_error('push_kick', null, null, sqlstate, sqlerrm);
  end;
end $$;

-- 3. Xếp hàng push sau khi có thông báo (giữ nguyên logic 001700, bọc lỗi)
create or replace function private.after_notification_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s public.push_settings;
  v_cat text;
begin
  begin
    s := (select x from public.push_settings x where x.user_id = new.user_id);
    v_cat := private.push_category(new.kind);
    if not exists (select 1 from public.push_subscriptions p where p.user_id = new.user_id) then return null; end if;
    if s.user_id is not null then
      if (v_cat = 'club' and not s.club) or (v_cat = 'social' and not s.social)
         or (v_cat = 'challenge' and not s.challenge) or (v_cat = 'game' and not s.game) then
        return null;
      end if;
    end if;
    if new.kind <> 'PUSH_TEST' and coalesce(s.quiet, true)
       and private.in_quiet_hours(coalesce(s.quiet_from, 22::smallint), coalesce(s.quiet_to, 6::smallint), now()) then
      return null;
    end if;
    insert into private.push_queue (notification_id) values (new.id);
    if coalesce(current_setting('racehub.push_kicked', true), '') <> '1' then
      perform set_config('racehub.push_kicked', '1', true);
      perform private.push_kick();
    end if;
  exception when others then
    perform private.log_notify_error('push_queue', new.kind, new.user_id, sqlstate, sqlerrm);
  end;
  return null;
end $$;

revoke all on function private.log_notify_error(text, text, uuid, text, text), private.notify(uuid, uuid, text, text, text, text, uuid, boolean),
  private.push_kick(), private.after_notification_push() from public, anon, authenticated;

-- 4. Admin xem lỗi thông báo gần đây (để biết push có đang hỏng không)
create or replace function public.admin_notify_errors() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('at', t.at, 'stage', t.stage, 'kind', t.kind, 'sqlstate', t.sqlstate, 'message', t.message)
            order by t.at desc), '[]'::jsonb)
            from (select e.*, row_number() over (order by e.at desc) as rn from private.notify_errors e) t where t.rn <= 50);
end $$;
revoke all on function public.admin_notify_errors() from public, anon;
grant execute on function public.admin_notify_errors() to authenticated;

notify pgrst, 'reload schema';
