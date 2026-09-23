-- Giả lập các phần của Supabase mà schema RaceHub phụ thuộc vào.
-- Chỉ dùng cho test trên PGlite; không chạy lên database thật.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists vault;
grant usage on schema public, auth, extensions to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid $$;
grant execute on function auth.uid() to public;

create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);

-- uuid-ossp: chỉ cần uuid_generate_v4
create function extensions.uuid_generate_v4() returns uuid language sql as 'select gen_random_uuid()';

create publication supabase_realtime;
