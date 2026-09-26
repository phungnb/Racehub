-- RaceHub — PHẦN 08/10 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 006400, 006500, 006600, 006700, 006800, 006900
-- Supabase → SQL Editor → New query → dán TOÀN BỘ phần này → Run. Lỗi thì không có gì thay đổi; chạy lại vẫn an toàn.
-- Xong thì chạy phần tiếp theo.
begin;
-- ===================================================================
-- 20261001006400_bib_market.sql
-- ===================================================================
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

-- ===================================================================
-- 20261001006500_gps_gap_check.sql
-- ===================================================================
-- 006500: Chấm bài chạy ghi trong app — thêm phát hiện MẤT TÍN HIỆU GPS.
-- Trước đây: tắt màn hình khi ghi bằng trình duyệt (iPhone dừng GPS) → điểm tiếp theo nối thẳng, bài vẫn được duyệt
-- (tuyến chỉ còn 2 điểm, quãng đường "ảo"). Nay: đoạn > 60 giây và > 150 m giữa hai điểm = mất tín hiệu;
-- tổng đoạn nối thẳng > 25 % quãng đường (và > 500 m) → bài chờ xác minh, kèm cờ GPS_GAP để ban quản trị xem.
-- Giữ nguyên mọi luật cũ (002400). Chạy lại nhiều lần vẫn an toàn.

create or replace function public.submit_and_process_activity(
  p_title text, p_source text, p_started_at timestamptz, p_ended_at timestamptz,
  p_elapsed_s integer, p_moving_s integer, p_distance_m numeric, p_avg_pace_s integer, p_track_points jsonb
) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := private.require_uid();
  cfg jsonb := private.economy_config();
  v_points jsonb := coalesce(p_track_points, '[]'::jsonb);
  v_n integer;
  v_gps_m numeric := 0;
  v_spikes integer := 0;
  v_prev jsonb;
  v_p jsonb;
  v_seg numeric;
  v_dt numeric;
  v_distance numeric;
  v_moving integer;
  v_pace integer;
  v_status text := 'APPROVED';
  v_reason text := 'Hoạt động hợp lệ qua kiểm tra tự động.';
  v_activity uuid;
  v_seq integer := 0;
  v_reward jsonb;
  -- Tốc độ duy trì (quãng đường trong cửa sổ 30 s) — cùng luật với features/activity/model/fraud.ts
  v_t numeric[] := '{}';
  v_c numeric[] := '{}';
  v_t0 timestamptz;
  v_i integer; v_j integer := 1; v_w numeric; v_sp numeric;
  v_run_sev numeric; v_run_nor numeric; v_run_veh numeric;
  v_sev numeric := 0; v_nor numeric := 0; v_veh numeric := 0;
  v_flags jsonb := '[]'::jsonb;
  -- Mất tín hiệu GPS: đoạn > 60 giây và > 150 m giữa hai điểm liên tiếp (tắt màn hình, hầm…) = tuyến bị nối thẳng
  v_gaps integer := 0;
  v_gap_s numeric := 0;
  v_gap_m numeric := 0;
  v_score integer := 0;
begin
  -- Kiểm tra đầu vào cơ bản
  if p_started_at is null or p_ended_at is null or p_ended_at <= p_started_at then raise exception 'INVALID_TIME_RANGE'; end if;
  if p_started_at > now() + interval '5 minutes' then raise exception 'INVALID_TIME_RANGE'; end if;
  if p_ended_at - p_started_at > interval '24 hours' then raise exception 'ACTIVITY_TOO_LONG'; end if;
  if jsonb_typeof(v_points) <> 'array' then raise exception 'INVALID_TRACK_POINTS'; end if;
  v_n := jsonb_array_length(v_points);
  if v_n > 20000 then raise exception 'TOO_MANY_TRACK_POINTS'; end if;

  -- Chống gửi trùng / chồng thời gian với bài chạy khác
  if exists (select 1 from public.activities
              where user_id = v_uid and started_at < p_ended_at and ended_at > p_started_at) then
    raise exception 'ACTIVITY_DUPLICATE';
  end if;
  if (select count(*) from public.activities where user_id = v_uid and created_at > now() - interval '1 day') >= 20 then
    raise exception 'RATE_LIMITED';
  end if;

  -- Tính lại quãng đường từ GPS (không tin số client gửi)
  for v_p in select value from jsonb_array_elements(v_points) loop
    if v_prev is not null then
      v_seg := private.haversine_m((v_prev->>'latitude')::numeric, (v_prev->>'longitude')::numeric,
                                   (v_p->>'latitude')::numeric, (v_p->>'longitude')::numeric);
      v_dt := extract(epoch from ((v_p->>'recorded_at')::timestamptz - (v_prev->>'recorded_at')::timestamptz));
      if v_dt > 0 and v_seg / v_dt > 12 then v_spikes := v_spikes + 1; end if;   -- > 43 km/h
      if v_dt > 60 and v_seg > 150 then v_gaps := v_gaps + 1; v_gap_s := v_gap_s + v_dt; v_gap_m := v_gap_m + v_seg; end if;
      v_gps_m := v_gps_m + coalesce(v_seg, 0);
    end if;
    v_t0 := coalesce(v_t0, (v_p->>'recorded_at')::timestamptz, p_started_at);
    v_t := v_t || extract(epoch from (coalesce((v_p->>'recorded_at')::timestamptz, v_t0) - v_t0));
    v_c := v_c || v_gps_m;
    v_prev := v_p;
  end loop;

  -- Đoạn liên tục dài nhất có tốc độ ≥ 20 km/h, ≥ 17 km/h, ≥ 25 km/h
  for v_i in 2 .. coalesce(array_length(v_t, 1), 0) loop
    while v_j < v_i and v_t[v_i] - v_t[v_j] > 30 loop v_j := v_j + 1; end loop;
    v_w := v_t[v_i] - v_t[v_j];
    if v_w < 15 then continue; end if;
    v_sp := (v_c[v_i] - v_c[v_j]) / v_w;
    if v_sp >= 20 / 3.6 then v_run_sev := coalesce(v_run_sev, v_t[v_j]); v_sev := greatest(v_sev, v_t[v_i] - v_run_sev); else v_run_sev := null; end if;
    if v_sp >= 17 / 3.6 then v_run_nor := coalesce(v_run_nor, v_t[v_j]); v_nor := greatest(v_nor, v_t[v_i] - v_run_nor); else v_run_nor := null; end if;
    if v_sp >= 25 / 3.6 then v_run_veh := coalesce(v_run_veh, v_t[v_j]); v_veh := greatest(v_veh, v_t[v_i] - v_run_veh); else v_run_veh := null; end if;
  end loop;
  if v_veh >= 30 then
    v_flags := v_flags || jsonb_build_object('code', 'VEHICLE_BURST', 'severity', 'SEVERE', 'durationS', round(v_veh));
    v_score := v_score + 35;
  end if;
  if v_sev >= 120 then
    v_flags := v_flags || jsonb_build_object('code', 'SUSTAINED_SPEED', 'severity', 'SEVERE', 'durationS', round(v_sev));
    v_score := v_score + 35;
  elsif v_nor >= 180 then
    v_flags := v_flags || jsonb_build_object('code', 'SUSTAINED_SPEED', 'severity', 'HIGH', 'durationS', round(v_nor));
    v_score := v_score + 28;
  end if;
  if v_spikes > 3 then
    v_flags := v_flags || jsonb_build_object('code', 'GPS_TELEPORT', 'severity', 'HIGH', 'count', v_spikes);
    v_score := v_score + 20;
  end if;

  if v_gaps > 0 then
    v_flags := v_flags || jsonb_build_object('code', 'GPS_GAP', 'severity', case when v_gap_m > greatest(500, 0.25 * v_gps_m) then 'HIGH' else 'INFO' end,
      'count', v_gaps, 'durationS', round(v_gap_s), 'meters', round(v_gap_m));
  end if;
  v_moving := least(greatest(coalesce(p_moving_s, 0), 0), extract(epoch from (p_ended_at - p_started_at))::integer);
  v_distance := case when v_n >= 2 then round(v_gps_m) else greatest(coalesce(p_distance_m, 0), 0) end;
  v_pace := case when v_distance > 0 then round(v_moving / (v_distance / 1000.0)) else 0 end;

  -- Luật xác thực (xem ADR-007)
  if v_distance < 200 then
    v_status := 'REJECTED'; v_reason := 'Quá ngắn (< 200 m), không đủ điều kiện ghi nhận.';
  elsif v_n < 2 then
    v_status := 'PENDING'; v_score := greatest(v_score, 40);
    v_reason := 'Bài không có dữ liệu GPS — không đối chiếu được quãng đường.';
  elsif v_pace < (cfg->>'minValidPace')::numeric * 60 then
    v_status := 'PENDING'; v_score := greatest(v_score, 75);
    v_reason := 'Pace trung bình nhanh hơn 3:00/km — vượt khả năng chạy bộ.';
  elsif v_veh >= 30 then
    v_status := 'PENDING'; v_score := greatest(v_score, 85);
    v_reason := 'Di chuyển ≥ 25 km/h liên tục ' || round(v_veh) || ' giây — giống đi xe.';
  elsif v_sev >= 120 then
    v_status := 'PENDING'; v_score := greatest(v_score, 70);
    v_reason := 'Giữ tốc độ ≥ 20 km/h (pace 3:00) liên tục ' || round(v_sev) || ' giây.';
  elsif v_nor >= 180 then
    v_status := 'PENDING'; v_score := greatest(v_score, 65);
    v_reason := 'Giữ tốc độ ≥ 17 km/h (pace 3:32) liên tục ' || round(v_nor) || ' giây.';
  elsif v_spikes > 3 then
    v_status := 'PENDING'; v_score := greatest(v_score, 50);
    v_reason := 'Vị trí GPS nhảy xa bất thường ' || v_spikes || ' lần (> 43 km/h).';
  elsif v_gap_m > greatest(500, 0.25 * v_gps_m) then
    v_status := 'PENDING'; v_score := greatest(v_score, 40);
    v_reason := 'Mất tín hiệu GPS ' || greatest(1, round(v_gap_s / 60)) || ' phút — ' || round(v_gap_m / 1000.0, 2)
                || ' km được nối thẳng, không đối chiếu được tuyến (thường do tắt màn hình khi ghi bằng trình duyệt).';
  elsif p_distance_m > 0 and abs(p_distance_m - v_distance) > greatest(0.15 * v_distance, 100) then
    v_status := 'PENDING'; v_score := greatest(v_score, 45);
    v_reason := 'Quãng đường app gửi lên lệch nhiều so với tuyến GPS.';
  end if;
  if v_status = 'PENDING' then
    v_reason := left('Mức nghi vấn: ' || private.risk_label(private.risk_level(v_score)) || '. ' || v_reason
                     || ' Bài được tính sau khi ban quản trị CLB hoặc admin xác minh.', 500);
  end if;

  v_activity := gen_random_uuid();
  insert into public.activities (
    id, user_id, title, source, started_at, ended_at, elapsed_time_s, moving_time_s,
    distance_m, moving_distance_m, avg_pace_s, status, validation_status, validation_reason,
    risk_score, risk_level, risk_flags)
  values (
    v_activity, v_uid, left(coalesce(nullif(trim(p_title), ''), 'Buổi chạy'), 120),
    case when p_source in ('DIRECT_GPS', 'STRAVA', 'GARMIN') then p_source else 'DIRECT_GPS' end,
    p_started_at, p_ended_at, greatest(coalesce(p_elapsed_s, 0), v_moving), v_moving,
    v_distance, v_distance, v_pace,
    case v_status when 'APPROVED' then 'READY' when 'PENDING' then 'PROCESSING' else 'REJECTED' end,
    v_status, v_reason,
    least(v_score, 100), private.risk_level(v_score),
    case when jsonb_array_length(v_flags) > 0 then v_flags end);

  for v_p in select value from jsonb_array_elements(v_points) loop
    v_seq := v_seq + 1;
    insert into public.activity_track_points (activity_id, sequence, latitude, longitude, accuracy, altitude, speed, recorded_at)
    values (v_activity, v_seq, (v_p->>'latitude')::numeric, (v_p->>'longitude')::numeric,
            (v_p->>'accuracy')::numeric, (v_p->>'altitude')::numeric, (v_p->>'speed')::numeric,
            coalesce((v_p->>'recorded_at')::timestamptz, p_started_at));
  end loop;

  if v_status = 'APPROVED' then
    v_reward := (select jsonb_build_object('earned_xu', x.earned_xu, 'earned_xp', x.earned_xp)
                   from public.activities x where x.id = v_activity);         -- trigger trg_auto_reward đã thưởng
  end if;

  return json_build_object(
    'success', true, 'activity_id', v_activity,
    'validation_status', v_status, 'validation_reason', v_reason,
    'distance_m', v_distance,
    'earned_xp', coalesce((v_reward->>'earned_xp')::integer, 0),
    'earned_xu', coalesce((v_reward->>'earned_xu')::numeric, 0));
end $$;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001006600_gps_track_distance.sql
-- ===================================================================
-- 006600: Quãng đường bài chạy trong app = đúng con số app đo (GPS-3).
-- Trước đây máy chủ cộng khoảng cách giữa các điểm tuyến. Điểm GPS luôn có nhiễu (rung ±5–15 m) nên cách cộng này
-- DƯ 2–11 % (mô phỏng: phố cao tầng +10,7 %), trong khi app đã hiệu chỉnh bằng vận tốc Doppler (lệch < 2 %).
-- Nay: mỗi điểm mang quãng đường tích luỹ app đo (distance_m). Máy chủ nhận từng đoạn nhưng KẸP theo hình học tuyến:
--   đoạn app báo ≤ 1,1 × khoảng cách thẳng giữa hai điểm + 3 m, và tổng ≤ tổng khoảng cách thẳng
--   → không thể khai khống quá tuyến GPS thật; app cũ (không gửi distance_m) dùng cách cũ.
-- Kèm: lưu quãng đường tích luỹ từng điểm + tính TỪNG KM ngay trên máy chủ (activity_details.splits).
-- Chạy lại nhiều lần vẫn an toàn.

alter table public.activity_track_points add column if not exists distance_m numeric;

create or replace function public.submit_and_process_activity(
  p_title text, p_source text, p_started_at timestamptz, p_ended_at timestamptz,
  p_elapsed_s integer, p_moving_s integer, p_distance_m numeric, p_avg_pace_s integer, p_track_points jsonb
) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := private.require_uid();
  cfg jsonb := private.economy_config();
  v_points jsonb := coalesce(p_track_points, '[]'::jsonb);
  v_n integer;
  v_gps_m numeric := 0;
  -- Quãng đường theo app (đã kẹp) + từng km
  v_trk_m numeric := 0;
  v_cd numeric;
  v_cd_prev numeric;
  v_step numeric;
  v_seg_t numeric;
  v_sd numeric := 0;
  v_st numeric := 0;
  v_over numeric;
  v_over_t numeric;
  v_alt0 numeric;
  v_splits jsonb := '[]'::jsonb;
  v_spikes integer := 0;
  v_prev jsonb;
  v_p jsonb;
  v_seg numeric;
  v_dt numeric;
  v_distance numeric;
  v_moving integer;
  v_pace integer;
  v_status text := 'APPROVED';
  v_reason text := 'Hoạt động hợp lệ qua kiểm tra tự động.';
  v_activity uuid;
  v_seq integer := 0;
  v_reward jsonb;
  -- Tốc độ duy trì (quãng đường trong cửa sổ 30 s) — cùng luật với features/activity/model/fraud.ts
  v_t numeric[] := '{}';
  v_c numeric[] := '{}';
  v_t0 timestamptz;
  v_i integer; v_j integer := 1; v_w numeric; v_sp numeric;
  v_run_sev numeric; v_run_nor numeric; v_run_veh numeric;
  v_sev numeric := 0; v_nor numeric := 0; v_veh numeric := 0;
  v_flags jsonb := '[]'::jsonb;
  -- Mất tín hiệu GPS: đoạn > 60 giây và > 150 m giữa hai điểm liên tiếp (tắt màn hình, hầm…) = tuyến bị nối thẳng
  v_gaps integer := 0;
  v_gap_s numeric := 0;
  v_gap_m numeric := 0;
  v_score integer := 0;
begin
  -- Kiểm tra đầu vào cơ bản
  if p_started_at is null or p_ended_at is null or p_ended_at <= p_started_at then raise exception 'INVALID_TIME_RANGE'; end if;
  if p_started_at > now() + interval '5 minutes' then raise exception 'INVALID_TIME_RANGE'; end if;
  if p_ended_at - p_started_at > interval '24 hours' then raise exception 'ACTIVITY_TOO_LONG'; end if;
  if jsonb_typeof(v_points) <> 'array' then raise exception 'INVALID_TRACK_POINTS'; end if;
  v_n := jsonb_array_length(v_points);
  if v_n > 20000 then raise exception 'TOO_MANY_TRACK_POINTS'; end if;

  -- Chống gửi trùng / chồng thời gian với bài chạy khác
  if exists (select 1 from public.activities
              where user_id = v_uid and started_at < p_ended_at and ended_at > p_started_at) then
    raise exception 'ACTIVITY_DUPLICATE';
  end if;
  if (select count(*) from public.activities where user_id = v_uid and created_at > now() - interval '1 day') >= 20 then
    raise exception 'RATE_LIMITED';
  end if;

  -- Tính lại quãng đường từ GPS (không tin số client gửi)
  for v_p in select value from jsonb_array_elements(v_points) loop
    v_cd := case when jsonb_typeof(v_p->'distance_m') = 'number' then (v_p->>'distance_m')::numeric end;
    if v_prev is null then v_alt0 := case when jsonb_typeof(v_p->'altitude') = 'number' then (v_p->>'altitude')::numeric end; end if;
    if v_prev is not null then
      v_seg := private.haversine_m((v_prev->>'latitude')::numeric, (v_prev->>'longitude')::numeric,
                                   (v_p->>'latitude')::numeric, (v_p->>'longitude')::numeric);
      v_dt := extract(epoch from ((v_p->>'recorded_at')::timestamptz - (v_prev->>'recorded_at')::timestamptz));
      if v_dt > 0 and v_seg / v_dt > 12 then v_spikes := v_spikes + 1; end if;   -- > 43 km/h
      if v_dt > 60 and v_seg > 150 then v_gaps := v_gaps + 1; v_gap_s := v_gap_s + v_dt; v_gap_m := v_gap_m + v_seg; end if;
      v_gps_m := v_gps_m + coalesce(v_seg, 0);
      -- Đoạn theo app: có distance_m ở cả hai điểm → dùng, kẹp [0, 1,1 × đoạn thẳng + 3 m]; thiếu → đoạn thẳng
      v_step := case when v_cd is not null and v_cd_prev is not null
                     then least(greatest(v_cd - v_cd_prev, 0), 1.1 * coalesce(v_seg, 0) + 3)
                     else coalesce(v_seg, 0) end;
      v_trk_m := v_trk_m + v_step;
      -- Từng km: đoạn ≤ 30 s tính đủ giờ; dài hơn (đứng chờ / mất tín hiệu) chỉ tính phần di chuyển ước lượng ≥ 1,5 m/s
      if v_dt > 0 then
        v_seg_t := case when v_dt <= 30 then v_dt else least(v_dt, v_step / 1.5) end;
        v_sd := v_sd + v_step; v_st := v_st + v_seg_t;
        while v_sd >= 1000 loop
          v_over := v_sd - 1000;
          v_over_t := case when v_step > 0 then v_seg_t * v_over / v_step else 0 end;
          v_splits := v_splits || jsonb_build_object('distance_m', 1000, 'moving_s', greatest(0, round(v_st - v_over_t)),
            'elev_m', case when v_alt0 is not null and jsonb_typeof(v_p->'altitude') = 'number' then round(((v_p->>'altitude')::numeric - v_alt0) * 10) / 10 end,
            'hr', null);
          v_sd := v_over; v_st := v_over_t;
          v_alt0 := case when jsonb_typeof(v_p->'altitude') = 'number' then (v_p->>'altitude')::numeric end;
        end loop;
      end if;
    end if;
    v_cd_prev := v_cd;
    v_t0 := coalesce(v_t0, (v_p->>'recorded_at')::timestamptz, p_started_at);
    v_t := v_t || extract(epoch from (coalesce((v_p->>'recorded_at')::timestamptz, v_t0) - v_t0));
    v_c := v_c || v_trk_m;
    v_prev := v_p;
  end loop;

  -- Đoạn liên tục dài nhất có tốc độ ≥ 20 km/h, ≥ 17 km/h, ≥ 25 km/h
  for v_i in 2 .. coalesce(array_length(v_t, 1), 0) loop
    while v_j < v_i and v_t[v_i] - v_t[v_j] > 30 loop v_j := v_j + 1; end loop;
    v_w := v_t[v_i] - v_t[v_j];
    if v_w < 15 then continue; end if;
    v_sp := (v_c[v_i] - v_c[v_j]) / v_w;
    if v_sp >= 20 / 3.6 then v_run_sev := coalesce(v_run_sev, v_t[v_j]); v_sev := greatest(v_sev, v_t[v_i] - v_run_sev); else v_run_sev := null; end if;
    if v_sp >= 17 / 3.6 then v_run_nor := coalesce(v_run_nor, v_t[v_j]); v_nor := greatest(v_nor, v_t[v_i] - v_run_nor); else v_run_nor := null; end if;
    if v_sp >= 25 / 3.6 then v_run_veh := coalesce(v_run_veh, v_t[v_j]); v_veh := greatest(v_veh, v_t[v_i] - v_run_veh); else v_run_veh := null; end if;
  end loop;
  if v_veh >= 30 then
    v_flags := v_flags || jsonb_build_object('code', 'VEHICLE_BURST', 'severity', 'SEVERE', 'durationS', round(v_veh));
    v_score := v_score + 35;
  end if;
  if v_sev >= 120 then
    v_flags := v_flags || jsonb_build_object('code', 'SUSTAINED_SPEED', 'severity', 'SEVERE', 'durationS', round(v_sev));
    v_score := v_score + 35;
  elsif v_nor >= 180 then
    v_flags := v_flags || jsonb_build_object('code', 'SUSTAINED_SPEED', 'severity', 'HIGH', 'durationS', round(v_nor));
    v_score := v_score + 28;
  end if;
  if v_spikes > 3 then
    v_flags := v_flags || jsonb_build_object('code', 'GPS_TELEPORT', 'severity', 'HIGH', 'count', v_spikes);
    v_score := v_score + 20;
  end if;

  if v_gaps > 0 then
    v_flags := v_flags || jsonb_build_object('code', 'GPS_GAP', 'severity', case when v_gap_m > greatest(500, 0.25 * v_gps_m) then 'HIGH' else 'INFO' end,
      'count', v_gaps, 'durationS', round(v_gap_s), 'meters', round(v_gap_m));
  end if;
  v_moving := least(greatest(coalesce(p_moving_s, 0), 0), extract(epoch from (p_ended_at - p_started_at))::integer);
  v_distance := case when v_n >= 2 then round(least(v_trk_m, v_gps_m)) else greatest(coalesce(p_distance_m, 0), 0) end;
  v_pace := case when v_distance > 0 then round(v_moving / (v_distance / 1000.0)) else 0 end;

  -- Luật xác thực (xem ADR-007)
  if v_distance < 200 then
    v_status := 'REJECTED'; v_reason := 'Quá ngắn (< 200 m), không đủ điều kiện ghi nhận.';
  elsif v_n < 2 then
    v_status := 'PENDING'; v_score := greatest(v_score, 40);
    v_reason := 'Bài không có dữ liệu GPS — không đối chiếu được quãng đường.';
  elsif v_pace < (cfg->>'minValidPace')::numeric * 60 then
    v_status := 'PENDING'; v_score := greatest(v_score, 75);
    v_reason := 'Pace trung bình nhanh hơn 3:00/km — vượt khả năng chạy bộ.';
  elsif v_veh >= 30 then
    v_status := 'PENDING'; v_score := greatest(v_score, 85);
    v_reason := 'Di chuyển ≥ 25 km/h liên tục ' || round(v_veh) || ' giây — giống đi xe.';
  elsif v_sev >= 120 then
    v_status := 'PENDING'; v_score := greatest(v_score, 70);
    v_reason := 'Giữ tốc độ ≥ 20 km/h (pace 3:00) liên tục ' || round(v_sev) || ' giây.';
  elsif v_nor >= 180 then
    v_status := 'PENDING'; v_score := greatest(v_score, 65);
    v_reason := 'Giữ tốc độ ≥ 17 km/h (pace 3:32) liên tục ' || round(v_nor) || ' giây.';
  elsif v_spikes > 3 then
    v_status := 'PENDING'; v_score := greatest(v_score, 50);
    v_reason := 'Vị trí GPS nhảy xa bất thường ' || v_spikes || ' lần (> 43 km/h).';
  elsif v_gap_m > greatest(500, 0.25 * v_gps_m) then
    v_status := 'PENDING'; v_score := greatest(v_score, 40);
    v_reason := 'Mất tín hiệu GPS ' || greatest(1, round(v_gap_s / 60)) || ' phút — ' || round(v_gap_m / 1000.0, 2)
                || ' km được nối thẳng, không đối chiếu được tuyến (thường do tắt màn hình khi ghi bằng trình duyệt).';
  elsif p_distance_m > 0 and abs(p_distance_m - v_distance) > greatest(0.15 * v_distance, 100) then
    v_status := 'PENDING'; v_score := greatest(v_score, 45);
    v_reason := 'Quãng đường app gửi lên lệch nhiều so với tuyến GPS.';
  end if;
  if v_status = 'PENDING' then
    v_reason := left('Mức nghi vấn: ' || private.risk_label(private.risk_level(v_score)) || '. ' || v_reason
                     || ' Bài được tính sau khi ban quản trị CLB hoặc admin xác minh.', 500);
  end if;

  v_activity := gen_random_uuid();
  insert into public.activities (
    id, user_id, title, source, started_at, ended_at, elapsed_time_s, moving_time_s,
    distance_m, moving_distance_m, avg_pace_s, status, validation_status, validation_reason,
    risk_score, risk_level, risk_flags)
  values (
    v_activity, v_uid, left(coalesce(nullif(trim(p_title), ''), 'Buổi chạy'), 120),
    case when p_source in ('DIRECT_GPS', 'STRAVA', 'GARMIN') then p_source else 'DIRECT_GPS' end,
    p_started_at, p_ended_at, greatest(coalesce(p_elapsed_s, 0), v_moving), v_moving,
    v_distance, v_distance, v_pace,
    case v_status when 'APPROVED' then 'READY' when 'PENDING' then 'PROCESSING' else 'REJECTED' end,
    v_status, v_reason,
    least(v_score, 100), private.risk_level(v_score),
    case when jsonb_array_length(v_flags) > 0 then v_flags end);

  for v_p in select value from jsonb_array_elements(v_points) loop
    v_seq := v_seq + 1;
    insert into public.activity_track_points (activity_id, sequence, latitude, longitude, accuracy, altitude, speed, recorded_at, distance_m)
    values (v_activity, v_seq, (v_p->>'latitude')::numeric, (v_p->>'longitude')::numeric,
            (v_p->>'accuracy')::numeric, (v_p->>'altitude')::numeric, (v_p->>'speed')::numeric,
            coalesce((v_p->>'recorded_at')::timestamptz, p_started_at), round(v_c[v_seq], 1));
  end loop;

  -- Từng km (km lẻ cuối ≥ 100 m) — màn chi tiết bài chạy đọc thẳng, khớp quãng đường đã lưu
  if v_n >= 2 then
    if v_sd >= 100 and v_st > 0 then
      v_splits := v_splits || jsonb_build_object('distance_m', round(v_sd), 'moving_s', round(v_st), 'elev_m', null, 'hr', null);
    end if;
    insert into public.activity_details (activity_id, splits, start_lat, start_lng, detailed)
    values (v_activity, v_splits, (v_points->0->>'latitude')::numeric, (v_points->0->>'longitude')::numeric, true)
    on conflict (activity_id) do update set splits = excluded.splits;
  end if;

  if v_status = 'APPROVED' then
    v_reward := (select jsonb_build_object('earned_xu', x.earned_xu, 'earned_xp', x.earned_xp)
                   from public.activities x where x.id = v_activity);         -- trigger trg_auto_reward đã thưởng
  end if;

  return json_build_object(
    'success', true, 'activity_id', v_activity,
    'validation_status', v_status, 'validation_reason', v_reason,
    'distance_m', v_distance,
    'earned_xp', coalesce((v_reward->>'earned_xp')::integer, 0),
    'earned_xu', coalesce((v_reward->>'earned_xu')::numeric, 0));
end $$;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001006700_strava_display_compliance.sql
-- ===================================================================
-- 006700: Tuân thủ Thoả thuận API Strava (hiệu lực 11/11/2024): dữ liệu Strava của một người chỉ được hiển thị cho
-- CHÍNH người đó trong app bên thứ ba. Bài đồng bộ từ Strava: người khác chỉ thấy số tổng (quãng đường, thời gian, pace)
-- — ẩn bản đồ tuyến, từng km, nhịp tim, nhịp bước, calo, thiết bị. Chủ bài vẫn xem đầy đủ.
-- Bài ghi bằng app RaceHub / nhập tay không bị ảnh hưởng. Chạy lại nhiều lần vẫn an toàn.
-- Còn lại cần chủ sản phẩm quyết định (xem docs/RUI_RO_VA_PHONG_NGUA.md): quãng đường Strava trên BXH / bảng tin CLB.

create or replace function public.activity_detail(p_activity_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  a public.activities := (select x from public.activities x where x.id = p_activity_id);
  d public.activity_details := (select x from public.activity_details x where x.activity_id = p_activity_id);
  v_mine boolean;
  v_map boolean;
  -- Bài đồng bộ từ Strava, người xem không phải chủ bài → chỉ số tổng, không chi tiết (API Agreement Strava 11/2024)
  v_strava_other boolean;
begin
  if a.id is null or coalesce(a.status, '') = 'DELETED' then raise exception 'ACTIVITY_NOT_FOUND'; end if;
  v_mine := a.user_id = v_uid;
  if not v_mine and not (public.can_view_activities(a.user_id) and public.activity_is_countable(a.status, a.validation_status)) then
    raise exception 'ACTIVITY_NOT_FOUND';
  end if;
  v_strava_other := not v_mine and a.source = 'STRAVA';
  v_map := v_mine or (not v_strava_other and public.can_view_map(a.user_id));

  return jsonb_build_object(
    'id', a.id, 'title', a.title, 'source', a.source, 'sport_type', a.sport_type, 'device_name', case when not v_strava_other then a.device_name end,
    'started_at', a.started_at, 'distance_m', coalesce(a.moving_distance_m, a.distance_m, 0),
    'moving_s', coalesce(a.moving_time_s, a.elapsed_time_s, 0), 'elapsed_s', coalesce(a.elapsed_time_s, 0),
    'avg_pace_s', a.avg_pace_s, 'elevation_gain_m', coalesce(a.elevation_gain_m, 0),
    'avg_heartrate', case when not v_strava_other then a.avg_heartrate end,
    'max_heartrate', case when not v_strava_other then d.max_heartrate end,
    'avg_cadence', case when not v_strava_other then d.avg_cadence end,
    'calories', case when not v_strava_other then d.calories end,
    'strava_limited', v_strava_other,
    'strava_id', case when v_mine and a.source = 'STRAVA' then a.source_activity_id end,
    'validation_status', a.validation_status,
    'validation_reason', case when v_mine then a.validation_reason end,
    'earned_xu', a.earned_xu, 'earned_xp', a.earned_xp,
    'is_mine', v_mine,
    'owner', (select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url, 'level', p.level)
                from public.profiles p where p.id = a.user_id),
    'map_allowed', v_map,
    'polyline', case when v_map then d.polyline end,
    -- Bài GPS trong app: điểm GPS rút gọn ≤ ~1000 điểm [lat, lng, giây kể từ lúc bắt đầu, độ cao]
    'points', case when v_map and d.polyline is null then (
        select jsonb_agg(jsonb_build_array(s.latitude, s.longitude,
                 round(extract(epoch from (s.recorded_at - a.started_at))), s.altitude) order by s.sequence)
          from (select t.latitude, t.longitude, t.recorded_at, t.altitude, t.sequence,
                       row_number() over (order by t.sequence) as rn, count(*) over () as cnt
                  from public.activity_track_points t where t.activity_id = a.id) s
         where s.rn % greatest(ceil(s.cnt / 1000.0)::int, 1) = 0 or s.rn = s.cnt) end,
    'splits', case when not v_strava_other then d.splits end,
    'needs_detail', v_mine and a.source = 'STRAVA' and not coalesce(d.detailed, false),
    'challenges', case when v_mine then (
        select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'counted_m', e.counted_m) order by e.created_at), '[]'::jsonb)
          from public.challenge_progress_events e join public.challenges c on c.id = e.challenge_id
         where e.activity_id = a.id) else '[]'::jsonb end,
    'cheers', (select jsonb_build_object('count', count(*), 'total', coalesce(sum(ch.amount), 0))
                 from public.cheers ch where ch.activity_id = a.id),
    -- So với 10 bài trước đó của chính người chạy (để hiện "dài hơn / nhanh hơn thường lệ")
    'compare', (select jsonb_build_object(
          'runs', count(*),
          'avg_distance_m', round(avg(coalesce(x.moving_distance_m, x.distance_m))),
          'avg_pace_s', round(avg(x.avg_pace_s) filter (where x.avg_pace_s > 0)),
          'longest_30d', coalesce(a.distance_m >= (select max(y.distance_m) from public.activities y
                              where y.user_id = a.user_id and y.id <> a.id and public.activity_is_countable(y.status, y.validation_status)
                                and y.started_at > a.started_at - interval '30 days' and y.started_at <= a.started_at), true))
        from (select z.*, row_number() over (order by z.started_at desc) as rn
                from public.activities z
               where z.user_id = a.user_id and z.id <> a.id and z.started_at < a.started_at
                 and public.activity_is_countable(z.status, z.validation_status)) x
       where x.rn <= 10)
  );
end $$;

revoke all on function public.activity_detail(uuid) from public, anon;
grant execute on function public.activity_detail(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001006800_account_deletion.sql
-- ===================================================================
-- 006800: Xoá tài khoản ngay trong app.
-- Bắt buộc với app có đăng ký tài khoản trên App Store (Apple, mục 5.1.1(v)) và Google Play; đồng thời đáp ứng quyền
-- yêu cầu xoá dữ liệu của Luật Bảo vệ dữ liệu cá nhân 2025 (hiệu lực 01/01/2026; dữ liệu vị trí là dữ liệu nhạy cảm).
--
-- Cách xoá: XOÁ dữ liệu cá nhân + ẨN DANH phần còn lại, giữ bản ghi giao dịch (đơn hàng, sổ Xu) ở dạng ẩn danh
-- vì nghĩa vụ kế toán / đối soát. Sau RPC này, route /api/account/delete xoá mềm tài khoản đăng nhập (auth)
-- — email được làm rối, người dùng đăng ký lại được bằng chính email đó như tài khoản mới.
--
-- Chặn: quản trị viên (phải được gỡ quyền trước) và chủ nhiệm CLB còn thành viên khác (chuyển quyền trước).
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT. Chạy lại nhiều lần vẫn an toàn.

alter table public.profiles add column if not exists deleted_at timestamptz;

create or replace function public.delete_my_account(p_confirm text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_p public.profiles := (select x from public.profiles x where x.id = v_uid);
  v_runs integer;
begin
  if coalesce(upper(trim(p_confirm)), '') not in ('XOÁ', 'XÓA', 'XOA') then raise exception 'CONFIRM_REQUIRED'; end if;
  if v_p.id is null then raise exception 'PROFILE_NOT_FOUND'; end if;
  if v_p.deleted_at is not null then return jsonb_build_object('ok', true, 'already', true); end if;
  if coalesce(v_p.is_admin, false) or coalesce(v_p.role, '') in ('SYSTEM_ADMIN', 'ADMIN', 'SUPER_ADMIN') then raise exception 'ADMIN_CANNOT_DELETE'; end if;
  if exists (select 1 from public.clubs c where c.owner_id = v_uid
               and exists (select 1 from public.club_members m where m.club_id = c.id and m.user_id <> v_uid and m.status = 'APPROVED')) then
    raise exception 'TRANSFER_CLUB_FIRST';
  end if;

  -- 1. Bài chạy: xoá tuyến GPS + chi tiết (dữ liệu vị trí), ẩn bài (không còn hiện ở đâu)
  delete from public.activity_track_points t using public.activities a where t.activity_id = a.id and a.user_id = v_uid;
  delete from public.activity_details d using public.activities a where d.activity_id = a.id and a.user_id = v_uid;
  update public.activities set status = 'DELETED', title = 'Buổi chạy', device_name = null where user_id = v_uid;
  v_runs := (select count(*) from public.activities where user_id = v_uid);

  -- 2. Dữ liệu cá nhân / thiết bị / vị trí
  delete from public.profile_details where user_id = v_uid;
  delete from public.push_subscriptions where user_id = v_uid;
  delete from public.push_settings where user_id = v_uid;
  delete from public.notification_settings where user_id = v_uid;
  delete from public.notifications where user_id = v_uid;
  delete from public.runner_discovery_settings where user_id = v_uid;
  delete from public.runner_location_presence where user_id = v_uid;
  delete from public.runner_nearby_searches where user_id = v_uid;
  delete from public.connected_accounts where user_id = v_uid;
  delete from public.content_bookmarks where user_id = v_uid;
  delete from public.content_read_history where user_id = v_uid;
  delete from public.content_user_events where user_id = v_uid;
  delete from public.club_message_reads where user_id = v_uid;
  delete from public.bib_listings where user_id = v_uid;
  delete from public.bib_contact_reveals where user_id = v_uid;
  delete from public.content_staff where user_id = v_uid;
  update public.content_authors set user_id = null where user_id = v_uid;
  update public.partners set status = 'HIDDEN', contacts = '{}'::jsonb, address = null where owner_id = v_uid;
  update public.challenge_honor_prefs set photo_url = null, hidden = true where user_id = v_uid;

  -- 3. Rời mọi CLB (CLB chỉ còn mình mình thì CLB giữ nguyên, không còn thành viên)
  delete from public.club_members where user_id = v_uid;

  -- 4. Hồ sơ: ẩn danh (bài viết / tin nhắn cũ trong CLB hiện "Người dùng đã xoá")
  update public.profiles set
    display_name = 'Người dùng đã xoá', avatar_url = null, bio = null, gender = null,
    strava_connected = false, strava_access_token = null, strava_refresh_token = null,
    strava_token_expires_at = null, strava_athlete_id = null,
    gift_wall_public = false, referral_code = null,
    banned_at = coalesce(banned_at, now()), banned_reason = 'ACCOUNT_DELETED',
    deleted_at = now(), updated_at = now()
  where id = v_uid;

  return jsonb_build_object('ok', true, 'activities_hidden', v_runs);
end $$;

revoke all on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001006900_notify_never_blocks.sql
-- ===================================================================
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

commit;
