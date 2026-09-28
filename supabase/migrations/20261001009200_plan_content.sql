-- 009200: NỘI DUNG GÓI MIỄN PHÍ do admin soạn + số quản trị viên CLB miễn phí do admin đặt.
-- Trước đây trang /goi đọc giá, quyền lợi, lượt tạo của VIP / CLB Pro từ Quản trị → Gói & giá, nhưng thẻ "Miễn phí",
-- "CLB Miễn phí" và "RaceHub Doanh nghiệp" viết cứng trong code, số quản trị viên CLB miễn phí (2) viết cứng trong SQL.
--   • ops_policy.content.plans = { free, clubFree, org }: mỗi thẻ có tiêu đề, mô tả, các dòng quyền lợi, ghi chú.
--     Dòng quyền lợi dùng được biến {freeSlots}, {clubMaxMembers}, {clubMaxOpen}, {clubMaxSlots}, {clubMinActive}, {activeDays},
--     {clubCaptains}, {proMaxOpen}, {proMaxSlots} — app thay bằng số đang áp dụng, nên đổi hạn mức ở Kinh tế là thẻ tự đổi theo.
--     Lưu = một phiên bản của chính sách vận hành (lịch sử, khôi phục, nhật ký quản trị như 009100).
--   • economy clubChallenge.freeMaxCaptains (mặc định 2): trigger giới hạn quản trị viên, club_plan() và plan_compare() đọc số này.
--   • plan_compare() trả thêm 'content' (nội dung các thẻ gói) để trang /goi đọc một lần.
-- Cần 008500, 009100. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

-- ---------------------------------------------------------------------
-- 1. Số quản trị viên CLB miễn phí: vào chính sách kinh tế
-- ---------------------------------------------------------------------
create or replace function private.club_challenge_policy() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('freeMinActiveMembers', 5, 'activeWindowDays', 30, 'freeMaxSlots', 50, 'freeMaxOpen', 2,
                            'proMaxSlots', 1000, 'proMaxOpen', 20, 'freeMaxMembers', 50, 'freeMaxCaptains', 2)
         || coalesce(case when jsonb_typeof(private.economy_config()->'clubChallenge') = 'object'
                          then private.economy_config()->'clubChallenge' end, '{}'::jsonb)
$$;

create or replace function private.club_free_captains() returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((private.club_challenge_policy()->>'freeMaxCaptains')::int, 2)
$$;

create or replace function private.valid_economy_v2(c jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(c) = 'object'
     and coalesce((c->>'xuVnd')::numeric, 100) between 1 and 1000000
     and coalesce((c->>'xpPerKm')::numeric, 10) between 0 and 1000
     and coalesce((c->'run'->>'freeKm')::numeric, 2) between 0 and 100
     and coalesce((c->'run'->>'dailyCap')::numeric, 20) between 0 and 100000
     and not exists (select 1 from jsonb_array_elements(coalesce(c->'run'->'tiers', '[]'::jsonb)) e
                      where (e->>'upToKm')::numeric not between 0 and 1000 or (e->>'rate')::numeric not between 0 and 1000)
     and coalesce((c->>'checkinXu')::numeric, 1) between 0 and 10000
     and coalesce((c->>'giftDailyCapXu')::numeric, 20000) between 0 and 100000000
     and not exists (select 1 from jsonb_array_elements(coalesce(c->'capacityTiers', '[]'::jsonb)) e
                      where (e->>'max')::int not between 1 and 1000000 or (e->>'xu')::numeric not between 0 and 10000000)
     and not exists (select 1 from jsonb_array_elements(coalesce(c->'streakRewards', '[]'::jsonb)) e
                      where (e->>'weeks')::int not between 1 and 520 or (e->>'xu')::numeric not between 0 and 100000)
     and coalesce((c->'referral'->>'inviterXu')::numeric, 0) between 0 and 100000
     and coalesce((c->'referral'->>'refereeXu')::numeric, 0) between 0 and 100000
     and coalesce((c->'referral'->>'monthlyCap')::numeric, 10) between 0 and 1000
     and coalesce((c->'comeback'->>'xu')::numeric, 10) between 0 and 10000
     and coalesce((c->'comeback'->>'minRestDays')::numeric, 28) between 7 and 365
     and coalesce((c->'comeback'->>'cooldownDays')::numeric, 90) between 0 and 3650
     and coalesce((c->'game'->>'shieldPrice')::numeric, 200) between 0 and 100000
     and coalesce((c->'clubChallenge'->>'freeMinActiveMembers')::numeric, 5) between 0 and 10000
     and coalesce((c->'clubChallenge'->>'activeWindowDays')::numeric, 30) between 1 and 365
     and coalesce((c->'clubChallenge'->>'freeMaxSlots')::numeric, 50) between 0 and 10000
     and coalesce((c->'clubChallenge'->>'freeMaxOpen')::numeric, 2) between 0 and 10000
     and coalesce((c->'clubChallenge'->>'proMaxSlots')::numeric, 1000) between 0 and 10000
     and coalesce((c->'clubChallenge'->>'proMaxOpen')::numeric, 20) between 0 and 10000
     and coalesce((c->'clubChallenge'->>'freeMaxMembers')::numeric, 50) between 0 and 1000000
     and coalesce((c->'clubChallenge'->>'freeMaxCaptains')::numeric, 2) between 0 and 100
$$;

-- Như 002800, số 2 thay bằng số admin đặt. Chỉ chặn khi THÊM mới, không hạ cấp người đang giữ.
create or replace function private.club_captain_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'CAPTAIN' and new.status = 'APPROVED'
     and (tg_op = 'INSERT' or (old.role is distinct from 'CAPTAIN' and old.role is distinct from 'OWNER') or old.status is distinct from 'APPROVED')   -- chủ nhiệm cũ khi trao quyền: không tính
     and not private.club_is_pro(new.club_id)
     and (select count(*) from public.club_members m
           where m.club_id = new.club_id and m.role = 'CAPTAIN' and m.status = 'APPROVED' and m.user_id <> new.user_id) >= private.club_free_captains() then
    raise exception 'CAPTAIN_LIMIT';
  end if;
  return new;
end $$;

create or replace function public.club_plan(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.clubs := (select x from public.clubs x where x.id = p_club_id);
begin
  if c.id is null or not public.club_is_member(c.id) then raise exception 'NOT_A_MEMBER'; end if;
  return jsonb_build_object(
    'plan', c.plan, 'active', private.club_is_pro(c.id), 'pro_until', c.pro_until,
    'slug', case when public.club_is_staff(c.id) or private.club_is_pro(c.id) then c.slug end,
    'captains', (select count(*) from public.club_members m where m.club_id = c.id and m.role = 'CAPTAIN' and m.status = 'APPROVED'),
    'captain_limit', case when private.club_is_pro(c.id) then null else private.club_free_captains() end);
end $$;

-- ---------------------------------------------------------------------
-- 2. Nội dung các thẻ gói trong chính sách vận hành
-- ---------------------------------------------------------------------
create or replace function private.plan_content_defaults() returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'free', jsonb_build_object('title', 'Miễn phí', 'subtitle', '',
      'perks', jsonb_build_array(
        'Ghi bài bằng GPS trong app hoặc tự động từ Strava',
        'Xu, XP, cấp độ, huy hiệu, nhiệm vụ, nhân vật',
        'Tham gia thử thách, CLB, giải chạy ảo, tổ chức không giới hạn',
        'Tạo miễn phí thử thách cá nhân và thử thách nhóm tới {freeSlots} người',
        'Thử thách đông hơn {freeSlots} người: trả Xu theo quy mô'),
      'note', 'VIP không tăng km, XP hay thứ hạng — mọi runner thi đấu công bằng.'),
    'clubFree', jsonb_build_object('title', 'CLB Miễn phí', 'subtitle', '',
      'perks', jsonb_build_array(
        'Tối đa {clubMaxMembers} thành viên',
        '{clubMaxOpen} thử thách nội bộ miễn phí cùng lúc, mỗi thử thách ≤ {clubMaxSlots} người (cần ≥ {clubMinActive} thành viên có bài chạy trong {activeDays} ngày)',
        'Tối đa {clubCaptains} quản trị viên',
        'Bảng tin, chat, lịch, điểm danh QR, quỹ VietQR, bảng xếp hạng',
        'Ngày hội ×2/×3, đại sảnh danh vọng, cửa hàng CLB, giao lưu CLB'),
      'note', 'CLB miễn phí vượt số thành viên vẫn giữ đủ người, chỉ chưa duyệt thêm người mới cho tới khi nâng Pro.'),
    'org', jsonb_build_object('title', 'RaceHub Doanh nghiệp', 'subtitle', 'Báo giá riêng theo số người và thời hạn',
      'perks', jsonb_build_array(
        'Chiến dịch sức khoẻ cho cả tổ chức (km, số buổi, số ngày chạy)',
        'Bảng xếp hạng phòng ban / chi nhánh / CLB — tổng và bình quân đầu người',
        'Nhập danh sách nhân viên từ Excel, tự duyệt email công ty, đơn vị nhiều cấp',
        'Báo cáo theo mã nhân viên, xuất Excel',
        'Chốt kết quả, chứng nhận hoàn thành, quay thưởng minh bạch',
        'Quản lý nhiều CLB, tài trợ CLB Pro cho cả hệ thống'),
      'note', ''))
$$;

/** Một thẻ gói hợp lệ: tiêu đề 2–60, mô tả ≤ 200, ghi chú ≤ 300, 1–15 dòng quyền lợi mỗi dòng 2–200 ký tự */
create or replace function private.valid_plan_card(c jsonb) returns boolean
language sql immutable as $$
  select case when jsonb_typeof(c) = 'object' and jsonb_typeof(c->'title') = 'string' and jsonb_typeof(c->'perks') = 'array'
              then char_length(c->>'title') between 2 and 60
               and char_length(coalesce(c->>'subtitle', '')) <= 200
               and char_length(coalesce(c->>'note', '')) <= 300
               and jsonb_array_length(c->'perks') between 1 and 15
               and not exists (select 1 from jsonb_array_elements(c->'perks') e
                                where jsonb_typeof(e) <> 'string' or char_length(e #>> '{}') not between 2 and 200)
              else false end
$$;

create or replace function private.valid_plan_content(p jsonb) returns boolean
language sql immutable as $$
  select case when jsonb_typeof(p) = 'object'
              then private.valid_plan_card(p->'free') and private.valid_plan_card(p->'clubFree') and private.valid_plan_card(p->'org')
              else false end
$$;

/** Chỉ giữ các khoá đã biết của một thẻ */
create or replace function private.clean_plan_card(c jsonb) returns jsonb
language sql immutable as $$
  select jsonb_build_object('title', c->'title', 'subtitle', coalesce(c->'subtitle', '""'::jsonb),
                            'perks', c->'perks', 'note', coalesce(c->'note', '""'::jsonb))
$$;

create or replace function private.ops_defaults() returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'features', jsonb_build_object('nearby', true, 'market', true, 'bibMarket', true, 'knowledge', true, 'races', true, 'cups', true, 'orgs', true),
    'tracking', jsonb_build_object('autoPauseAfterS', 10, 'longStopAskMin', 10, 'longStopAutoStopMin', 30, 'trimTailMin', 2),
    'antiCheat', jsonb_build_object('dailyRunLimit', 20, 'minPaceMin', 3, 'vehicleKmh', 25, 'vehicleS', 30, 'severeKmh', 20, 'severeS', 120,
                                    'highKmh', 17, 'highS', 180, 'spikeKmh', 43, 'spikeMax', 3),
    'content', jsonb_build_object('enterprise', jsonb_build_object(
      'title', 'Phong trào chạy bộ cho cả tổ chức',
      'subtitle', 'Chiến dịch, bảng xếp hạng phòng ban, quản lý nhiều CLB và báo cáo cho nhân sự — tự động từ Strava và GPS, không cần bảng tính.',
      'features', jsonb_build_array(
        jsonb_build_object('title', 'Chiến dịch sức khoẻ', 'text', 'Tạo chiến dịch theo tổng km, số buổi hoặc số ngày chạy; mục tiêu chung cả tổ chức và mục tiêu mỗi người.'),
        jsonb_build_object('title', 'Xếp hạng theo đơn vị', 'text', 'Phòng ban, chi nhánh, lớp hoặc CLB thi đua với nhau — tính cả tổng và bình quân đầu người cho công bằng.'),
        jsonb_build_object('title', 'Quản lý nhiều CLB', 'text', 'Liên đoàn mời CLB tham gia; thành viên CLB tự được tính vào chiến dịch. Có thể tài trợ CLB Pro cho cả hệ thống.'),
        jsonb_build_object('title', 'Báo cáo cho nhân sự', 'text', 'km, số buổi, số ngày chạy của từng người theo khoảng ngày; mã nhân viên, đơn vị; xuất Excel.'),
        jsonb_build_object('title', 'Thương hiệu riêng', 'text', 'Logo, ảnh bìa, màu chủ đề, khẩu hiệu; bảng tin nội bộ như một CLB lớn; chứng nhận hoàn thành thiết kế theo mẫu công ty.'),
        jsonb_build_object('title', 'Quản lý như phòng nhân sự', 'text', 'Tự duyệt theo email công ty, nhập danh sách từ Excel, đơn vị nhiều cấp, trưởng đơn vị tự quản lý người của mình.'),
        jsonb_build_object('title', 'Trao giải minh bạch', 'text', 'Chốt kết quả, duyệt top trước khi trao, ngày hội ×2 / ×3, quay thưởng may mắn có mã kiểm chứng.'),
        jsonb_build_object('title', 'Chống gian lận, tôn trọng riêng tư', 'text', 'Chỉ tính bài chạy hợp lệ (GPS, pace, duyệt); người chạy tắt chia sẻ bài nào thì bài đó không vào bảng.'))),
      'plans', private.plan_content_defaults()))
$$;

create or replace function private.valid_ops(c jsonb) returns boolean
language sql immutable as $$
  select private.ops_num_ok(c, 'tracking', 'autoPauseAfterS', 5, 60)
     and private.ops_num_ok(c, 'tracking', 'longStopAskMin', 3, 60)
     and private.ops_num_ok(c, 'tracking', 'longStopAutoStopMin', 10, 240)
     and private.ops_num_ok(c, 'tracking', 'trimTailMin', 1, 30)
     and (c->'tracking'->>'longStopAutoStopMin')::numeric > (c->'tracking'->>'longStopAskMin')::numeric
     and private.ops_num_ok(c, 'antiCheat', 'dailyRunLimit', 3, 100)
     and private.ops_num_ok(c, 'antiCheat', 'minPaceMin', 2, 5)
     and private.ops_num_ok(c, 'antiCheat', 'vehicleKmh', 20, 60)
     and private.ops_num_ok(c, 'antiCheat', 'vehicleS', 10, 600)
     and private.ops_num_ok(c, 'antiCheat', 'severeKmh', 15, 40)
     and private.ops_num_ok(c, 'antiCheat', 'severeS', 30, 1800)
     and private.ops_num_ok(c, 'antiCheat', 'highKmh', 12, 35)
     and private.ops_num_ok(c, 'antiCheat', 'highS', 30, 3600)
     and private.ops_num_ok(c, 'antiCheat', 'spikeKmh', 30, 150)
     and private.ops_num_ok(c, 'antiCheat', 'spikeMax', 1, 100)
     and (c->'antiCheat'->>'highKmh')::numeric < (c->'antiCheat'->>'severeKmh')::numeric
     and (c->'antiCheat'->>'severeKmh')::numeric < (c->'antiCheat'->>'vehicleKmh')::numeric
     and not exists (select 1 from jsonb_each(c->'features') f where jsonb_typeof(f.value) <> 'boolean')
     and jsonb_typeof(c->'content'->'enterprise') = 'object'
     and char_length(coalesce(c->'content'->'enterprise'->>'title', '')) between 3 and 90
     and char_length(coalesce(c->'content'->'enterprise'->>'subtitle', '')) <= 400
     and jsonb_typeof(c->'content'->'enterprise'->'features') = 'array'
     and jsonb_array_length(c->'content'->'enterprise'->'features') between 1 and 12
     and not exists (select 1 from jsonb_array_elements(c->'content'->'enterprise'->'features') f
                      where char_length(coalesce(f->>'title', '')) not between 2 and 60 or char_length(coalesce(f->>'text', '')) > 300)
     and private.valid_plan_content(c->'content'->'plans')
$$;

-- Như 009100, thêm content.plans: gửi một phần (vd. chỉ thẻ "Miễn phí") thì các thẻ còn lại giữ nguyên bản đang dùng
create or replace function public.admin_publish_ops_policy(p jsonb, p_note text default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  d jsonb := private.ops_defaults();
  v_old jsonb := private.ops_config();
  v_plans jsonb;
  v_new jsonb;
  v_next integer;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'INVALID_CONFIG'; end if;
  v_plans := coalesce(v_old->'content'->'plans', '{}'::jsonb)
             || case when jsonb_typeof(p->'content'->'plans') = 'object' then p->'content'->'plans' else '{}'::jsonb end;
  -- Chỉ nhận các nhóm / khoá đã biết (khoá lạ bị bỏ): gộp lên bản mặc định
  v_new := jsonb_build_object(
    'features', (select coalesce(jsonb_object_agg(k.key, coalesce(p->'features'->k.key, v_old->'features'->k.key)), '{}'::jsonb) from jsonb_each(d->'features') k),
    'tracking', (select coalesce(jsonb_object_agg(k.key, coalesce(p->'tracking'->k.key, v_old->'tracking'->k.key)), '{}'::jsonb) from jsonb_each(d->'tracking') k),
    'antiCheat', (select coalesce(jsonb_object_agg(k.key, coalesce(p->'antiCheat'->k.key, v_old->'antiCheat'->k.key)), '{}'::jsonb) from jsonb_each(d->'antiCheat') k),
    'content', jsonb_build_object(
      'enterprise', coalesce(p->'content'->'enterprise', v_old->'content'->'enterprise'),
      'plans', jsonb_build_object('free', private.clean_plan_card(v_plans->'free'), 'clubFree', private.clean_plan_card(v_plans->'clubFree'),
                                  'org', private.clean_plan_card(v_plans->'org'))));
  if not private.valid_ops(v_new) then raise exception 'INVALID_CONFIG'; end if;
  perform pg_advisory_xact_lock(hashtext('config:ops_policy'));
  v_next := coalesce((select max(x.version) from public.system_config_versions x where x.config_key = 'ops_policy'), 0) + 1;
  update public.system_config_versions set status = 'ARCHIVED' where config_key = 'ops_policy' and status = 'PUBLISHED';
  insert into public.system_config_versions (config_key, version, status, config_value, created_by)
  values ('ops_policy', v_next, 'PUBLISHED', v_new, v_admin);
  insert into public.admin_audit_log (actor_id, action, target, old_value, new_value)
  values (v_admin, 'PUBLISH_CONFIG', 'ops_policy v' || v_next || coalesce(': ' || left(nullif(trim(p_note), ''), 160), ''), v_old - 'version', v_new);
  return v_next;
end $$;

-- ---------------------------------------------------------------------
-- 3. Bảng so sánh gói: số quản trị viên theo chính sách + nội dung thẻ gói
-- ---------------------------------------------------------------------
create or replace function public.plan_compare() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'plans', (select coalesce(jsonb_agg(jsonb_build_object(
                'code', p.code, 'name', p.name, 'owner_type', p.owner_type, 'tier', p.tier, 'description', p.description, 'perks', p.perks,
                'prices', (select coalesce(jsonb_agg(jsonb_build_object('months', pp.months, 'price_vnd', pp.price_vnd) order by pp.months), '[]'::jsonb)
                             from public.plan_prices pp where pp.plan_code = p.code and pp.active),
                'credits', (select coalesce(jsonb_agg(jsonb_build_object('capacity', pc.capacity, 'per_month', pc.per_month) order by pc.capacity), '[]'::jsonb)
                              from public.plan_credits pc where pc.plan_code = p.code))
              order by p.sort), '[]'::jsonb) from public.plans p where p.active),
    'club', private.club_challenge_policy(),
    'free_captains', private.club_free_captains(),
    'content', private.ops_config()->'content'->'plans')
$$;

revoke all on function private.club_free_captains(), private.plan_content_defaults(), private.valid_plan_card(jsonb),
  private.valid_plan_content(jsonb), private.clean_plan_card(jsonb) from public, anon, authenticated;
revoke all on function private.ops_defaults(), private.valid_ops(jsonb), private.valid_economy_v2(jsonb), private.club_challenge_policy(),
  private.club_captain_limit() from public, anon, authenticated;
revoke all on function public.admin_publish_ops_policy(jsonb, text), public.club_plan(uuid), public.plan_compare() from public, anon;
grant execute on function public.admin_publish_ops_policy(jsonb, text), public.club_plan(uuid) to authenticated;
grant execute on function public.plan_compare() to anon, authenticated;
