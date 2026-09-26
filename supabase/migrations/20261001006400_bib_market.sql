-- 006400: Chợ BIB — runner nhượng lại / tìm mua BIB giải chạy thật.
-- Nguyên tắc (docs/CHO_RUNNER.md):
-- • RaceHub KHÔNG giữ tiền, không làm trung gian thanh toán; hai bên tự liên hệ.
-- • Không bán cao hơn giá gốc (chống phe vé): giá bán ≤ giá mua ban đầu.
-- • Khuyến khích chuyển nhượng CHÍNH THỨC qua BTC (đổi tên VĐV). Nhiều giải cấm chạy BIB người khác — ghi rõ cách chuyển.
-- • Chỉ runner đã xác minh (≥ 3 bài chạy hợp lệ, không bị khoá) mới đăng tin; tối đa 5 tin đang mở.
-- • Thông tin liên hệ ẩn trong danh sách; bấm "Xem liên hệ" mới hiện (≤ 30 lần / ngày, có ghi lại) → hạn chế cào số điện thoại.
-- • Tin tự hết hạn sau ngày giải. Báo cáo tin → hàng đợi Báo cáo của admin; admin ẩn tin.
-- Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

create table if not exists public.bib_listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'SELL' check (kind in ('SELL', 'BUY')),
  race_name text not null check (char_length(race_name) between 3 and 120),
  race_date date not null,
  city text check (city is null or char_length(city) <= 40),
  distance text not null check (distance in ('5K', '10K', '21K', '42K', 'ULTRA', 'OTHER')),
  distance_note text check (distance_note is null or char_length(distance_note) <= 40),
  original_price integer check (original_price is null or original_price between 0 and 50000000),
  price integer check (price is null or price between 0 and 50000000),
  transfer text not null default 'OFFICIAL' check (transfer in ('OFFICIAL', 'ASK')),
  shirt_size text check (shirt_size is null or char_length(shirt_size) <= 10),
  note text check (note is null or char_length(note) <= 500),
  contacts jsonb not null default '{}'::jsonb,
  status text not null default 'OPEN' check (status in ('OPEN', 'RESERVED', 'DONE', 'CANCELLED', 'HIDDEN')),
  hidden_reason text,
  views integer not null default 0,
  reveals integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind = 'BUY' or (price is not null and original_price is not null and price <= original_price))
);
create index if not exists bib_listings_list_idx on public.bib_listings (status, race_date);
create table if not exists public.bib_contact_reveals (
  user_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid not null references public.bib_listings(id) on delete cascade,
  at timestamptz not null default now(),
  primary key (user_id, listing_id)
);
alter table public.bib_listings enable row level security;
alter table public.bib_contact_reveals enable row level security;
revoke all on public.bib_listings, public.bib_contact_reveals from anon, authenticated;

-- Báo cáo dùng chung: thêm ngữ cảnh BIB / MARKET
alter table public.user_reports drop constraint if exists user_reports_context_check;
alter table public.user_reports add constraint user_reports_context_check check (context in ('NEARBY', 'CONNECTION', 'CLUB', 'BIB', 'MARKET', 'OTHER'));

-- Liên hệ: chỉ giữ số điện thoại / Zalo / Facebook / Messenger hợp lệ
create or replace function private.bib_contacts(p jsonb) returns jsonb
language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'phone', case when coalesce(p->>'phone', '') ~ '^\+?[0-9 .]{8,15}$' then regexp_replace(p->>'phone', '[ .]', '', 'g') end,
    'zalo', case when coalesce(p->>'zalo', '') ~ '^\+?[0-9 .]{8,15}$' then regexp_replace(p->>'zalo', '[ .]', '', 'g') end,
    'facebook', case when coalesce(p->>'facebook', '') ~ '^https://(www\.|m\.)?(facebook\.com|fb\.com|m\.me)/[^\s]+$' then left(p->>'facebook', 200) end))
$$;

create or replace function private.bib_json(b public.bib_listings, p_uid uuid, p_full boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', b.id, 'kind', b.kind, 'race_name', b.race_name, 'race_date', b.race_date, 'city', b.city,
    'distance', b.distance, 'distance_note', b.distance_note, 'original_price', b.original_price, 'price', b.price,
    'transfer', b.transfer, 'shirt_size', b.shirt_size, 'note', b.note, 'status', b.status, 'created_at', b.created_at,
    'mine', b.user_id = p_uid,
    'seller', (select jsonb_build_object('id', p.id, 'name', coalesce(p.display_name, 'Runner'), 'avatar_url', p.avatar_url, 'level', p.level,
                 'runs', private.valid_runs(p.id), 'since', p.created_at) from public.profiles p where p.id = b.user_id),
    'revealed', exists (select 1 from public.bib_contact_reveals r where r.user_id = p_uid and r.listing_id = b.id))
  || case when p_full or b.user_id = p_uid
          or exists (select 1 from public.bib_contact_reveals r where r.user_id = p_uid and r.listing_id = b.id)
     then jsonb_build_object('contacts', b.contacts) else '{}'::jsonb end
  || case when b.user_id = p_uid then jsonb_build_object('views', b.views, 'reveals', b.reveals, 'hidden_reason', b.hidden_reason) else '{}'::jsonb end
$$;

-- p: {kind, q, city, distance, mine, offset}. Chỉ tin đang mở và giải chưa diễn ra (trừ "tin của tôi").
create or replace function public.bib_listings(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_kind text := nullif(upper(coalesce(p->>'kind', '')), '');
  v_q text := coalesce(p->>'q', '');
  v_city text := nullif(p->>'city', '');
  v_dist text := nullif(upper(coalesce(p->>'distance', '')), '');
  v_mine boolean := coalesce((p->>'mine')::boolean, false);
  v_offset integer := greatest(0, coalesce((p->>'offset')::int, 0));
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  return (
    with f as (
      select b from public.bib_listings b
       where case when v_mine then b.user_id = v_uid
                  else b.status in ('OPEN', 'RESERVED') and b.race_date >= v_today end
         and (v_kind is null or b.kind = v_kind)
         and (v_city is null or b.city = v_city)
         and (v_dist is null or b.distance = v_dist)
         and (private.search_key(v_q) = '' or private.search_match(private.search_hay(b.race_name) || ' ' || private.search_key(coalesce(b.city, '')) || ' ', v_q))
    ), r as (
      select f.b, row_number() over (order by case when v_mine then 0 else ((f.b).status = 'RESERVED')::int end, (f.b).race_date, (f.b).created_at desc) rn from f
    )
    select jsonb_build_object('total', (select count(*) from f),
      'items', coalesce((select jsonb_agg(private.bib_json(r.b, v_uid, false) order by r.rn) from r where r.rn > v_offset and r.rn <= v_offset + 30), '[]'::jsonb),
      'eligible', private.nearby_eligible(v_uid), 'valid_runs', private.valid_runs(v_uid),
      'open_count', (select count(*) from public.bib_listings b where b.user_id = v_uid and b.status in ('OPEN', 'RESERVED'))));
end $$;

-- Đăng / sửa tin. p: {id?, kind, race_name, race_date, city, distance, distance_note, original_price, price, transfer, shirt_size, note, contacts{phone,zalo,facebook}}
create or replace function public.save_bib_listing(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_old public.bib_listings := (select x from public.bib_listings x where x.id = nullif(p->>'id', '')::uuid);
  v_kind text := upper(coalesce(nullif(p->>'kind', ''), v_old.kind, 'SELL'));
  v_date date := nullif(p->>'race_date', '')::date;
  v_orig integer := nullif(p->>'original_price', '')::int;
  v_price integer := nullif(p->>'price', '')::int;
  v_contacts jsonb := private.bib_contacts(coalesce(p->'contacts', '{}'::jsonb));
  v_note text := nullif(left(trim(coalesce(p->>'note', '')), 500), '');
  v_id uuid;
begin
  if not private.nearby_eligible(v_uid) then raise exception 'NOT_ELIGIBLE'; end if;
  if nullif(p->>'id', '') is not null and (v_old.id is null or v_old.user_id <> v_uid) then raise exception 'LISTING_NOT_FOUND'; end if;
  if v_old.status = 'HIDDEN' then raise exception 'LISTING_HIDDEN'; end if;
  if v_kind not in ('SELL', 'BUY') then raise exception 'INVALID_KIND'; end if;
  if char_length(trim(coalesce(p->>'race_name', ''))) < 3 then raise exception 'RACE_REQUIRED'; end if;
  if v_date is null or v_date < (now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception 'RACE_DATE_PAST'; end if;
  if upper(coalesce(p->>'distance', '')) not in ('5K', '10K', '21K', '42K', 'ULTRA', 'OTHER') then raise exception 'INVALID_DISTANCE'; end if;
  if v_kind = 'SELL' and (v_orig is null or v_price is null) then raise exception 'PRICE_REQUIRED'; end if;
  if v_kind = 'SELL' and v_price > v_orig then raise exception 'PRICE_ABOVE_ORIGINAL'; end if;
  if v_contacts = '{}'::jsonb then raise exception 'CONTACT_REQUIRED'; end if;
  if v_note ~* '(https?://|www\.)' and v_note !~* '(facebook\.com|fb\.com)' then raise exception 'NO_LINKS'; end if;

  if v_old.id is null then
    if (select count(*) from public.bib_listings b where b.user_id = v_uid and b.status in ('OPEN', 'RESERVED')) >= 5 then raise exception 'TOO_MANY_LISTINGS'; end if;
    if (select count(*) from public.bib_listings b where b.user_id = v_uid and b.created_at > now() - interval '24 hours') >= 10 then raise exception 'RATE_LIMITED'; end if;
    insert into public.bib_listings (user_id, kind, race_name, race_date, city, distance, distance_note, original_price, price, transfer, shirt_size, note, contacts)
    values (v_uid, v_kind, left(trim(p->>'race_name'), 120), v_date, nullif(left(trim(coalesce(p->>'city', '')), 40), ''), upper(p->>'distance'),
      nullif(left(trim(coalesce(p->>'distance_note', '')), 40), ''), v_orig, v_price,
      case when upper(coalesce(p->>'transfer', '')) = 'ASK' then 'ASK' else 'OFFICIAL' end,
      nullif(left(trim(coalesce(p->>'shirt_size', '')), 10), ''), v_note, v_contacts)
    returning id into v_id;
  else
    v_id := v_old.id;
    update public.bib_listings set kind = v_kind, race_name = left(trim(p->>'race_name'), 120), race_date = v_date,
      city = nullif(left(trim(coalesce(p->>'city', '')), 40), ''), distance = upper(p->>'distance'),
      distance_note = nullif(left(trim(coalesce(p->>'distance_note', '')), 40), ''), original_price = v_orig, price = v_price,
      transfer = case when upper(coalesce(p->>'transfer', '')) = 'ASK' then 'ASK' else 'OFFICIAL' end,
      shirt_size = nullif(left(trim(coalesce(p->>'shirt_size', '')), 10), ''), note = v_note, contacts = v_contacts, updated_at = now()
     where id = v_id;
  end if;
  return v_id;
end $$;

-- Người đăng đổi trạng thái: OPEN (mở lại) / RESERVED (đang giao dịch) / DONE (đã xong) / CANCELLED (gỡ)
create or replace function public.set_bib_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.bib_listings := (select x from public.bib_listings x where x.id = p_id);
begin
  if b.id is null or b.user_id <> private.require_uid() then raise exception 'LISTING_NOT_FOUND'; end if;
  if b.status = 'HIDDEN' then raise exception 'LISTING_HIDDEN'; end if;
  if upper(p_status) not in ('OPEN', 'RESERVED', 'DONE', 'CANCELLED') then raise exception 'INVALID_STATUS'; end if;
  update public.bib_listings set status = upper(p_status), updated_at = now() where id = b.id;
end $$;

-- Xem liên hệ: cần đăng nhập + tài khoản không bị khoá; ≤ 30 tin khác nhau / 24 giờ
create or replace function public.bib_contact(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  b public.bib_listings := (select x from public.bib_listings x where x.id = p_id);
begin
  if b.id is null or b.status not in ('OPEN', 'RESERVED') then raise exception 'LISTING_NOT_FOUND'; end if;
  if exists (select 1 from public.profiles p where p.id = v_uid and p.banned_at is not null) then raise exception 'FORBIDDEN'; end if;
  if b.user_id <> v_uid and not exists (select 1 from public.bib_contact_reveals r where r.user_id = v_uid and r.listing_id = b.id) then
    if (select count(*) from public.bib_contact_reveals r where r.user_id = v_uid and r.at > now() - interval '24 hours') >= 30 then
      raise exception 'TOO_MANY_REVEALS';
    end if;
    insert into public.bib_contact_reveals (user_id, listing_id) values (v_uid, b.id);
    update public.bib_listings set reveals = reveals + 1 where id = b.id;
  end if;
  return b.contacts;
end $$;

-- Báo cáo tin BIB → hàng đợi Báo cáo của admin (ngữ cảnh BIB, kèm mã tin)
create or replace function public.report_bib(p_id uuid, p_reason text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  b public.bib_listings := (select x from public.bib_listings x where x.id = p_id);
begin
  if b.id is null then raise exception 'LISTING_NOT_FOUND'; end if;
  if b.user_id = v_uid then raise exception 'INVALID_TARGET'; end if;
  if upper(p_reason) not in ('SPAM', 'HARASSMENT', 'FAKE', 'UNSAFE', 'OTHER') then raise exception 'INVALID_REASON'; end if;
  if exists (select 1 from public.user_reports r where r.reporter = v_uid and r.target = b.user_id and r.context = 'BIB' and r.status = 'OPEN') then return; end if;
  insert into public.user_reports (reporter, target, context, reason, note)
  values (v_uid, b.user_id, 'BIB', upper(p_reason), left('Tin BIB "' || b.race_name || '" (' || b.id || '): ' || coalesce(nullif(trim(p_note), ''), ''), 500));
  -- 3 người khác nhau báo cáo tin này → tạm ẩn chờ admin
  if (select count(distinct r.reporter) from public.user_reports r where r.target = b.user_id and r.context = 'BIB' and r.status = 'OPEN'
        and r.note like '%' || b.id || '%') >= 3 then
    update public.bib_listings set status = 'HIDDEN', hidden_reason = 'Tạm ẩn do nhiều báo cáo, chờ quản trị viên xem xét' where id = b.id;
  end if;
end $$;

-- Admin: ẩn / hiện lại tin
create or replace function public.admin_hide_bib(p_id uuid, p_hide boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  b public.bib_listings := (select x from public.bib_listings x where x.id = p_id);
begin
  if b.id is null then raise exception 'LISTING_NOT_FOUND'; end if;
  if p_hide and char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  update public.bib_listings set status = case when p_hide then 'HIDDEN' else 'OPEN' end,
    hidden_reason = case when p_hide then left(trim(p_reason), 300) end, updated_at = now() where id = b.id;
  perform private.notify(b.user_id, null, 'MARKET', case when p_hide then 'Tin BIB đã bị ẩn' else 'Tin BIB đã hiện lại' end,
    b.race_name || coalesce(': ' || nullif(trim(p_reason), ''), ''), '/market?tab=bib', v_admin, true);
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_admin, case when p_hide then 'BIB_HIDE' else 'BIB_UNHIDE' end, 'bib:' || b.id, jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.admin_bib_listings(p_status text default 'ALL') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_admin uuid := private.require_admin();
begin
  return (select coalesce(jsonb_agg(y.j order by y.rn), '[]'::jsonb) from (
    select private.bib_json(b, v_admin, true) || jsonb_build_object('hidden_reason', b.hidden_reason, 'views', b.views, 'reveals', b.reveals) j,
           row_number() over (order by b.created_at desc) rn
      from public.bib_listings b where upper(coalesce(p_status, 'ALL')) = 'ALL' or b.status = upper(p_status)) y where y.rn <= 200);
end $$;

revoke all on function private.bib_contacts(jsonb), private.bib_json(public.bib_listings, uuid, boolean) from public, anon, authenticated;
revoke all on function public.bib_listings(jsonb), public.save_bib_listing(jsonb), public.set_bib_status(uuid, text), public.bib_contact(uuid),
  public.report_bib(uuid, text, text), public.admin_hide_bib(uuid, boolean, text), public.admin_bib_listings(text) from public, anon;
grant execute on function public.bib_listings(jsonb), public.save_bib_listing(jsonb), public.set_bib_status(uuid, text), public.bib_contact(uuid),
  public.report_bib(uuid, text, text), public.admin_hide_bib(uuid, boolean, text), public.admin_bib_listings(text) to authenticated;

notify pgrst, 'reload schema';
