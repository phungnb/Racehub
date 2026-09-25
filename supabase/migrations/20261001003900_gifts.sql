-- 003900: Kho quà tặng ảo (thay "cổ vũ bằng Xu").
-- • Quy tắc 04: Xu KHÔNG chuyển P2P. Tặng quà = Xu của người tặng bị ĐỐT (về hệ thống); người nhận KHÔNG nhận Xu,
--   chỉ nhận quà hiện trên hồ sơ (tường quà) + "Điểm tỏa sáng" (tổng giá trị quà nhận, không quy đổi được).
-- • Kho quà theo 4 tầng (tham khảo TikTok LIVE / Bigo / Twitch Bits): Cổ vũ (1–10 Xu) · Tiếp sức (20–100) ·
--   Bùng nổ (200–1.000) · Huyền thoại (2.000–10.000). Quà càng lớn hiệu ứng càng lớn; quà nhỏ tặng combo ×5 / ×10.
--   Có quà theo mùa (Tết, Trung thu — tự bật theo ngày) và quà riêng cho VIP (chỉ là trang trí, không tăng thành tích).
--   Không có quà đồ uống có cồn.
-- • Admin sửa giá / tên / biểu tượng / bật tắt / thêm quà ở Quản trị → Quà tặng.
-- Cần file 003800. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

create table if not exists public.gift_catalog (
  code text primary key check (code ~ '^[a-z0-9_]{2,40}$'),
  name text not null check (char_length(name) between 2 and 40),
  emoji text not null check (char_length(emoji) between 1 and 16),
  price_xu integer not null check (price_xu between 1 and 1000000),
  tier text not null check (tier in ('CHEER', 'BOOST', 'HYPE', 'LEGEND')),
  description text check (description is null or char_length(description) <= 120),
  vip_tier integer not null default 0 check (vip_tier between 0 and 3),
  season_from date,                                 -- quà theo mùa: chỉ hiện trong khoảng ngày (bỏ năm → dùng tháng-ngày)
  season_to date,
  is_active boolean not null default true,
  sort integer not null default 0
);

insert into public.gift_catalog (code, name, emoji, price_xu, tier, description, vip_tier, season_from, season_to, sort) values
  ('clap',        'Vỗ tay',           '👏', 1,     'CHEER',  'Tràng pháo tay cổ vũ',                 0, null, null, 10),
  ('water',       'Nước suối',        '💧', 5,     'CHEER',  'Tiếp nước giữa đường chạy',            0, null, null, 11),
  ('banana',      'Chuối',            '🍌', 5,     'CHEER',  'Chống chuột rút',                       0, null, null, 12),
  ('coffee',      'Cà phê',           '☕', 10,    'CHEER',  'Ly cà phê sau buổi chạy sáng',          0, null, null, 13),
  ('rose',        'Hoa hồng',         '🌹', 10,    'CHEER',  'Tặng người truyền cảm hứng',            0, null, null, 14),
  ('energy_gel',  'Gel năng lượng',   '🔋', 20,    'BOOST',  'Nạp năng lượng cho km cuối',            0, null, null, 20),
  ('electrolyte', 'Điện giải',        '🧃', 30,    'BOOST',  'Bù khoáng sau buổi chạy dài',           0, null, null, 21),
  ('energy_drink','Nước tăng lực',    '🥤', 50,    'BOOST',  'Tăng tốc về đích',                      0, null, null, 22),
  ('medal',       'Huy chương',       '🏅', 80,    'BOOST',  'Ghi nhận một buổi chạy đẹp',            0, null, null, 23),
  ('trophy',      'Cúp',              '🏆', 100,   'BOOST',  'Nhà vô địch hôm nay',                   0, null, null, 24),
  ('fireworks',   'Pháo hoa',         '🎆', 200,   'HYPE',   'Ăn mừng thành tích mới',                0, null, null, 30),
  ('laurel',      'Vòng nguyệt quế',  '🌿', 300,   'HYPE',   'Vinh danh người chiến thắng',           0, null, null, 31),
  ('golden_shoes','Giày vàng',        '👟', 500,   'HYPE',   'Đôi chân không biết mỏi',               0, null, null, 32),
  ('rocket',      'Tên lửa',          '🚀', 1000,  'HYPE',   'Pace như tên lửa',                      0, null, null, 33),
  ('rainbow',     'Cầu vồng về đích', '🌈', 2000,  'LEGEND', 'Hiệu ứng toàn màn hình',                0, null, null, 40),
  ('phoenix',     'Phượng hoàng',     '🦅', 5000,  'LEGEND', 'Trở lại mạnh mẽ hơn',                   0, null, null, 41),
  ('crown',       'Vương miện',       '👑', 10000, 'LEGEND', 'Vua đường chạy',                        0, null, null, 42),
  ('vip_star',    'Ngôi sao VIP',     '🌟', 30,    'BOOST',  'Quà riêng thành viên VIP',              1, null, null, 25),
  ('lucky_money', 'Lì xì',            '🧧', 88,    'BOOST',  'Quà Tết — chúc năm mới chạy khỏe',      0, '2000-01-15', '2000-02-28', 50),
  ('lantern',     'Đèn lồng',         '🏮', 30,    'BOOST',  'Quà Trung thu',                         0, '2000-09-01', '2000-10-15', 51)
on conflict (code) do nothing;

alter table public.gift_catalog enable row level security;
revoke all on public.gift_catalog from anon, authenticated;

-- Quà được ghi vào bảng cheers (giữ tổng hiện có trên bài chạy / bài đăng); amount = tổng Xu đã đốt
alter table public.cheers drop constraint if exists cheers_amount_check;
alter table public.cheers alter column amount type numeric(12, 1);
alter table public.cheers drop constraint if exists cheers_amount_chk;
alter table public.cheers add constraint cheers_amount_chk check (amount between 1 and 100000000);
alter table public.cheers add column if not exists gift_code text references public.gift_catalog(code);
alter table public.cheers add column if not exists qty integer not null default 1;
create index if not exists cheers_to_user_idx on public.cheers (to_user, created_at desc);

create or replace function private.gift_in_season(g public.gift_catalog, p_day date) returns boolean
language sql immutable as $$
  select g.season_from is null or g.season_to is null
      or to_char(p_day, 'MM-DD') between to_char(g.season_from, 'MM-DD') and to_char(g.season_to, 'MM-DD')
$$;

create or replace function private.user_vip_tier(p_user uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((private.active_plan(p_user)->>'tier')::int, 0)
    * case when (private.active_plan(p_user)->>'plan_code') like 'VIP%' then 1 else 0 end
$$;

-- Danh sách quà cho người dùng (đang bán, đúng mùa; quà VIP hiện kèm khóa nếu chưa đủ bậc)
create or replace function public.gift_catalog() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'gifts', (select coalesce(jsonb_agg(jsonb_build_object('code', g.code, 'name', g.name, 'emoji', g.emoji, 'price_xu', g.price_xu,
                'tier', g.tier, 'description', g.description, 'vip_tier', g.vip_tier, 'seasonal', g.season_from is not null,
                'locked', g.vip_tier > private.user_vip_tier(auth.uid())) order by g.sort, g.price_xu), '[]'::jsonb)
              from public.gift_catalog g where g.is_active and private.gift_in_season(g, private.vn_day(now()))),
    'daily_cap', coalesce((private.economy_config()->>'giftDailyCapXu')::int, 20000),
    'sent_today', coalesce((select sum(c.amount) from public.cheers c where c.from_user = auth.uid() and c.gift_code is not null
                             and c.created_at >= private.vn_start(private.vn_day(now()))), 0))
$$;

create or replace function public.send_gift(
  p_to_user uuid, p_gift_code text, p_qty integer default 1, p_message text default null, p_post_id uuid default null,
  p_activity_id uuid default null, p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  g public.gift_catalog := (select x from public.gift_catalog x where x.code = p_gift_code);
  v_qty integer := coalesce(p_qty, 1);
  v_total integer;
  v_msg text := nullif(trim(coalesce(p_message, '')), '');
  v_club uuid;
  v_author uuid;
  v_id uuid := (select c.id from public.cheers c where c.idempotency_key = p_idempotency_key);
  v_sent numeric;
  v_name text;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if v_id is not null then return jsonb_build_object('gift_id', v_id, 'duplicate', true); end if;
  if g.code is null or not g.is_active or not private.gift_in_season(g, private.vn_day(now())) then raise exception 'GIFT_NOT_AVAILABLE'; end if;
  if g.vip_tier > private.user_vip_tier(v_uid) then raise exception 'VIP_REQUIRED'; end if;
  if v_qty not in (1, 5, 10, 99) then raise exception 'INVALID_QTY'; end if;
  if p_to_user is null or p_to_user = v_uid then raise exception 'CANNOT_GIFT_SELF'; end if;
  if not exists (select 1 from public.profiles where id = p_to_user) then raise exception 'USER_NOT_FOUND'; end if;
  if v_msg is not null and char_length(v_msg) > 140 then raise exception 'MESSAGE_TOO_LONG'; end if;
  if p_post_id is not null then
    v_club := (select cp.club_id from public.club_posts cp where cp.id = p_post_id and cp.deleted_at is null);
    v_author := (select cp.author_id from public.club_posts cp where cp.id = p_post_id and cp.deleted_at is null);
    if v_club is null or not public.club_is_member(v_club) or v_author is distinct from p_to_user then raise exception 'FORBIDDEN'; end if;
  end if;
  if p_activity_id is not null and not exists (select 1 from public.activities where id = p_activity_id and user_id = p_to_user) then
    raise exception 'FORBIDDEN';
  end if;

  v_total := g.price_xu * v_qty;
  perform pg_advisory_xact_lock(hashtextextended('gift:' || v_uid, 0));
  v_sent := coalesce((select sum(c.amount) from public.cheers c where c.from_user = v_uid and c.gift_code is not null
                       and c.created_at >= private.vn_start(private.vn_day(now()))), 0);
  if v_sent + v_total > coalesce((private.economy_config()->>'giftDailyCapXu')::int, 20000) then raise exception 'GIFT_DAILY_LIMIT'; end if;
  if private.balance(v_uid) < v_total then raise exception 'INSUFFICIENT_BALANCE'; end if;

  -- Đốt Xu: người tặng → hệ thống. Người nhận KHÔNG nhận Xu.
  perform private.ledger_post('GIFT', 'gift:' || p_idempotency_key, 'Tặng ' || v_qty || ' × ' || g.name || ' cho ' || private.display_name(p_to_user), v_uid,
    private.debit_entries(v_uid, v_total, private.system_account()));
  insert into public.cheers (from_user, to_user, amount, message, activity_id, post_id, club_id, idempotency_key, gift_code, qty)
  values (v_uid, p_to_user, v_total, v_msg, p_activity_id, p_post_id, v_club, p_idempotency_key, g.code, v_qty)
  returning id into v_id;
  if p_post_id is not null then update public.club_posts set cheer_xu = cheer_xu + v_total where id = p_post_id; end if;

  v_name := private.display_name(v_uid);
  perform private.award(p_to_user, 'GIFT_IN', v_name || ' tặng bạn ' || case when v_qty > 1 then v_qty || ' × ' else '' end || g.emoji || ' ' || g.name,
    v_msg, 0, 0, 'gift_in:' || v_id, p_activity_id, jsonb_build_object('from', v_uid, 'gift', g.code, 'emoji', g.emoji, 'qty', v_qty, 'tier', g.tier));
  perform private.notify(p_to_user, v_club, 'GIFT', v_name || ' tặng bạn ' || case when v_qty > 1 then v_qty || ' × ' else '' end || g.emoji || ' ' || g.name,
    coalesce(v_msg, g.description), case when p_activity_id is not null then '/activities/' || p_activity_id
                                         when v_club is not null then '/clubs/' || v_club else '/me' end, v_uid, g.tier in ('HYPE', 'LEGEND'));
  return jsonb_build_object('gift_id', v_id, 'total_xu', v_total, 'emoji', g.emoji, 'tier', g.tier, 'qty', v_qty, 'balance', private.balance(v_uid));
end $$;

-- Cổ vũ bằng Xu cũ (chuyển Xu cho người nhận) — ngừng: dùng quà tặng
create or replace function public.send_cheer(
  p_to_user uuid, p_amount numeric, p_message text default null, p_post_id uuid default null,
  p_activity_id uuid default null, p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'CHEER_REPLACED_BY_GIFTS';
end $$;

-- Tường quà trên hồ sơ: quà đã nhận (theo loại), điểm tỏa sáng, người tặng nhiều nhất
create or replace function public.gift_wall(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'shine', coalesce((select sum(c.amount) from public.cheers c where c.to_user = p_user and c.gift_code is not null), 0),
    'count', coalesce((select sum(c.qty) from public.cheers c where c.to_user = p_user and c.gift_code is not null), 0),
    'gifts', (select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'name', t.name, 'emoji', t.emoji, 'tier', t.tier, 'count', t.n)
                                         order by t.price desc), '[]'::jsonb)
                from (select g.code, g.name, g.emoji, g.tier, g.price_xu as price, sum(c.qty) as n
                        from public.cheers c join public.gift_catalog g on g.code = c.gift_code
                       where c.to_user = p_user group by g.code, g.name, g.emoji, g.tier, g.price_xu) t),
    'top_supporters', (select coalesce(jsonb_agg(jsonb_build_object('user_id', t.from_user, 'display_name', private.display_name(t.from_user),
                                                  'avatar_url', (select p.avatar_url from public.profiles p where p.id = t.from_user), 'shine', t.s)
                                                  order by t.s desc), '[]'::jsonb)
                         from (select c.from_user, sum(c.amount) as s, row_number() over (order by sum(c.amount) desc) as rn
                                 from public.cheers c where c.to_user = p_user and c.gift_code is not null group by c.from_user) t
                        where t.rn <= 5))
$$;

-- Admin: quản lý kho quà
create or replace function public.admin_save_gift(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_admin();
begin
  insert into public.gift_catalog (code, name, emoji, price_xu, tier, description, vip_tier, season_from, season_to, is_active, sort)
  values (lower(trim(p->>'code')), trim(p->>'name'), trim(p->>'emoji'), (p->>'price_xu')::int, upper(p->>'tier'), nullif(trim(coalesce(p->>'description', '')), ''),
          coalesce((p->>'vip_tier')::int, 0), nullif(p->>'season_from', '')::date, nullif(p->>'season_to', '')::date,
          coalesce((p->>'is_active')::boolean, true), coalesce((p->>'sort')::int, 0))
  on conflict (code) do update set name = excluded.name, emoji = excluded.emoji, price_xu = excluded.price_xu, tier = excluded.tier,
    description = excluded.description, vip_tier = excluded.vip_tier, season_from = excluded.season_from, season_to = excluded.season_to,
    is_active = excluded.is_active, sort = excluded.sort;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SAVE_GIFT', p->>'code', p);
end $$;

create or replace function public.admin_list_gifts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(g) || jsonb_build_object(
            'sent_30d', coalesce((select sum(c.qty) from public.cheers c where c.gift_code = g.code and c.created_at > now() - interval '30 days'), 0),
            'burn_30d', coalesce((select sum(c.amount) from public.cheers c where c.gift_code = g.code and c.created_at > now() - interval '30 days'), 0))
          order by g.sort, g.price_xu), '[]'::jsonb) from public.gift_catalog g);
end $$;

revoke all on function private.gift_in_season(public.gift_catalog, date), private.user_vip_tier(uuid) from public, anon, authenticated;
revoke all on function public.gift_catalog(), public.send_gift(uuid, text, integer, text, uuid, uuid, text), public.gift_wall(uuid),
  public.admin_save_gift(jsonb), public.admin_list_gifts() from public, anon;
grant execute on function public.gift_catalog(), public.send_gift(uuid, text, integer, text, uuid, uuid, text), public.gift_wall(uuid),
  public.admin_save_gift(jsonb), public.admin_list_gifts() to authenticated;

notify pgrst, 'reload schema';
