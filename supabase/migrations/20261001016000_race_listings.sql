-- 016000: Tab "Race" — thông tin giải chạy offline (ngoài đời) do admin đăng.
-- Khác với "giải chạy trên app" (virtual_races, 002700): đây chỉ là tin giải để runner xem và bấm sang trang đăng ký của BTC.
-- Chỉ admin đăng / sửa / xóa. Bản nháp (DRAFT) chỉ admin thấy; chỉ PUBLISHED mới hiện cho người dùng.
create table if not exists public.race_listings (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 3 and 160),
  race_date date not null,
  end_date date,
  location text check (location is null or char_length(location) <= 200),
  province text check (province is null or char_length(province) <= 80),
  distances text[] not null default '{}' check (cardinality(distances) <= 12),
  organizer text check (organizer is null or char_length(organizer) <= 160),
  reg_url text check (reg_url is null or (reg_url ~* '^https?://[^[:space:]]+$' and char_length(reg_url) <= 1000)),
  source_url text check (source_url is null or (source_url ~* '^https?://[^[:space:]]+$' and char_length(source_url) <= 1000)),
  image_url text check (image_url is null or (image_url ~* '^https?://[^[:space:]]+$' and char_length(image_url) <= 1000)),
  reg_close_date date,
  description text check (description is null or char_length(description) <= 3000),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED', 'HIDDEN')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists race_listings_status_date_idx on public.race_listings (status, race_date);
-- Chống đăng trùng cùng một trang đăng ký
create unique index if not exists race_listings_source_uniq on public.race_listings (lower(source_url)) where source_url is not null;

alter table public.race_listings enable row level security;
drop policy if exists race_listings_read on public.race_listings;
create policy race_listings_read on public.race_listings for select to authenticated
  using (status = 'PUBLISHED' or (select public.is_system_admin()));
drop policy if exists race_listings_admin_ins on public.race_listings;
create policy race_listings_admin_ins on public.race_listings for insert to authenticated with check ((select public.is_system_admin()));
drop policy if exists race_listings_admin_upd on public.race_listings;
create policy race_listings_admin_upd on public.race_listings for update to authenticated using ((select public.is_system_admin())) with check ((select public.is_system_admin()));
drop policy if exists race_listings_admin_del on public.race_listings;
create policy race_listings_admin_del on public.race_listings for delete to authenticated using ((select public.is_system_admin()));
revoke all on public.race_listings from anon;
grant select, insert, update, delete on public.race_listings to authenticated;

create or replace function private.race_listings_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' and new.created_by is null then new.created_by := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists race_listings_touch on public.race_listings;
create trigger race_listings_touch before insert or update on public.race_listings
  for each row execute function private.race_listings_touch();

notify pgrst, 'reload schema';
