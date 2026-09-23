-- =====================================================================
-- 20261001000200 — Tạo hồ sơ phía server + kết nối Strava an toàn
--   * ensure_profile(): client gọi khi chưa có hồ sơ (thay cho insert xu: 500 từ client)
--   * trigger trên auth.users: user mới tự có hồ sơ
--   * private.provider_connections: token OAuth, client KHÔNG đọc được
--   * link/unlink_provider_connection: chỉ service_role gọi (route /api/strava/*)
--   * Chuyển token Strava cũ từ profiles sang bảng mới rồi xóa khỏi profiles
-- =====================================================================

-- ---------------------------------------------------------------------
-- Hồ sơ
-- ---------------------------------------------------------------------
create or replace function private.create_profile_for(p_user_id uuid, p_display_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  cols text := 'id, display_name';
  vals text := format('%L, %L', p_user_id, coalesce(nullif(trim(p_display_name), ''), 'Runner'));
begin
  if exists (select 1 from public.profiles where id = p_user_id) then
    return;
  end if;
  -- Thưởng chào mừng giữ nguyên như hành vi cũ (500 Xu) nhưng do server đặt.
  -- Khi sổ cái được kích hoạt, khoản này chuyển thành giao dịch WELCOME_BONUS.
  if private.column_exists('profiles', 'xu')    then cols := cols || ', xu';    vals := vals || ', 500'; end if;
  if private.column_exists('profiles', 'xp')    then cols := cols || ', xp';    vals := vals || ', 0';   end if;
  if private.column_exists('profiles', 'level') then cols := cols || ', level'; vals := vals || ', 1';   end if;
  execute format('insert into public.profiles (%s) values (%s) on conflict (id) do nothing', cols, vals);
end $$;

create or replace function public.ensure_profile()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_name text;
begin
  select coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', split_part(email, '@', 1))
    into v_name from auth.users where id = v_uid;
  perform private.create_profile_for(v_uid, v_name);
end $$;
revoke execute on function public.ensure_profile() from public, anon;
grant execute on function public.ensure_profile() to authenticated;

create or replace function private.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.create_profile_for(
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)));
  return new;
exception when others then
  -- Không bao giờ chặn việc đăng ký; client sẽ gọi ensure_profile() để thử lại
  raise warning 'handle_new_auth_user: %', sqlerrm;
  return new;
end $$;

drop trigger if exists racehub_on_auth_user_created on auth.users;
create trigger racehub_on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- ---------------------------------------------------------------------
-- Kết nối nhà cung cấp dữ liệu (Strava, Garmin, ...)
-- ---------------------------------------------------------------------
create table if not exists private.provider_connections (
  user_id           uuid not null references auth.users(id) on delete cascade,
  provider          text not null check (provider in ('STRAVA','GARMIN','COROS','GOOGLE_FIT','APPLE_HEALTH')),
  external_user_id  text not null,
  access_token      text not null,
  refresh_token     text,
  expires_at        timestamptz,
  scopes            text[],
  connected_at      timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (user_id, provider),
  unique (provider, external_user_id)
);
revoke all on private.provider_connections from public, anon, authenticated;

-- Client chỉ biết mình đã kết nối gì, không thấy token
create or replace view public.my_connections as
  select provider, external_user_id, connected_at
  from private.provider_connections
  where user_id = auth.uid();
revoke all on public.my_connections from anon;
grant select on public.my_connections to authenticated;

-- Cập nhật cờ hiển thị trên profiles (không chứa bí mật) nếu các cột cũ còn tồn tại
create or replace function private.sync_profile_strava_flag(p_user_id uuid, p_connected boolean, p_athlete_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if private.column_exists('profiles', 'strava_connected') then
    execute 'update public.profiles set strava_connected = $1 where id = $2' using p_connected, p_user_id;
  end if;
  if private.column_exists('profiles', 'strava_athlete_id') then
    execute 'update public.profiles set strava_athlete_id = $1 where id = $2' using p_athlete_id, p_user_id;
  end if;
end $$;

create or replace function public.link_provider_connection(
  p_user_id uuid, p_provider text, p_external_user_id text,
  p_access_token text, p_refresh_token text, p_expires_at timestamptz, p_scopes text[] default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from private.provider_connections
             where provider = p_provider and external_user_id = p_external_user_id and user_id <> p_user_id) then
    raise exception 'PROVIDER_ACCOUNT_CONFLICT';
  end if;

  insert into private.provider_connections
    (user_id, provider, external_user_id, access_token, refresh_token, expires_at, scopes)
  values (p_user_id, p_provider, p_external_user_id, p_access_token, p_refresh_token, p_expires_at, p_scopes)
  on conflict (user_id, provider) do update set
    external_user_id = excluded.external_user_id,
    access_token     = excluded.access_token,
    refresh_token    = excluded.refresh_token,
    expires_at       = excluded.expires_at,
    scopes           = excluded.scopes,
    updated_at       = now();

  if p_provider = 'STRAVA' then
    perform private.sync_profile_strava_flag(p_user_id, true, p_external_user_id);
  end if;
  insert into private.audit_log (actor_id, action, target, data)
  values (p_user_id, 'provider.linked', p_provider, jsonb_build_object('external_user_id', p_external_user_id));
end $$;

-- Trả về access token cũ để server gọi deauthorize bên nhà cung cấp
create or replace function public.unlink_provider_connection(p_user_id uuid, p_provider text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_token text;
begin
  delete from private.provider_connections
   where user_id = p_user_id and provider = p_provider
   returning access_token into v_token;
  if p_provider = 'STRAVA' then
    perform private.sync_profile_strava_flag(p_user_id, false, null);
  end if;
  insert into private.audit_log (actor_id, action, target) values (p_user_id, 'provider.unlinked', p_provider);
  return v_token;
end $$;

revoke execute on function public.link_provider_connection(uuid, text, text, text, text, timestamptz, text[]) from public, anon, authenticated;
revoke execute on function public.unlink_provider_connection(uuid, text) from public, anon, authenticated;
grant execute on function public.link_provider_connection(uuid, text, text, text, text, timestamptz, text[]) to service_role;
grant execute on function public.unlink_provider_connection(uuid, text) to service_role;

-- ---------------------------------------------------------------------
-- Chuyển token Strava cũ khỏi bảng profiles (bảng mà client đọc được)
-- ---------------------------------------------------------------------
do $$
declare
  v_expires text := 'null::timestamptz';
begin
  if not (private.column_exists('profiles', 'strava_access_token')
          and private.column_exists('profiles', 'strava_athlete_id')) then
    return;
  end if;

  -- Strava trả expires_at dạng epoch (giây); code cũ lưu vào một trong hai cột
  if private.column_exists('profiles', 'strava_token_expires_at') then
    v_expires := 'case when strava_token_expires_at::text ~ ''^\d+$'' then to_timestamp(strava_token_expires_at::text::bigint) end';
  elsif private.column_exists('profiles', 'strava_expires_at') then
    v_expires := 'case when strava_expires_at::text ~ ''^\d+$'' then to_timestamp(strava_expires_at::text::bigint) end';
  end if;

  execute format($q$
    insert into private.provider_connections (user_id, provider, external_user_id, access_token, refresh_token, expires_at)
    select distinct on (strava_athlete_id::text)
           id, 'STRAVA', strava_athlete_id::text, strava_access_token, %s, %s
      from public.profiles
     where strava_access_token is not null and strava_athlete_id is not null
     order by strava_athlete_id::text, id
    on conflict do nothing $q$,
    case when private.column_exists('profiles', 'strava_refresh_token') then 'strava_refresh_token' else 'null' end,
    v_expires);

  execute 'update public.profiles set strava_access_token = null where strava_access_token is not null';
  if private.column_exists('profiles', 'strava_refresh_token') then
    execute 'update public.profiles set strava_refresh_token = null where strava_refresh_token is not null';
  end if;
end $$;
