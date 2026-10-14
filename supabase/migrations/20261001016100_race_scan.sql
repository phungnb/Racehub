-- 016100: Quét giải tự động CÓ KIỂM DUYỆT cho tab Race.
-- Admin khai báo nguồn (trang lịch giải). Việc tự chạy hằng tuần (hoặc "Quét ngay") đọc các trang trong nguồn,
-- sàng lọc rồi cho vào HÀNG CHỜ (race_candidates). Không có gì tự đăng: admin duyệt từng giải mới thành tin giải (016000).
-- Chỉ admin đọc / ghi; việc quét ghi bằng khóa máy chủ.
create table if not exists public.race_sources (
  id uuid primary key default gen_random_uuid(),
  url text not null check (url ~* '^https?://[^[:space:]]+$' and char_length(url) <= 1000),
  label text check (label is null or char_length(label) <= 80),
  active boolean not null default true,
  last_scanned_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create unique index if not exists race_sources_url_uniq on public.race_sources (lower(url));

create table if not exists public.race_candidates (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.race_sources(id) on delete cascade,
  url text not null check (url ~* '^https?://[^[:space:]]+$' and char_length(url) <= 1000),
  title text not null default '',
  race_date date,
  end_date date,
  location text,
  organizer text,
  image_url text,
  description text,
  distances text[] not null default '{}',
  score integer not null default 0,
  status text not null default 'PENDING' check (status in ('PENDING', 'FILTERED', 'APPROVED', 'REJECTED')),
  filter_reason text,
  listing_id uuid references public.race_listings(id) on delete set null,
  found_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create unique index if not exists race_candidates_url_uniq on public.race_candidates (lower(url));
create index if not exists race_candidates_status_idx on public.race_candidates (status, score desc);

alter table public.race_sources enable row level security;
alter table public.race_candidates enable row level security;
drop policy if exists race_sources_admin on public.race_sources;
create policy race_sources_admin on public.race_sources for all to authenticated
  using ((select public.is_system_admin())) with check ((select public.is_system_admin()));
drop policy if exists race_candidates_admin on public.race_candidates;
create policy race_candidates_admin on public.race_candidates for all to authenticated
  using ((select public.is_system_admin())) with check ((select public.is_system_admin()));
revoke all on public.race_sources, public.race_candidates from anon;
grant select, insert, update, delete on public.race_sources, public.race_candidates to authenticated;

notify pgrst, 'reload schema';
