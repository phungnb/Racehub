-- =====================================================================
-- 20261001000100 — Nền tảng bảo mật
--   * schema private (không expose qua API)
--   * user_roles + is_system_admin()
--   * audit_log
--   * guard chặn client GHI TRỰC TIẾP (REST /table) vào các cột tài sản,
--     nhưng vẫn cho phép ghi qua RPC (/rpc/...) để không phá các hàm hiện có.
-- Migration này idempotent và không xóa dữ liệu.
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Tiện ích
-- ---------------------------------------------------------------------
create or replace function private.column_exists(p_table text, p_column text)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = p_table and column_name = p_column)
$$;

create or replace function private.table_exists(p_table text)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = p_table)
$$;

-- Người gọi bắt buộc đã đăng nhập
create or replace function private.require_uid()
returns uuid language plpgsql stable set search_path = '' as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'AUTH_REQUIRED'; end if;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Vai trò hệ thống
-- ---------------------------------------------------------------------
create table if not exists public.user_roles (
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('SYSTEM_ADMIN','MODERATOR','ORGANIZER')),
  granted_by uuid,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);
alter table public.user_roles enable row level security;
drop policy if exists user_roles_read_own on public.user_roles;
create policy user_roles_read_own on public.user_roles for select using (user_id = auth.uid());
revoke insert, update, delete on public.user_roles from anon, authenticated;

-- Chuyển quyền admin hiện có (profiles.role = 'SYSTEM_ADMIN') sang user_roles
do $$ begin
  if private.column_exists('profiles', 'role') then
    execute $q$
      insert into public.user_roles (user_id, role)
      select id, 'SYSTEM_ADMIN' from public.profiles where role = 'SYSTEM_ADMIN'
      on conflict do nothing $q$;
  end if;
end $$;

create or replace function public.is_system_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'SYSTEM_ADMIN')
$$;
grant execute on function public.is_system_admin() to authenticated;

-- ---------------------------------------------------------------------
-- Nhật ký kiểm toán
-- ---------------------------------------------------------------------
create table if not exists private.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  action      text not null,
  target      text,
  data        jsonb,
  created_at  timestamptz not null default now()
);

create or replace function private.audit(p_action text, p_target text, p_data jsonb default null)
returns void language sql security definer set search_path = '' as $$
  insert into private.audit_log (actor_id, action, target, data) values (auth.uid(), p_action, p_target, p_data)
$$;

-- ---------------------------------------------------------------------
-- Guard chống ghi trực tiếp
-- ---------------------------------------------------------------------
-- PostgREST đặt GUC request.path: '/profiles' khi ghi bảng, '/rpc/<tên>' khi gọi hàm.
-- Chỉ chặn khi: người gọi là anon/authenticated VÀ không đi qua RPC.
create or replace function private.is_direct_client_write()
returns boolean language sql stable set search_path = '' as $$
  select current_user in ('anon', 'authenticated')
     and coalesce(current_setting('request.path', true), '') not like '/rpc/%'
$$;

-- TG_ARGV:
--   '*'           → cấm hoàn toàn thao tác (INSERT/UPDATE/DELETE) trực tiếp
--   tên cột ...   → UPDATE: cấm đổi các cột này; INSERT: các cột này phải để trống/mặc định
create or replace function private.guard_direct_write()
returns trigger language plpgsql set search_path = '' as $$
declare
  col text;
  v_new jsonb;
  v_old jsonb;
  v_default_expr text;
  v_default jsonb;
begin
  if not private.is_direct_client_write() then
    return coalesce(new, old);
  end if;

  if TG_ARGV[0] = '*' then
    raise exception 'DIRECT_WRITE_FORBIDDEN: %.% phải thay đổi qua RPC', TG_TABLE_NAME, lower(TG_OP)
      using errcode = '42501';
  end if;

  if TG_OP = 'DELETE' then
    return old;
  end if;

  v_new := to_jsonb(new);
  v_old := case when TG_OP = 'UPDATE' then to_jsonb(old) else null end;

  foreach col in array TG_ARGV loop
    if not (v_new ? col) then
      continue;                                   -- cột không tồn tại ở bảng này
    end if;
    if TG_OP = 'UPDATE' and (v_new -> col) is distinct from (v_old -> col) then
      raise exception 'PROTECTED_COLUMN: không được sửa trực tiếp %.%', TG_TABLE_NAME, col
        using errcode = '42501';
    end if;
    if TG_OP = 'INSERT' and (v_new -> col) is distinct from 'null'::jsonb then
      -- Chỉ cho phép giá trị mặc định của cột (DB đã gán default trước khi trigger chạy)
      select c.column_default into v_default_expr
        from information_schema.columns c
       where c.table_schema = TG_TABLE_SCHEMA and c.table_name = TG_TABLE_NAME and c.column_name = col;
      v_default := null;
      if v_default_expr is not null and v_default_expr !~* '(nextval|random|gen_random|now|clock_timestamp)' then
        execute format('select to_jsonb(%s)', v_default_expr) into v_default;
      end if;
      if v_default is null or (v_new -> col) is distinct from v_default then
        raise exception 'PROTECTED_COLUMN: không được đặt giá trị %.% khi tạo mới', TG_TABLE_NAME, col
          using errcode = '42501';
      end if;
    end if;
  end loop;
  return new;
end $$;

-- Gắn guard vào các bảng hiện có (bỏ qua bảng chưa tồn tại)
do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      -- bảng, sự kiện, tham số
      ('profiles',               'insert or update', array['xu','xp','level','role','is_admin','trust_score','is_banned',
                                                           'strava_connected','strava_athlete_id','strava_access_token',
                                                           'strava_refresh_token','strava_token_expires_at','strava_expires_at']),
      ('user_avatar',            'insert or update', array['level','xp','coins']),
      ('activities',             'insert or update or delete', array['*']),
      ('system_config_versions', 'insert or update or delete', array['*']),
      ('challenge_participants', 'update',           array['current_progress','progress','score','rank','status']),
      ('clubs',                  'insert or update', array['treasury_balance','member_count','owner_id']),
      ('club_members',           'insert or update', array['role','status']),
      ('user_inventory',         'insert or update or delete', array['*']),
      ('user_equipment',         'insert or update or delete', array['*'])
    ) as t(tbl, events, args)
  loop
    if private.table_exists(spec.tbl) then
      execute format('drop trigger if exists zz_guard_direct_write on public.%I', spec.tbl);
      execute format(
        'create trigger zz_guard_direct_write before %s on public.%I for each row execute function private.guard_direct_write(%s)',
        spec.events, spec.tbl,
        (select string_agg(quote_literal(a), ', ') from unnest(spec.args) a));
    end if;
  end loop;
end $$;
