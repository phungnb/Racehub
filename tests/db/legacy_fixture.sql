-- Giả lập môi trường Supabase + schema HIỆN TẠI của RaceHub (suy ra từ code).
-- Chỉ dùng cho test migration; không chạy lên database thật.

-- ---- Giả lập Supabase ----
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema extensions;
grant usage on schema public, auth, extensions to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid $$;
grant execute on function auth.uid() to public;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- ---- Schema hiện tại (suy ra từ code) ----
create table public.profiles (
  id uuid primary key references auth.users(id),
  display_name text, avatar_url text,
  xu numeric default 500, xp int default 0, level int default 1,
  role text default 'MEMBER',
  strava_connected boolean default false,
  strava_access_token text, strava_refresh_token text,
  strava_token_expires_at bigint, strava_athlete_id text,
  updated_at timestamptz default now()
);
create table public.user_avatar (
  user_id uuid primary key, gender text, skin_tone text,
  level int default 1, xp int default 0, coins int default 500, updated_at timestamptz
);
create table public.activities (
  id uuid primary key default gen_random_uuid(), user_id uuid,
  distance_m int, validation_status text default 'PENDING', status text default 'PENDING',
  created_at timestamptz default now()
);
create table public.system_config_versions (
  config_key text primary key, version bigint, status text, config_value jsonb, created_by uuid
);
create table public.clubs (
  id uuid primary key default gen_random_uuid(), name text, owner_id uuid,
  treasury_balance numeric default 0, member_count int default 0
);
create table public.club_members (
  id uuid primary key default gen_random_uuid(), club_id uuid, user_id uuid,
  role text default 'MEMBER', status text default 'PENDING'
);
create table public.user_inventory (user_id uuid, item_id uuid);

-- RLS "lỏng" như trường hợp xấu nhất: cho phép tự sửa cả dòng của mình
alter table public.profiles enable row level security;
create policy p_all on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
alter table public.user_avatar enable row level security;
create policy ua_all on public.user_avatar for all using (user_id = auth.uid()) with check (user_id = auth.uid());
alter table public.activities enable row level security;
create policy a_all on public.activities for all using (true) with check (true);
alter table public.system_config_versions enable row level security;
create policy c_all on public.system_config_versions for all using (true) with check (true);
alter table public.club_members enable row level security;
create policy cm_all on public.club_members for all using (true) with check (true);

-- RPC cũ nhận p_user_id (tin tưởng client)
create function public.equip_item(p_user_id uuid, p_item_id uuid) returns jsonb
language plpgsql security definer as $$
begin
  return jsonb_build_object('user', p_user_id, 'item', p_item_id);
end $$;

create function public.submit_and_process_activity(
  p_user_id uuid, p_title text, p_source text, p_started_at timestamptz, p_ended_at timestamptz,
  p_elapsed_s int, p_moving_s int, p_distance_m int, p_avg_pace_s int, p_track_points jsonb)
returns jsonb language plpgsql security definer as $$
begin
  insert into public.activities (user_id, distance_m) values (p_user_id, p_distance_m);
  update public.profiles set xu = xu + 1 where id = p_user_id;
  return jsonb_build_object('success', true, 'user', p_user_id);
end $$;

-- Hàm INVOKER cập nhật xu (kiểu contribute_treasury) — phải vẫn chạy được sau migration
create function public.contribute_treasury(p_club_id uuid, p_amount numeric) returns void
language plpgsql security invoker as $$
begin
  update public.profiles set xu = xu - p_amount where id = auth.uid();
end $$;

create function public.has_permission(p_user_id uuid, p_club_id uuid, p_permission_code text) returns boolean
language sql stable as $$ select p_user_id is not null $$;
