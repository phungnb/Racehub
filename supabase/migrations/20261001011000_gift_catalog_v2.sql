-- 011000: KHO QUÀ V2 — QUÀ TĨNH / QUÀ HIỆU ỨNG ĐỘNG, QUÀ THEO MỐC, 45 QUÀ MỚI, ẢNH RIÊNG
--   • Mỗi quà có loại: STATIC (quà tĩnh — hình đứng yên cạnh bài) hoặc ANIMATED (quà động — hoạt ảnh khi tặng;
--     dưới 1.000 Xu chạy trong khung bài, từ 1.000 Xu toàn màn hình). App chia bảng quà thành 2 tab theo loại.
--   • Ảnh riêng cho quà (art_url, ảnh tĩnh hoặc WebP động): admin tải lên ở Quản trị → Quà tặng. Chưa có ảnh → dùng emoji.
--   • Quà theo mốc (context): chỉ tặng được trên bài chạy hợp lệ đạt mốc — KM5 (≥ 5 km), KM10, HALF (≥ 21 km),
--     FULL (≥ 42 km), ULTRA (≥ 45 km), PR (kỷ lục cá nhân: dài nhất từ trước tới nay, hoặc pace nhanh nhất ở bài ≥ 5 km).
--   • 45 quà mới (28 tĩnh, 17 động). "Huy chương" đổi tên thành "Huy chương vàng". "Siêu tân tinh" tạo sẵn nhưng tắt —
--     chỉ bật vào dịp đặc biệt. Quà Tết (hoa đào, hoa mai, pháo hoa giao thừa) tự hiện 15/1–28/2.
--   • Không có quốc kỳ, sao vàng, bản đồ Việt Nam trong kho quà.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn
-- (không ghi đè những gì admin đã sửa sau lần chạy đầu).

alter table public.gift_catalog add column if not exists kind text not null default 'STATIC';
alter table public.gift_catalog add column if not exists art_url text;
alter table public.gift_catalog add column if not exists context text;
alter table public.gift_catalog drop constraint if exists gift_catalog_kind_chk;
alter table public.gift_catalog add constraint gift_catalog_kind_chk check (kind in ('STATIC', 'ANIMATED'));
alter table public.gift_catalog drop constraint if exists gift_catalog_art_chk;
alter table public.gift_catalog add constraint gift_catalog_art_chk check (art_url is null or (art_url ~ '^https://' and char_length(art_url) <= 500));
alter table public.gift_catalog drop constraint if exists gift_catalog_context_chk;
alter table public.gift_catalog add constraint gift_catalog_context_chk check (context is null or context in ('KM5', 'KM10', 'HALF', 'FULL', 'ULTRA', 'PR'));

-- Chỉ lần chạy đầu: đánh dấu quà động có sẵn, đổi tên huy chương, phượng hoàng có biểu tượng riêng (không lẫn với đại bàng)
update public.gift_catalog set kind = 'ANIMATED'
 where code in ('fireworks', 'laurel', 'golden_shoes', 'rocket', 'rainbow', 'phoenix', 'crown')
   and not exists (select 1 from private.app_settings s where s.key = 'gift_v2_seeded');
update public.gift_catalog set name = 'Huy chương vàng'
 where code = 'medal' and name = 'Huy chương' and not exists (select 1 from private.app_settings s where s.key = 'gift_v2_seeded');
update public.gift_catalog set emoji = '🐦‍🔥'
 where code = 'phoenix' and emoji = '🦅' and not exists (select 1 from private.app_settings s where s.key = 'gift_v2_seeded');
insert into private.app_settings (key, value) values ('gift_v2_seeded', 'true') on conflict (key) do nothing;

insert into public.gift_catalog (code, name, emoji, price_xu, tier, description, kind, context, season_from, season_to, is_active, sort) values
  -- Quà tĩnh
  ('heart',          'Trái tim',              '❤️', 2,     'CHEER',  'Thương lắm, cố lên!',                        'STATIC',   null,    null, null, true, 100),
  ('sun',            'Mặt trời',              '☀️', 3,     'CHEER',  'Chào buổi chạy sáng',                        'STATIC',   null,    null, null, true, 101),
  ('confetti',       'Pháo giấy',             '🎊', 5,     'CHEER',  'Chúc mừng nho nhỏ',                          'STATIC',   null,    null, null, true, 102),
  ('fist',           'Nắm đấm quyết tâm',     '👊', 5,     'CHEER',  'Không bỏ cuộc!',                             'STATIC',   null,    null, null, true, 103),
  ('handshake',      'Bắt tay',               '🤝', 5,     'CHEER',  'Rất vui được chạy cùng',                     'STATIC',   null,    null, null, true, 104),
  ('cheer_flag',     'Cờ cổ vũ',              '🚩', 10,    'CHEER',  'Phất cờ bên đường chạy',                     'STATIC',   null,    null, null, true, 105),
  ('coconut',        'Nước dừa',              '🥥', 15,    'CHEER',  'Mát lành sau buổi chạy nắng',                'STATIC',   null,    null, null, true, 106),
  ('cold_towel',     'Khăn lạnh',             '🧊', 15,    'CHEER',  'Hạ nhiệt giữa trưa hè',                      'STATIC',   null,    null, null, true, 107),
  ('choco_milk',     'Sữa chocolate phục hồi','🥛', 20,    'CHEER',  'Bữa phục hồi kinh điển của runner',          'STATIC',   null,    null, null, true, 108),
  ('caffeine_gel',   'Gel caffeine',          '⚡', 25,    'CHEER',  'Tỉnh táo cho những km cuối',                 'STATIC',   null,    null, null, true, 109),
  ('pho',            'Bát phở hồi sức',       '🍜', 30,    'BOOST',  'Phở nóng sau long run',                      'STATIC',   null,    null, null, true, 110),
  ('foam_roller',    'Con lăn massage',       '🪵', 30,    'BOOST',  'Lăn cơ, thả lỏng bắp chân',                  'STATIC',   null,    null, null, true, 111),
  ('bronze_medal',   'Huy chương đồng',       '🥉', 30,    'BOOST',  'Một buổi chạy đáng khen',                    'STATIC',   null,    null, null, true, 112),
  ('thanks_pacer',   'Cảm ơn pacer',          '🎈', 30,    'BOOST',  'Cảm ơn người giữ nhịp cho cả nhóm',          'STATIC',   null,    null, null, true, 113),
  ('congrats_5k',    'Chúc mừng 5K',          '🎽', 30,    'BOOST',  'Chỉ tặng trên bài chạy từ 5 km',             'STATIC',   'KM5',   null, null, true, 114),
  ('foot_massage',   'Massage chân',          '💆', 50,    'BOOST',  'Đôi chân xứng đáng được nghỉ ngơi',          'STATIC',   null,    null, null, true, 115),
  ('silver_medal',   'Huy chương bạc',        '🥈', 50,    'BOOST',  'Chạy đẹp lắm!',                              'STATIC',   null,    null, null, true, 116),
  ('conical_hat',    'Nón lá runner',         '👒', 50,    'BOOST',  'Chất Việt trên mọi cung đường',              'STATIC',   null,    null, null, true, 117),
  ('thanks_crew',    'Tri ân hậu cần',        '🙌', 50,    'BOOST',  'Cảm ơn đội nước, đội y tế, đội hậu cần',     'STATIC',   null,    null, null, true, 118),
  ('team_star',      'Ngôi sao đồng đội',     '⭐', 50,    'BOOST',  'Đồng đội tuyệt vời nhất',                    'STATIC',   null,    null, null, true, 119),
  ('peach_blossom',  'Hoa đào',               '🌸', 50,    'BOOST',  'Quà Tết — xuân chạy khỏe',                   'STATIC',   null,    '2000-01-15', '2000-02-28', true, 120),
  ('apricot_blossom','Hoa mai',               '🌼', 50,    'BOOST',  'Quà Tết — năm mới rực rỡ',                   'STATIC',   null,    '2000-01-15', '2000-02-28', true, 121),
  ('congrats_10k',   'Chúc mừng 10K',         '🏃', 50,    'BOOST',  'Chỉ tặng trên bài chạy từ 10 km',            'STATIC',   'KM10',  null, null, true, 122),
  ('marathon_kit',   'Bộ hồi phục marathon',  '🎁', 100,   'BOOST',  'Đủ đồ phục hồi sau 42 km',                   'STATIC',   null,    null, null, true, 123),
  ('pr_flag',        'Cờ PR',                 '🏁', 100,   'BOOST',  'Chỉ tặng trên bài lập kỷ lục cá nhân',       'STATIC',   'PR',    null, null, true, 124),
  ('lotus',          'Hoa sen vàng',          '🪷', 100,   'BOOST',  'Thanh cao, bền bỉ',                          'STATIC',   null,    null, null, true, 125),
  ('pathfinder',     'Người dẫn đường',       '🧭', 100,   'BOOST',  'Cảm ơn người mở đường cho cả nhóm',          'STATIC',   null,    null, null, true, 126),
  ('congrats_half',  'Chúc mừng Half',        '🎗️', 100,   'BOOST',  'Chỉ tặng trên bài chạy từ 21 km',            'STATIC',   'HALF',  null, null, true, 127),
  -- Quà hiệu ứng động
  ('shooting_star',  'Sao băng',              '🌠', 100,   'HYPE',   'Một vệt sáng cho buổi chạy đẹp',             'ANIMATED', null,    null, null, true, 200),
  ('torch',          'Ngọn đuốc bền bỉ',      '🔥', 150,   'HYPE',   'Giữ lửa ngày qua ngày',                      'ANIMATED', null,    null, null, true, 201),
  ('thunder',        'Sấm sét',               '🌩️', 200,   'HYPE',   'Tốc độ như sấm',                             'ANIMATED', null,    null, null, true, 202),
  ('club_shield',    'Khiên CLB',             '🛡️', 200,   'HYPE',   'Niềm tự hào của CLB',                        'ANIMATED', null,    null, null, true, 203),
  ('fire_leader',    'Thủ lĩnh truyền lửa',   '📣', 200,   'HYPE',   'Người thắp lửa cho cả đội',                  'ANIMATED', null,    null, null, true, 204),
  ('nye_fireworks',  'Pháo hoa giao thừa',    '🎇', 200,   'HYPE',   'Quà Tết — đón năm mới',                      'ANIMATED', null,    '2000-01-15', '2000-02-28', true, 205),
  ('congrats_full',  'Chúc mừng Full',        '🎖️', 200,   'HYPE',   'Chỉ tặng trên bài chạy từ 42 km',            'ANIMATED', 'FULL',  null, null, true, 206),
  ('festival_drum',  'Trống hội',             '🥁', 300,   'HYPE',   'Rộn ràng ngày hội chạy',                     'ANIMATED', null,    null, null, true, 207),
  ('club_banner',    'Cờ vinh danh CLB',      '🎌', 300,   'HYPE',   'Vinh danh CLB trên đường đua',               'ANIMATED', null,    null, null, true, 208),
  ('congrats_ultra', 'Chúc mừng Ultra',       '⛰️', 300,   'HYPE',   'Chỉ tặng trên bài chạy từ 45 km',            'ANIMATED', 'ULTRA', null, null, true, 209),
  ('light_gate',     'Cổng ánh sáng',         '✨', 500,   'HYPE',   'Cổng về đích rực sáng',                      'ANIMATED', null,    null, null, true, 210),
  ('star_rain',      'Mưa sao',               '💫', 500,   'HYPE',   'Cả bầu trời chúc mừng',                      'ANIMATED', null,    null, null, true, 211),
  ('bronze_drum',    'Trống đồng',            '🪘', 500,   'HYPE',   'Hồn Việt ngân vang',                         'ANIMATED', null,    null, null, true, 212),
  ('team_cup',       'Cúp đồng đội',          '🏵️', 500,   'HYPE',   'Chiến thắng của cả đội',                     'ANIMATED', null,    null, null, true, 213),
  ('speed_eagle',    'Đại bàng tốc độ',       '🦅', 1000,  'LEGEND', 'Sải cánh trên mọi cung đường',               'ANIMATED', null,    null, null, true, 214),
  ('thang_long_dragon','Rồng Thăng Long',     '🐉', 2000,  'LEGEND', 'Rồng bay — khí thế ngút trời',               'ANIMATED', null,    null, null, true, 215),
  ('supernova',      'Siêu tân tinh',         '💥', 10000, 'LEGEND', 'Chỉ mở bán vào dịp đặc biệt',                'ANIMATED', null,    null, null, false, 216)
on conflict (code) do nothing;

-- Bài chạy có đạt mốc của quà không (quà không gắn mốc → luôn được)
create or replace function private.gift_context_ok(p_activity_id uuid, p_context text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  a public.activities := (select x from public.activities x where x.id = p_activity_id);
  v_km numeric;
begin
  if p_context is null then return true; end if;
  if a.id is null or a.validation_status is distinct from 'APPROVED' or not public.activity_is_countable(a.status, a.validation_status) then
    return false;
  end if;
  v_km := greatest(coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0), 0) / 1000.0;
  if p_context = 'KM5' then return v_km >= 5; end if;
  if p_context = 'KM10' then return v_km >= 10; end if;
  if p_context = 'HALF' then return v_km >= 21; end if;
  if p_context = 'FULL' then return v_km >= 42; end if;
  if p_context = 'ULTRA' then return v_km >= 45; end if;
  if p_context <> 'PR' or v_km < 1 then return false; end if;
  -- Kỷ lục cá nhân: phải có bài hợp lệ trước đó để so; dài nhất từ trước tới nay, hoặc pace nhanh nhất ở bài ≥ 5 km
  if not exists (select 1 from public.activities b where b.user_id = a.user_id and b.id <> a.id and b.started_at < a.started_at
                   and b.validation_status = 'APPROVED' and public.activity_is_countable(b.status, b.validation_status)) then
    return false;
  end if;
  return not exists (select 1 from public.activities b where b.user_id = a.user_id and b.id <> a.id and b.started_at < a.started_at
                       and b.validation_status = 'APPROVED' and public.activity_is_countable(b.status, b.validation_status)
                       and greatest(coalesce(nullif(b.moving_distance_m, 0), b.distance_m, 0), 0) >= v_km * 1000)
      or (v_km >= 5 and coalesce(a.avg_pace_s, 0) > 0
          and not exists (select 1 from public.activities b where b.user_id = a.user_id and b.id <> a.id and b.started_at < a.started_at
                            and b.validation_status = 'APPROVED' and public.activity_is_countable(b.status, b.validation_status)
                            and greatest(coalesce(nullif(b.moving_distance_m, 0), b.distance_m, 0), 0) >= 5000
                            and coalesce(b.avg_pace_s, 0) > 0 and b.avg_pace_s <= a.avg_pace_s));
end $$;

create or replace function private.gift_json(g public.gift_catalog) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('code', g.code, 'name', g.name, 'emoji', g.emoji, 'price_xu', g.price_xu,
    'tier', g.tier, 'kind', g.kind, 'art_url', g.art_url, 'context', g.context, 'description', g.description, 'vip_tier', g.vip_tier,
    'seasonal', g.season_from is not null, 'locked', g.vip_tier > private.user_vip_tier(auth.uid()),
    'offer', private.item_offer(auth.uid(), 'GIFT', g.code, g.price_xu, 1))
$$;

-- Bảng quà cho một bài chạy / bài đăng: quà theo mốc chỉ hiện khi bài đạt mốc
create or replace function public.gift_catalog_for(p_post_id uuid default null, p_activity_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_act uuid := coalesce(p_activity_id, (select cp.activity_id from public.club_posts cp where cp.id = p_post_id and cp.deleted_at is null));
begin
  perform private.require_uid();
  return jsonb_build_object(
    'gifts', (select coalesce(jsonb_agg(private.gift_json(g) order by g.price_xu, g.sort), '[]'::jsonb)
                from public.gift_catalog g
               where g.is_active and private.gift_in_season(g, private.vn_day(now()))
                 and (g.context is null or (v_act is not null and private.gift_context_ok(v_act, g.context)))),
    'daily_cap', coalesce((private.economy_config()->>'giftDailyCapXu')::int, 20000),
    'sent_today', coalesce((select sum(c.amount) from public.cheers c where c.from_user = auth.uid() and c.gift_code is not null
                             and c.created_at >= private.vn_start(private.vn_day(now()))), 0));
end $$;

-- Bảng quà chung (bản app cũ): không kèm quà theo mốc
create or replace function public.gift_catalog() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'gifts', (select coalesce(jsonb_agg(private.gift_json(g) order by g.sort, g.price_xu), '[]'::jsonb)
              from public.gift_catalog g where g.is_active and g.context is null and private.gift_in_season(g, private.vn_day(now()))),
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
  v_list integer;
  v_msg text := nullif(trim(coalesce(p_message, '')), '');
  v_club uuid;
  v_author uuid;
  v_act uuid;
  v_id uuid := (select c.id from public.cheers c where c.idempotency_key = p_idempotency_key);
  v_sent numeric;
  v_name text;
  o jsonb;
  v_promo uuid;
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
  -- Quà theo mốc: chỉ tặng trên bài chạy của người nhận đạt đúng mốc
  if g.context is not null then
    v_act := coalesce(p_activity_id, (select cp.activity_id from public.club_posts cp where cp.id = p_post_id));
    if v_act is null or not exists (select 1 from public.activities where id = v_act and user_id = p_to_user)
       or not private.gift_context_ok(v_act, g.context) then
      raise exception 'GIFT_CONTEXT_REQUIRED';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('gift:' || v_uid, 0));
  v_list := g.price_xu * v_qty;
  o := private.item_offer(v_uid, 'GIFT', g.code, g.price_xu, v_qty);
  if o is not null and (o->>'eligible')::boolean and o->>'kind' <> 'TRIAL'
     and (o->>'left' is null or (o->>'left')::int >= v_qty) then
    v_total := (o->>'price')::int * v_qty;
    v_promo := (o->>'promo_id')::uuid;
  else
    v_total := v_list;
  end if;
  v_sent := coalesce((select sum(c.amount) from public.cheers c where c.from_user = v_uid and c.gift_code is not null
                       and c.created_at >= private.vn_start(private.vn_day(now()))), 0);
  if v_sent + v_total > coalesce((private.economy_config()->>'giftDailyCapXu')::int, 20000) then raise exception 'GIFT_DAILY_LIMIT'; end if;
  if private.balance(v_uid) < v_total then raise exception 'INSUFFICIENT_BALANCE'; end if;

  -- Đốt Xu: người tặng → hệ thống. Người nhận KHÔNG nhận Xu.
  if v_total > 0 then
    perform private.ledger_post('GIFT', 'gift:' || p_idempotency_key, 'Tặng ' || v_qty || ' × ' || g.name || ' cho ' || private.display_name(p_to_user), v_uid,
      private.debit_entries(v_uid, v_total, private.system_account()));
  end if;
  v_id := gen_random_uuid();
  insert into public.cheers (id, from_user, to_user, amount, list_amount, promo_id, message, activity_id, post_id, club_id, idempotency_key, gift_code, qty)
  values (v_id, v_uid, p_to_user, v_total, v_list, v_promo, v_msg, p_activity_id, p_post_id, v_club, p_idempotency_key, g.code, v_qty);
  if v_promo is not null then
    insert into public.item_promo_redemptions (promo_id, user_id, qty, xu_paid, ref) values (v_promo, v_uid, v_qty, v_total, 'gift:' || p_idempotency_key);
  end if;
  if p_post_id is not null then update public.club_posts set cheer_xu = cheer_xu + v_total where id = p_post_id; end if;

  v_name := private.display_name(v_uid);
  perform private.award(p_to_user, 'GIFT_IN', v_name || ' tặng bạn ' || case when v_qty > 1 then v_qty || ' × ' else '' end || g.emoji || ' ' || g.name,
    v_msg, 0, 0, 'gift_in:' || v_id, p_activity_id, jsonb_build_object('from', v_uid, 'gift', g.code, 'emoji', g.emoji, 'qty', v_qty, 'tier', g.tier,
      'kind', g.kind, 'art_url', g.art_url));
  perform private.notify(p_to_user, v_club, 'GIFT', v_name || ' tặng bạn ' || case when v_qty > 1 then v_qty || ' × ' else '' end || g.emoji || ' ' || g.name,
    coalesce(v_msg, g.description), case when p_activity_id is not null then '/activities/' || p_activity_id
                                         when v_club is not null then '/clubs/' || v_club else '/me' end, v_uid, g.kind = 'ANIMATED');
  return jsonb_build_object('gift_id', v_id, 'total_xu', v_total, 'list_xu', v_list, 'emoji', g.emoji, 'tier', g.tier, 'kind', g.kind,
    'art_url', g.art_url, 'price_xu', g.price_xu, 'qty', v_qty, 'balance', private.balance(v_uid));
end $$;

-- Admin: thêm loại quà, ảnh riêng, mốc
create or replace function public.admin_save_gift(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_admin();
begin
  insert into public.gift_catalog (code, name, emoji, price_xu, tier, description, vip_tier, season_from, season_to, is_active, sort, kind, art_url, context)
  values (lower(trim(p->>'code')), trim(p->>'name'), trim(p->>'emoji'), (p->>'price_xu')::int, upper(p->>'tier'), nullif(trim(coalesce(p->>'description', '')), ''),
          coalesce((p->>'vip_tier')::int, 0), nullif(p->>'season_from', '')::date, nullif(p->>'season_to', '')::date,
          coalesce((p->>'is_active')::boolean, true), coalesce((p->>'sort')::int, 0),
          coalesce(nullif(upper(p->>'kind'), ''), 'STATIC'), nullif(trim(coalesce(p->>'art_url', '')), ''), nullif(upper(coalesce(p->>'context', '')), ''))
  on conflict (code) do update set name = excluded.name, emoji = excluded.emoji, price_xu = excluded.price_xu, tier = excluded.tier,
    description = excluded.description, vip_tier = excluded.vip_tier, season_from = excluded.season_from, season_to = excluded.season_to,
    is_active = excluded.is_active, sort = excluded.sort, kind = excluded.kind, art_url = excluded.art_url, context = excluded.context;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SAVE_GIFT', p->>'code', p);
end $$;

revoke all on function private.gift_context_ok(uuid, text), private.gift_json(public.gift_catalog) from public, anon, authenticated;
revoke all on function public.gift_catalog_for(uuid, uuid) from public, anon;
grant execute on function public.gift_catalog_for(uuid, uuid), public.gift_catalog(), public.send_gift(uuid, text, integer, text, uuid, uuid, text) to authenticated;
grant execute on function public.admin_save_gift(jsonb) to authenticated;
