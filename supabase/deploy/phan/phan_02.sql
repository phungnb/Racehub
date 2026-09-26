-- RaceHub — PHẦN 02/11 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 004000, 004100, 004200, 004300, 004400, 004500
-- Supabase → SQL Editor → New query → dán TOÀN BỘ phần này → Run. Lỗi thì không có gì thay đổi; chạy lại vẫn an toàn.
-- Xong thì chạy phần tiếp theo.
begin;
-- ===================================================================
-- 20261001004000_vip_insights_metrics.sql
-- ===================================================================
-- 004000: Quyền lợi VIP thật (thay các dòng "sắp có") + chỉ số kinh tế cho admin.
-- • VIP1: my_trends() — xu hướng 12 tuần / 12 tháng (km, số buổi, thời gian, độ cao).
-- • VIP2: my_performance() — dữ liệu từng km để tính kỷ lục 1K → 42K và phân bố pace (tính ở máy khách);
--         my_challenge_templates() — thử thách mình đã tạo, dùng làm mẫu / nhân bản.
-- • VIP3: my_activity_export(from, to) — xuất toàn bộ bài chạy trong khoảng ngày (CSV / bản in PDF).
-- • Admin: admin_economy_metrics(months) — Xu phát ra / đốt / bán theo tháng, doanh thu, đơn hàng, lượt tạo, duyệt bài.
-- Kiểm tra quyền ở máy chủ: thiếu bậc VIP → VIP_REQUIRED (admin hệ thống luôn được xem).
-- Cần file 003900. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

create or replace function private.require_vip(p_tier integer) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  if not public.is_system_admin() and private.user_vip_tier(v_uid) < p_tier then raise exception 'VIP_REQUIRED'; end if;
  return v_uid;
end $$;

-- Bài được tính (đã duyệt, không xóa) của một người trong khoảng thời gian
create or replace function private.countable_runs(p_user uuid, p_from timestamptz, p_to timestamptz)
returns table (id uuid, started_at timestamptz, title text, source text, km numeric, moving_s integer, elapsed_s integer,
               elev_m numeric, avg_hr numeric, earned_xu numeric, earned_xp integer)
language sql stable security definer set search_path = public as $$
  select a.id, a.started_at, a.title, a.source,
         greatest(coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0), 0) / 1000.0,
         coalesce(a.moving_time_s, 0), coalesce(a.elapsed_time_s, 0), coalesce(a.elevation_gain_m, 0), a.avg_heartrate,
         coalesce(a.earned_xu, 0), coalesce(a.earned_xp, 0)
    from public.activities a
   where a.user_id = p_user and a.started_at >= p_from and a.started_at < p_to
     and public.activity_is_countable(a.status, a.validation_status) and a.validation_status = 'APPROVED'
$$;

-- ---------------------------------------------------------------------
-- VIP1: xu hướng tuần / tháng (giờ Việt Nam), đủ 12 kỳ kể cả kỳ không chạy
-- ---------------------------------------------------------------------
create or replace function public.my_trends() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_vip(1);
  v_today timestamp := (now() at time zone 'Asia/Ho_Chi_Minh');
  v_w0 timestamp := date_trunc('week', v_today) - interval '11 weeks';
  v_m0 timestamp := date_trunc('month', v_today) - interval '11 months';
begin
  return jsonb_build_object(
    'weeks', (select coalesce(jsonb_agg(jsonb_build_object('start', to_char(g.d, 'YYYY-MM-DD'), 'km', round(coalesce(s.km, 0), 2),
                'runs', coalesce(s.runs, 0), 'moving_s', coalesce(s.mv, 0), 'elev_m', round(coalesce(s.el, 0))) order by g.d), '[]'::jsonb)
                from generate_series(v_w0, date_trunc('week', v_today), interval '1 week') g(d)
                left join (select date_trunc('week', r.started_at at time zone 'Asia/Ho_Chi_Minh') as d, sum(r.km) as km, count(*) as runs,
                                  sum(r.moving_s) as mv, sum(r.elev_m) as el
                             from private.countable_runs(v_uid, v_w0 at time zone 'Asia/Ho_Chi_Minh', now() + interval '1 day') r group by 1) s on s.d = g.d),
    'months', (select coalesce(jsonb_agg(jsonb_build_object('start', to_char(g.d, 'YYYY-MM-DD'), 'km', round(coalesce(s.km, 0), 2),
                'runs', coalesce(s.runs, 0), 'moving_s', coalesce(s.mv, 0), 'elev_m', round(coalesce(s.el, 0))) order by g.d), '[]'::jsonb)
                from generate_series(v_m0, date_trunc('month', v_today), interval '1 month') g(d)
                left join (select date_trunc('month', r.started_at at time zone 'Asia/Ho_Chi_Minh') as d, sum(r.km) as km, count(*) as runs,
                                  sum(r.moving_s) as mv, sum(r.elev_m) as el
                             from private.countable_runs(v_uid, v_m0 at time zone 'Asia/Ho_Chi_Minh', now() + interval '1 day') r group by 1) s on s.d = g.d));
end $$;

-- ---------------------------------------------------------------------
-- VIP2: dữ liệu kỷ lục + pace — mỗi bài kèm thời gian từng km đủ (split ≥ 950 m), tối đa 1.000 bài gần nhất trong 3 năm
-- ---------------------------------------------------------------------
create or replace function public.my_performance() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_vip(2);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', t.id, 'started_at', t.started_at, 'title', t.title, 'km', round(t.km, 3), 'moving_s', t.moving_s,
            'splits', coalesce((select jsonb_agg((e->>'moving_s')::int order by ord)
                                  from public.activity_details d, jsonb_array_elements(d.splits) with ordinality as x(e, ord)
                                 where d.activity_id = t.id and coalesce((e->>'distance_m')::numeric, 0) >= 950
                                   and coalesce((e->>'moving_s')::numeric, 0) > 0), '[]'::jsonb))
            order by t.started_at desc), '[]'::jsonb)
            from (select r.*, row_number() over (order by r.started_at desc) as rn
                    from private.countable_runs(v_uid, now() - interval '3 years', now() + interval '1 day') r
                   where r.km >= 0.5 and r.moving_s > 0) t
           where t.rn <= 1000);
end $$;

-- VIP2: thử thách mình đã tạo (30 gần nhất) — đủ trường để dựng lại bản nháp trong trình tạo
create or replace function public.my_challenge_templates() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_vip(2);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', t.id, 'title', t.title, 'description', t.description, 'format', t.format, 'objective', t.objective,
            'game_mode', t.game_mode, 'target_value', t.target_value, 'min_km', t.min_km, 'min_pace', t.min_pace, 'max_pace', t.max_pace,
            'daily_cap_km', t.daily_cap_km, 'require_hr', t.require_hr, 'max_slots', t.max_slots, 'audience', t.target_audience,
            'club_id', t.target_club_id, 'team_size', t.fixed_team_size, 'reward_xu', t.reward_xu, 'reward_split', t.reward_split,
            'days', greatest(1, round(extract(epoch from (t.end_date - t.start_date)) / 86400)),
            'start_date', t.start_date, 'status', t.status,
            'pledge', jsonb_build_object('enabled', t.pledge_enabled, 'options', to_jsonb(coalesce(t.pledge_options, '{}'::numeric[])),
                                         'min_km', t.pledge_min_km, 'max_km', t.pledge_max_km, 'cap_pct', t.pledge_cap_pct, 'team_size', t.pledge_team_size),
            'team_names', (select coalesce(jsonb_agg(tm.name order by tm.position), '[]'::jsonb) from public.challenge_teams tm where tm.challenge_id = t.id))
            order by t.created_at desc), '[]'::jsonb)
            from (select c.*, row_number() over (order by c.created_at desc) as rn
                    from public.challenges c where c.created_by = v_uid and c.format is not null) t
           where t.rn <= 30);
end $$;

-- VIP3: xuất bài chạy trong khoảng ngày (tối đa 3 năm một lần)
create or replace function public.my_activity_export(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_vip(3);
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 1100 then raise exception 'INVALID_RANGE'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'started_at', r.started_at, 'title', r.title, 'source', r.source, 'km', round(r.km, 3), 'moving_s', r.moving_s,
            'elapsed_s', r.elapsed_s, 'elev_m', round(r.elev_m), 'avg_hr', round(r.avg_hr), 'xu', r.earned_xu, 'xp', r.earned_xp)
            order by r.started_at), '[]'::jsonb)
            from private.countable_runs(v_uid, private.vn_start(p_from), private.vn_start(p_to + 1)) r);
end $$;

-- ---------------------------------------------------------------------
-- Admin: chỉ số kinh tế theo tháng (giờ VN) + ảnh chụp hiện tại
-- ---------------------------------------------------------------------
create or replace function public.admin_economy_metrics(p_months integer default 6) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_sys uuid := private.system_account();
  v_n integer := least(greatest(coalesce(p_months, 6), 1), 24);
  v_m0 timestamp := date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') - make_interval(months => v_n - 1);
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'months', (select coalesce(jsonb_agg(jsonb_build_object(
        'month', to_char(g.m, 'YYYY-MM'),
        -- Xu phát ra cho người dùng (ròng, đã trừ thu hồi)
        'earn_run', coalesce(l.earn_run, 0), 'earn_game', coalesce(l.earn_game, 0), 'earn_referral', coalesce(l.earn_ref, 0),
        'earn_level', coalesce(l.earn_level, 0), 'admin_net', coalesce(l.admin_net, 0), 'purchased', coalesce(l.purchased, 0),
        -- Xu bị đốt (về hệ thống)
        'burn_fee', coalesce(l.burn_fee, 0), 'burn_gift', coalesce(l.burn_gift, 0), 'burn_shop', coalesce(l.burn_shop, 0),
        'revenue_vnd', coalesce(o.revenue, 0), 'revenue_plan_vnd', coalesce(o.rev_plan, 0), 'orders_paid', coalesce(o.paid, 0),
        'orders_created', coalesce(oc.created, 0), 'orders_expired', coalesce(oc.expired, 0), 'confirm_hours', o.confirm_h,
        'active_runners', coalesce(a.runners, 0), 'runs', coalesce(a.runs, 0), 'runs_review', coalesce(a.review, 0),
        'credits_issued', coalesce(c.issued, 0), 'credits_used', coalesce(c.used, 0),
        'subs_active', (select count(distinct s.owner_id) from public.subscriptions s
                         where s.starts_at <= least(now(), (g.m + interval '1 month') at time zone 'Asia/Ho_Chi_Minh')
                           and s.ends_at > least(now(), (g.m + interval '1 month') at time zone 'Asia/Ho_Chi_Minh') - interval '1 second'))
        order by g.m), '[]'::jsonb)
      from generate_series(v_m0, v_m0 + make_interval(months => v_n - 1), interval '1 month') g(m)
      left join (
        select date_trunc('month', t.created_at at time zone 'Asia/Ho_Chi_Minh') as m,
               sum(e.amount) filter (where e.account_id <> v_sys and t.type in ('RUN_REWARD', 'RUN_REWARD_REVERSAL')) as earn_run,
               sum(e.amount) filter (where e.account_id <> v_sys and (t.type like 'GAME\_%' escape '\')) as earn_game,
               sum(e.amount) filter (where e.account_id <> v_sys and t.type in ('REFERRAL_INVITER', 'REFERRAL_REFEREE')) as earn_ref,
               sum(e.amount) filter (where e.account_id <> v_sys and t.type = 'LEVEL_UP_XU') as earn_level,
               sum(e.amount) filter (where e.account_id <> v_sys and t.type in ('ADMIN_ADJUST', 'ADMIN_GRANT', 'ADMIN_DEDUCT', 'PROMO')) as admin_net,
               sum(e.amount) filter (where e.account_id <> v_sys and t.type in ('XU_PURCHASE', 'XU_PURCHASE_BONUS', 'IAP_TOPUP_VND')) as purchased,
               sum(e.amount) filter (where e.account_id = v_sys and t.type in ('CHALLENGE_CREATION_FEE', 'RACE_FEE')) as burn_fee,
               sum(e.amount) filter (where e.account_id = v_sys and t.type in ('GIFT', 'CHEER')) as burn_gift,
               sum(e.amount) filter (where e.account_id = v_sys and t.type in ('SHOP_SHIELD', 'SHOP_ITEM', 'SHOP_REFUND')) as burn_shop
          from public.ledger_transactions t join public.ledger_entries e on e.transaction_id = t.id
         where t.created_at >= v_m0 at time zone 'Asia/Ho_Chi_Minh'
         group by 1) l on l.m = g.m
      left join (
        select date_trunc('month', x.created_at at time zone 'Asia/Ho_Chi_Minh') as m, count(*) as created,
               count(*) filter (where x.status = 'PENDING' and x.expires_at <= now()) as expired
          from public.orders x where x.created_at >= v_m0 at time zone 'Asia/Ho_Chi_Minh' group by 1) oc on oc.m = g.m
      left join lateral (
        select sum(x.amount_vnd) as revenue, sum(x.amount_vnd) filter (where x.kind = 'PLAN') as rev_plan, count(*) as paid,
               round((avg(extract(epoch from (x.paid_at - x.created_at))) / 3600)::numeric, 1) as confirm_h
          from public.orders x
         where x.status = 'PAID' and date_trunc('month', x.paid_at at time zone 'Asia/Ho_Chi_Minh') = g.m) o on true
      left join (
        select date_trunc('month', x.started_at at time zone 'Asia/Ho_Chi_Minh') as m,
               count(distinct x.user_id) filter (where public.activity_is_countable(x.status, x.validation_status) and x.validation_status = 'APPROVED') as runners,
               count(*) as runs, count(*) filter (where x.validation_status = 'PENDING') as review
          from public.activities x where x.started_at >= v_m0 at time zone 'Asia/Ho_Chi_Minh' group by 1) a on a.m = g.m
      left join (
        select date_trunc('month', p.created_at at time zone 'Asia/Ho_Chi_Minh') as m, sum(p.total) as issued, sum(p.total - p.remaining) as used
          from public.challenge_passes p where p.source_key like 'credit:%' and p.created_at >= v_m0 at time zone 'Asia/Ho_Chi_Minh' group by 1) c on c.m = g.m),
    'snapshot', (select jsonb_build_object(
        'supply', coalesce(sum(b.bal), 0), 'holders', count(*) filter (where b.bal > 0),
        'median_balance', coalesce(percentile_cont(0.5) within group (order by b.bal) filter (where b.bal > 0), 0),
        'p90_balance', coalesce(percentile_cont(0.9) within group (order by b.bal) filter (where b.bal > 0), 0))
      from (select e.account_id, sum(e.amount) as bal from public.ledger_entries e join public.profiles p on p.id = e.account_id
             group by e.account_id) b),
    'config', private.economy_config());
end $$;

-- Quyền lợi đã có thật: bỏ chữ "(sắp có)" ở các dòng tương ứng — chỉ khi admin chưa sửa câu chữ
update public.plans set perks = replace(perks::text, '"Phân tích xu hướng tuần / tháng (sắp có)"', '"Phân tích xu hướng 12 tuần / 12 tháng"')::jsonb
 where perks::text like '%Phân tích xu hướng tuần / tháng (sắp có)%';
update public.plans set perks = replace(perks::text, '"Mẫu & nhân bản thử thách (sắp có)"', '"Nhân bản thử thách cũ làm mẫu"')::jsonb
 where perks::text like '%Mẫu & nhân bản thử thách (sắp có)%';
update public.plans set perks = replace(perks::text, '"PR 1K → 42K, phân bố pace (sắp có)"', '"Kỷ lục 1K → 42K, phân bố pace"')::jsonb
 where perks::text like '%PR 1K → 42K, phân bố pace (sắp có)%';
update public.plans set perks = replace(perks::text, '"Xuất báo cáo cá nhân PDF / Excel (sắp có)"', '"Xuất báo cáo cá nhân (in PDF, Excel CSV)"')::jsonb
 where perks::text like '%Xuất báo cáo cá nhân PDF / Excel (sắp có)%';

revoke all on function private.require_vip(integer), private.countable_runs(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.my_trends(), public.my_performance(), public.my_challenge_templates(), public.my_activity_export(date, date),
  public.admin_economy_metrics(integer) from public, anon;
grant execute on function public.my_trends(), public.my_performance(), public.my_challenge_templates(), public.my_activity_export(date, date),
  public.admin_economy_metrics(integer) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001004100_security_governance.sql
-- ===================================================================
-- 004100: Rà soát bảo mật + lưu vết không xóa được + sửa lệch kinh tế. Admin (SYSTEM_ADMIN) toàn quyền, không cần người thứ hai duyệt.
-- A. Bảo mật: khóa ghi trực tiếp vào các bảng cũ không còn dùng; bỏ quyền gọi hàm quản trị / CLB của khách chưa đăng nhập;
--    cố định search_path cho 3 hàm SECURITY DEFINER cũ; hàm cấp lượt hằng tháng chỉ cho máy chủ (service_role).
-- B. Lưu vết: nhật ký quản trị và sổ cái không sửa / xóa được (admin vẫn toàn quyền thao tác; chỉ là không xóa được dấu vết).
-- C. Kinh tế: bỏ XP thưởng khi chốt thử thách (XP chỉ từ km); thưởng từ quỹ CLB chỉ trao khi có ≥ 3 người có kết quả
--    (chống ban quản trị tự tạo thử thách rồi tự nhận quỹ), và mỗi lần treo tối đa 50% số dư quỹ.
-- Cần file 004000. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- A. Bảo mật
-- ---------------------------------------------------------------------
-- Bảng cũ (hệ thống quyền động, nhật ký cũ, mẫu cũ): app không ghi trực tiếp → thu quyền ghi (RLS đã chặn, đây là lớp thứ hai)
revoke insert, update, delete on public.achievements, public.audit_logs, public.challenge_templates, public.club_tournaments,
  public.permissions, public.roles, public.role_permissions, public.club_member_roles, public.club_announcements from anon, authenticated;
revoke delete on public.profiles, public.user_avatar from anon, authenticated;

-- Hàm SECURITY DEFINER cũ chưa cố định search_path (chống chiếm quyền bằng đối tượng trùng tên)
alter function public.delete_club(uuid, text) set search_path = public;
alter function public.delete_club(uuid) set search_path = public;
alter function public.equip_avatar_item(uuid, text) set search_path = public;
alter function public.execute_ledger_transaction(text, text, text, uuid, jsonb) set search_path = public;

-- Khách chưa đăng nhập không cần gọi các hàm quản trị / quản lý CLB (hàm vẫn tự kiểm tra, đây là lớp thứ hai)
revoke execute on function public.admin_set_club_plan(uuid, text, timestamptz, text), public.delete_club(uuid, text), public.delete_club(uuid),
  public.join_club(uuid), public.leave_club(uuid, uuid), public.remove_member(uuid), public.rotate_invite_code(uuid),
  public.set_club_announcement(uuid, text), public.set_club_slug(uuid, text), public.set_member_role(uuid, text),
  public.set_member_status(uuid, text), public.transfer_club_ownership(uuid, uuid), public.transfer_ownership(uuid, uuid),
  public.update_club(uuid, text, text, text, text), public.update_club_policy(uuid, text, integer),
  public.club_attendance_report(uuid, timestamptz, timestamptz), public.club_plan(uuid) from anon;

-- Việc định kỳ: chỉ máy chủ (cron) gọi
revoke execute on function public.issue_due_credits() from public, anon, authenticated;
grant execute on function public.issue_due_credits() to service_role;

-- ---------------------------------------------------------------------
-- B. Nhật ký quản trị và sổ cái: chỉ được thêm, không sửa / xóa (lưu vết, không giới hạn quyền admin)
-- ---------------------------------------------------------------------
create or replace function private.append_only() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'ledger_transactions' and tg_op = 'UPDATE'
     and to_jsonb(old)->>'approved_by' is null and (to_jsonb(new) - 'approved_by') = (to_jsonb(old) - 'approved_by') then
    return new;                                   -- ghi người duyệt ngay sau khi tạo giao dịch
  end if;
  raise exception 'APPEND_ONLY: % không được sửa hoặc xóa', tg_table_name;
end $$;
drop trigger if exists trg_append_only on public.admin_audit_log;
create trigger trg_append_only before update or delete on public.admin_audit_log for each row execute function private.append_only();
drop trigger if exists trg_append_only on public.ledger_entries;
create trigger trg_append_only before update or delete on public.ledger_entries for each row execute function private.append_only();
drop trigger if exists trg_append_only on public.ledger_transactions;
create trigger trg_append_only before update or delete on public.ledger_transactions for each row execute function private.append_only();

-- ---------------------------------------------------------------------
-- C1. Thưởng từ quỹ CLB: tối đa 50% số dư quỹ mỗi lần treo (chặn trước khi trừ quỹ)
-- ---------------------------------------------------------------------
create or replace function private.challenge_reward_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.reward_source = 'CREATOR' and coalesce(new.reward_xu, 0) > 0 then raise exception 'REWARD_NOT_ALLOWED'; end if;
  if new.reward_source = 'CLUB' and coalesce(new.reward_xu, 0) > 0 and new.target_club_id is not null
     and new.reward_xu > private.balance(new.target_club_id) * 0.5 then
    raise exception 'REWARD_TOO_LARGE';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- C2. Chốt thử thách: không cộng XP (XP chỉ từ km); thưởng quỹ CLB cần ≥ 3 người có kết quả, không thì hoàn quỹ
-- ---------------------------------------------------------------------
create or replace function private.settle_challenge(p_challenge_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id for update);
  v_pool numeric;
  v_users uuid[] := '{}';
  v_weights numeric[] := '{}';
  v_sumw numeric;
  v_amount numeric;
  v_paid numeric := 0;
  v_winners uuid[] := '{}';
  v_top numeric;
  v_names text;
  v_active integer;
  i integer;
  r record;
begin
  if c.id is null or c.status <> 'ACTIVE' or now() < c.end_date then return false; end if;

  update public.challenge_participants p set final_rank = x.rk
    from (select id, (rank() over (order by current_progress desc, completed_at asc nulls last))::int as rk
            from public.challenge_participants where challenge_id = c.id and status <> 'LEFT') x
   where p.id = x.id;

  if c.format = 'TEAM' then
    v_top := (select max(t.score) from private.challenge_team_scores(c.id) t);
    if coalesce(v_top, 0) > 0 then
      v_users := (select array_agg(p.profile_id) from public.challenge_participants p
                   where p.challenge_id = c.id and p.status <> 'LEFT'
                     and p.team_id in (select t.team_id from private.challenge_team_scores(c.id) t where t.score = v_top));
      v_weights := array_fill(1::numeric, array[coalesce(cardinality(v_users), 0)]);
      v_winners := v_users;
    end if;
  elsif c.format = 'SOLO_GOAL' then
    v_users := (select array_agg(profile_id) from public.challenge_participants where challenge_id = c.id and status <> 'LEFT' and completed_at is not null);
    v_weights := array_fill(1::numeric, array[coalesce(cardinality(v_users), 0)]);
  elsif c.format = 'COLLECTIVE' then
    if (select coalesce(sum(current_progress), 0) from public.challenge_participants where challenge_id = c.id and status <> 'LEFT') >= c.target_value then
      v_users := (select array_agg(profile_id) from public.challenge_participants where challenge_id = c.id and status <> 'LEFT' and current_progress > 0);
      v_weights := array_fill(1::numeric, array[coalesce(cardinality(v_users), 0)]);
    end if;
  elsif c.reward_split = 'TOP3' then
    v_users := (select array_agg(profile_id order by final_rank) from public.challenge_participants
                 where challenge_id = c.id and status <> 'LEFT' and final_rank <= 3 and current_progress > 0);
    v_weights := (select array_agg(case final_rank when 1 then 50 when 2 then 30 else 20 end::numeric order by final_rank) from public.challenge_participants
                   where challenge_id = c.id and status <> 'LEFT' and final_rank <= 3 and current_progress > 0);
    v_winners := (select array_agg(profile_id) from public.challenge_participants
                   where challenge_id = c.id and status <> 'LEFT' and final_rank = 1 and current_progress > 0);
  else
    v_users := (select array_agg(profile_id) from public.challenge_participants
                 where challenge_id = c.id and status <> 'LEFT' and final_rank = 1 and current_progress > 0);
    v_weights := array_fill(1::numeric, array[coalesce(cardinality(v_users), 0)]);
    v_winners := v_users;
  end if;
  v_users := coalesce(v_users, '{}'); v_weights := coalesce(v_weights, '{}'); v_winners := coalesce(v_winners, '{}');

  v_pool := case when c.reward_source <> 'NONE' then coalesce(c.reward_xu, 0) else 0 end;
  v_active := (select count(*) from public.challenge_participants where challenge_id = c.id and status <> 'LEFT' and current_progress > 0);
  if v_pool > 0 then
    if cardinality(v_users) = 0 or (c.reward_source = 'CLUB' and v_active < 3) then
      perform private.challenge_refund_escrow(c);
    else
      v_sumw := (select sum(w) from unnest(v_weights) w);
      for i in reverse cardinality(v_users) .. 1 loop
        v_amount := case when i = 1 then v_pool - v_paid else floor(v_pool * v_weights[i] / v_sumw * 10) / 10 end;
        if v_amount <= 0 then continue; end if;
        perform private.ledger_post('CHALLENGE_PRIZE', 'challenge_prize:' || c.id || ':' || v_users[i], 'Thưởng thử thách: ' || c.title, v_users[i],
          jsonb_build_array(jsonb_build_object('account_id', v_users[i], 'coin_kind', 'BONUS', 'amount', v_amount),
                            jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -v_amount)), c.id);
        update public.challenge_participants set reward_xu = reward_xu + v_amount where challenge_id = c.id and profile_id = v_users[i];
        v_paid := v_paid + v_amount;
      end loop;
    end if;
  end if;

  update public.challenges set status = 'FINISHED', settled_at = now() where id = c.id;

  for r in select profile_id, final_rank, reward_xu, completed_at from public.challenge_participants where challenge_id = c.id and status <> 'LEFT' loop
    perform private.notify(r.profile_id, c.target_club_id, 'CHALLENGE_RESULT', 'Kết quả: ' || c.title,
      case when r.profile_id = any(v_winners) then 'Chúc mừng! Bạn về nhất'
           when r.completed_at is not null then 'Bạn đã hoàn thành mục tiêu'
           else 'Bạn xếp hạng ' || r.final_rank end
      || case when r.reward_xu > 0 then ' · +' || r.reward_xu || ' Xu' else '' end,
      '/challenges/' || c.id, null, true);
  end loop;

  if c.target_club_id is not null then
    v_names := (select string_agg(private.display_name(u), ', ') from unnest(v_winners[1:5]) u);
    insert into public.club_posts (club_id, author_id, kind, title, body, meta)
    values (c.target_club_id, null, 'CHALLENGE', 'Kết quả: ' || c.title,
            case when v_names is not null then 'Chúc mừng ' || v_names || '!' else 'Thử thách đã kết thúc.' end
            || case when v_pool > 0 and v_paid = 0 then ' Thưởng đã hoàn lại quỹ CLB (cần ít nhất 3 người có kết quả).' else '' end,
            jsonb_build_object('challenge_id', c.id, 'result', true, 'format', c.format, 'reward_xu', v_paid));
  end if;
  return true;
end $$;

-- ---------------------------------------------------------------------
-- Quyền
-- ---------------------------------------------------------------------
revoke all on function private.append_only() from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001004200_form_comeback.sql
-- ===================================================================
-- 004200: Nghỉ dài ngày — KHÔNG hạ cấp. Cấp độ là thành tích trọn đời (XP chỉ tăng từ km, chỉ giảm khi bài bị thu hồi).
-- Thay vào đó:
-- • "Phong độ" (runner_form): trạng thái 28 ngày gần nhất — Đang lên / Ổn định / Chậm lại / Tạm nghỉ / Nghỉ dài / Chưa chạy.
--   Thứ hạng cạnh tranh vốn đã tự "hạ" theo thời gian: league tuần, bảng xếp hạng CLB theo tuần / tháng, chuỗi tuần.
-- • "Chào mừng trở lại": bài chạy hợp lệ đầu tiên sau ≥ minRestDays ngày nghỉ → +xu Xu (mặc định 28 ngày, 10 Xu),
--   mỗi người tối đa một lần mỗi cooldownDays ngày (mặc định 90) để không thành chỗ cày Xu. Thu hồi nếu bài bị hủy.
-- Cần file 004100 (và 003700 bản có COMEBACK). Chạy lại nhiều lần vẫn an toàn.

create or replace function private.runner_form(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with r as (
    select a.started_at, greatest(coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0), 0) / 1000.0 as km
      from public.activities a
     where a.user_id = p_user and a.validation_status = 'APPROVED' and public.activity_is_countable(a.status, a.validation_status)
  ), s as (
    select max(started_at) as last_at,
           coalesce(sum(km) filter (where started_at >= now() - interval '28 days'), 0) as km28,
           coalesce(sum(km) filter (where started_at >= now() - interval '56 days' and started_at < now() - interval '28 days'), 0) as km_prev,
           count(*) filter (where started_at >= now() - interval '28 days') as runs28
      from r
  )
  select jsonb_build_object(
    'status', case when s.last_at is null then 'NEW'
                   when s.last_at < now() - interval '60 days' then 'LONG_BREAK'
                   when s.last_at < now() - interval '21 days' then 'RESTING'
                   when s.last_at < now() - interval '7 days' then 'SLOWING'
                   when s.km_prev > 0 and s.km28 >= s.km_prev * 1.1 then 'RISING'
                   else 'STEADY' end,
    'last_run_at', s.last_at,
    'days_since', case when s.last_at is null then null else floor(extract(epoch from (now() - s.last_at)) / 86400)::int end,
    'km_28d', round(s.km28, 1), 'km_prev_28d', round(s.km_prev, 1), 'runs_28d', s.runs28,
    'comeback_xu', coalesce((private.economy_config()->'comeback'->>'xu')::numeric, 10),
    'comeback_days', coalesce((private.economy_config()->'comeback'->>'minRestDays')::int, 28))
  from s
$$;

-- Phong độ của mình hoặc người khác (chỉ trạng thái thô, không lộ bài chạy)
create or replace function public.runner_form(p_user uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  return private.runner_form(coalesce(p_user, v_uid));
end $$;

-- Thưởng quay lại: chạy khi bài được ghi nhận lần đầu (rewarded_at từ null → có giá trị)
create or replace function private.comeback_on_reward() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb := coalesce(private.economy_config()->'comeback', '{}'::jsonb);
  v_rest integer := coalesce((cfg->>'minRestDays')::int, 28);
  v_cool integer := coalesce((cfg->>'cooldownDays')::int, 90);
  v_xu numeric := coalesce((cfg->>'xu')::numeric, 10);
  v_prev timestamptz;
begin
  if new.user_id is null or old.rewarded_at is not null or new.rewarded_at is null or new.validation_status <> 'APPROVED' then return new; end if;
  v_prev := (select max(a.started_at) from public.activities a
              where a.user_id = new.user_id and a.id <> new.id and a.started_at < new.started_at
                and a.validation_status = 'APPROVED' and public.activity_is_countable(a.status, a.validation_status));
  if v_prev is null or new.started_at - v_prev < make_interval(days => v_rest) then return new; end if;
  if exists (select 1 from public.game_events g where g.user_id = new.user_id and g.kind = 'COMEBACK'
               and g.created_at > now() - make_interval(days => v_cool)) then return new; end if;
  perform private.award(new.user_id, 'COMEBACK', 'Chào mừng trở lại!',
    'Sau ' || floor(extract(epoch from (new.started_at - v_prev)) / 86400)::int || ' ngày nghỉ — chạy đều lại từ từ nhé',
    v_xu, 0, 'comeback:' || new.user_id || ':' || new.id, new.id,
    jsonb_build_object('rest_days', floor(extract(epoch from (new.started_at - v_prev)) / 86400)::int));
  return new;
end $$;
drop trigger if exists trg_comeback_on_reward on public.activities;
create trigger trg_comeback_on_reward after update of rewarded_at on public.activities
  for each row execute function private.comeback_on_reward();

revoke all on function private.runner_form(uuid), private.comeback_on_reward() from public, anon, authenticated;
revoke all on function public.runner_form(uuid) from public, anon;
grant execute on function public.runner_form(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001004300_admin_quests_promotions.sql
-- ===================================================================
-- 004300: Admin tạo nhiệm vụ có thưởng + khuyến mãi hàng loạt.
-- 1. Nhiệm vụ: admin tạo / sửa / tắt nhiệm vụ ngày, tuần, tháng hoặc SỰ KIỆN (trong một khoảng ngày), thưởng Xu khi hoàn thành.
--    Chỉ số mới: TOTAL_KM (tổng km trong kỳ), RUN_COUNT (số bài trong kỳ). Có thể giới hạn cho VIP từ bậc N.
--    XP vẫn chỉ đến từ km — nhiệm vụ chỉ thưởng Xu.
-- 2. Khuyến mãi (Quản trị → Khuyến mãi):
--    • GRANT — tặng hàng loạt theo nhóm người nhận (tất cả, đang chạy, lâu không chạy, người mới, VIP, gói miễn phí,
--      thành viên CLB, từ cấp N, danh sách chọn tay). Phần thưởng: Xu / lượt tạo / gói VIP. Mỗi người nhận một lần mỗi đợt.
--    • CODE — mã khuyến mãi người dùng tự nhập ở Ví (giới hạn tổng lượt, hạn dùng, chỉ cho nhóm nào). Chống dò mã: 10 lần sai / giờ.
--    • SALE — giảm giá gói (% ) và / hoặc tặng thêm Xu khi nạp (%) trong một khoảng thời gian; áp thẳng vào đơn hàng.
-- Cần file 004200. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 1. Nhiệm vụ do admin tạo
-- ---------------------------------------------------------------------
alter table public.quests add column if not exists starts_at timestamptz;
alter table public.quests add column if not exists ends_at timestamptz;
alter table public.quests add column if not exists min_vip_tier integer not null default 0;
alter table public.quests add column if not exists created_by uuid references public.profiles(id) on delete set null;
alter table public.quests drop constraint if exists quests_period_check;
alter table public.quests add constraint quests_period_check check (period in ('DAILY', 'WEEKLY', 'MONTHLY', 'EVENT'));
alter table public.quests drop constraint if exists quests_metric_check;
alter table public.quests add constraint quests_metric_check check (metric in ('CHECKIN', 'RUN_KM', 'CHEERS_SENT', 'WEEK_KM', 'WEEK_RUN_DAYS',
  'CHALLENGE_JOINS', 'CHEERS_RECEIVED', 'TOTAL_KM', 'RUN_COUNT'));

create or replace function private.quest_period_start(p_period text, p_starts timestamptz, p_at timestamptz) returns date
language sql stable security definer set search_path = public as $$
  select case p_period when 'DAILY' then private.vn_day(p_at) when 'WEEKLY' then private.vn_week(p_at)
              when 'MONTHLY' then date_trunc('month', private.vn_day(p_at))::date
              else coalesce(private.vn_day(p_starts), date '2000-01-01') end
$$;

create or replace function private.quest_progress(
  p_user uuid, p_metric text, p_value numeric, p_mode text default 'ADD', p_at timestamptz default now(), p_activity uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare q record; v_start date; v_prog numeric; v_done timestamptz; v_tier integer := private.user_vip_tier(p_user);
begin
  for q in select * from public.quests x where x.metric = p_metric and x.is_active
             and (x.starts_at is null or p_at >= x.starts_at) and (x.ends_at is null or p_at < x.ends_at)
             and x.min_vip_tier <= v_tier loop
    v_start := private.quest_period_start(q.period, q.starts_at, p_at);
    insert into public.user_quest_progress (user_id, quest_id, period_start) values (p_user, q.id, v_start) on conflict do nothing;
    update public.user_quest_progress
       set progress = case p_mode when 'ADD' then progress + p_value when 'MAX' then greatest(progress, p_value) else p_value end, updated_at = now()
     where user_id = p_user and quest_id = q.id and period_start = v_start
    returning progress, completed_at into v_prog, v_done;
    if v_done is null and v_prog >= q.target then
      update public.user_quest_progress set completed_at = now() where user_id = p_user and quest_id = q.id and period_start = v_start;
      perform private.award(p_user, 'QUEST', 'Nhiệm vụ: ' || q.title,
        case q.period when 'DAILY' then 'Nhiệm vụ ngày' when 'WEEKLY' then 'Nhiệm vụ tuần' when 'MONTHLY' then 'Nhiệm vụ tháng' else 'Nhiệm vụ sự kiện' end,
        q.reward_xu, 0, 'quest:' || q.id || ':' || p_user || ':' || v_start, p_activity,
        jsonb_build_object('quest_id', q.id, 'code', q.code, 'period', q.period, 'period_start', v_start, 'icon', q.icon));
    end if;
  end loop;
end $$;

-- Chỉ số mới: cộng dồn km và số bài theo kỳ của nhiệm vụ
create or replace function private.quest_totals_on_reward() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is null or old.rewarded_at is not null or new.rewarded_at is null or new.validation_status <> 'APPROVED' then return new; end if;
  begin
    perform private.quest_progress(new.user_id, 'TOTAL_KM', private.run_km(new), 'ADD', coalesce(new.started_at, now()), new.id);
    perform private.quest_progress(new.user_id, 'RUN_COUNT', 1, 'ADD', coalesce(new.started_at, now()), new.id);
  exception when others then
    raise warning 'quest_totals_on_reward % lỗi: % %', new.id, sqlstate, sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists trg_quest_totals_on_reward on public.activities;
create trigger trg_quest_totals_on_reward after update of rewarded_at on public.activities
  for each row execute function private.quest_totals_on_reward();

-- Nhiệm vụ của tôi (đúng kỳ, đang trong khung thời gian, có khóa VIP)
create or replace function public.my_quests() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); v_tier integer := private.user_vip_tier(v_uid);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', q.id, 'code', q.code, 'period', q.period, 'metric', q.metric, 'title', q.title, 'description', q.description, 'icon', q.icon,
            'target', q.target, 'reward_xu', q.reward_xu, 'starts_at', q.starts_at, 'ends_at', q.ends_at, 'min_vip_tier', q.min_vip_tier,
            'locked', q.min_vip_tier > v_tier, 'progress', least(coalesce(p.progress, 0), q.target), 'completed', p.completed_at is not null)
            order by case q.period when 'EVENT' then 0 when 'DAILY' then 1 when 'WEEKLY' then 2 else 3 end, q.sort, q.created_at), '[]'::jsonb)
            from public.quests q
            left join public.user_quest_progress p on p.quest_id = q.id and p.user_id = v_uid
                 and p.period_start = private.quest_period_start(q.period, q.starts_at, now())
           where q.is_active and (q.starts_at is null or q.starts_at <= now()) and (q.ends_at is null or q.ends_at > now()));
end $$;

create or replace function public.admin_list_quests() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(q) || jsonb_build_object(
            'completions', (select count(*) from public.user_quest_progress p where p.quest_id = q.id and p.completed_at is not null),
            'xu_paid', coalesce((select sum(e.xu) from public.game_events e where e.kind = 'QUEST' and e.payload->>'quest_id' = q.id::text), 0))
            order by q.is_active desc, q.created_at desc), '[]'::jsonb) from public.quests q);
end $$;

create or replace function public.admin_save_quest(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  v_id uuid := coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid());
  v_title text := trim(coalesce(p->>'title', ''));
  v_period text := upper(coalesce(p->>'period', 'DAILY'));
  v_metric text := upper(coalesce(p->>'metric', 'TOTAL_KM'));
  v_target numeric := (p->>'target')::numeric;
  v_xu numeric := round(coalesce((p->>'reward_xu')::numeric, 0), 1);
  v_start timestamptz := nullif(p->>'starts_at', '')::timestamptz;
  v_end timestamptz := nullif(p->>'ends_at', '')::timestamptz;
begin
  if char_length(v_title) not between 2 and 80 then raise exception 'INVALID_TITLE'; end if;
  if v_period not in ('DAILY', 'WEEKLY', 'MONTHLY', 'EVENT') then raise exception 'INVALID_PERIOD'; end if;
  if v_metric not in ('CHECKIN', 'RUN_KM', 'TOTAL_KM', 'RUN_COUNT', 'WEEK_KM', 'WEEK_RUN_DAYS', 'CHALLENGE_JOINS') then raise exception 'INVALID_METRIC'; end if;
  if v_metric in ('WEEK_KM', 'WEEK_RUN_DAYS') and v_period <> 'WEEKLY' then raise exception 'INVALID_METRIC'; end if;
  if v_target is null or v_target <= 0 or v_target > 100000 then raise exception 'INVALID_TARGET'; end if;
  if v_xu < 0 or v_xu > 100000 then raise exception 'INVALID_AMOUNT'; end if;
  if v_period = 'EVENT' and (v_start is null or v_end is null) then raise exception 'INVALID_TIME_RANGE'; end if;
  if v_end is not null and v_start is not null and (v_end <= v_start or v_end - v_start > interval '366 days') then raise exception 'INVALID_TIME_RANGE'; end if;
  insert into public.quests (id, code, period, metric, target, title, description, icon, reward_xu, reward_xp, sort, is_active, starts_at, ends_at, min_vip_tier, created_by)
  values (v_id, coalesce(nullif(p->>'code', ''), 'ADM_' || upper(substr(replace(v_id::text, '-', ''), 1, 8))), v_period, v_metric, v_target, v_title,
          nullif(trim(coalesce(p->>'description', '')), ''), coalesce(nullif(p->>'icon', ''), 'Target'), v_xu, 0, coalesce((p->>'sort')::int, 100),
          coalesce((p->>'is_active')::boolean, true), v_start, v_end, least(greatest(coalesce((p->>'min_vip_tier')::int, 0), 0), 3), v_uid)
  on conflict (id) do update set period = excluded.period, metric = excluded.metric, target = excluded.target, title = excluded.title,
    description = excluded.description, icon = excluded.icon, reward_xu = excluded.reward_xu, reward_xp = 0, sort = excluded.sort,
    is_active = excluded.is_active, starts_at = excluded.starts_at, ends_at = excluded.ends_at, min_vip_tier = excluded.min_vip_tier;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SAVE_QUEST', v_id::text, p);
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 2. Khuyến mãi
-- ---------------------------------------------------------------------
create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('GRANT', 'CODE', 'SALE')),
  title text not null check (char_length(title) between 2 and 120),
  message text check (message is null or char_length(message) <= 300),
  reward jsonb not null default '{}'::jsonb,          -- {xu, passes: {qty, max_slots, days}, plan: {code, months}}
  segment jsonb,                                      -- nhóm người nhận (GRANT) / được dùng mã (CODE)
  code text unique check (code is null or code ~ '^[A-Z0-9_-]{4,24}$'),
  max_uses integer check (max_uses is null or max_uses > 0),
  discount_pct integer not null default 0 check (discount_pct between 0 and 90),
  bonus_pct integer not null default 0 check (bonus_pct between 0 and 300),
  applies_to text not null default 'ALL' check (applies_to in ('ALL', 'PLAN', 'XU')),
  plan_code text references public.plans(code),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  is_active boolean not null default true,
  recipients integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.promotion_redemptions (
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (promotion_id, user_id)
);
create table if not exists private.promo_attempts (user_id uuid not null, at timestamptz not null default now());
create index if not exists promo_attempts_idx on private.promo_attempts (user_id, at);
alter table public.orders add column if not exists promotion_id uuid references public.promotions(id) on delete set null;
alter table public.orders add column if not exists list_price_vnd integer;
alter table public.promotions enable row level security;
alter table public.promotion_redemptions enable row level security;
revoke all on public.promotions, public.promotion_redemptions from anon, authenticated;
revoke all on private.promo_attempts from public, anon, authenticated;

-- Nhóm người nhận
create or replace function private.in_segment(p_user uuid, seg jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select case when seg is null or seg = 'null'::jsonb then true else
    case upper(coalesce(seg->>'type', 'ALL'))
      when 'ALL' then true
      when 'ACTIVE' then exists (select 1 from public.activities a where a.user_id = p_user and a.validation_status = 'APPROVED'
                                   and a.started_at >= now() - make_interval(days => coalesce((seg->>'days')::int, 30)))
      when 'INACTIVE' then exists (select 1 from public.activities a where a.user_id = p_user and a.validation_status = 'APPROVED')
                       and not exists (select 1 from public.activities a where a.user_id = p_user and a.validation_status = 'APPROVED'
                                   and a.started_at >= now() - make_interval(days => coalesce((seg->>'days')::int, 30)))
      when 'NEW' then (select p.created_at from public.profiles p where p.id = p_user) >= now() - make_interval(days => coalesce((seg->>'days')::int, 14))
      when 'VIP' then private.user_vip_tier(p_user) >= greatest(coalesce((seg->>'min_tier')::int, 1), 1)
      when 'FREE' then private.user_vip_tier(p_user) = 0
      when 'CLUB' then exists (select 1 from public.club_members m where m.user_id = p_user and m.status = 'APPROVED'
                                 and m.club_id = nullif(seg->>'club_id', '')::uuid)
      when 'LEVEL' then coalesce((select p.level from public.profiles p where p.id = p_user), 1) >= coalesce((seg->>'min_level')::int, 1)
      when 'USERS' then p_user::text in (select jsonb_array_elements_text(coalesce(seg->'ids', '[]'::jsonb)))
      else false end end
$$;

create or replace function private.valid_reward(r jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(coalesce(r, '{}'::jsonb)) = 'object'
     and coalesce((r->>'xu')::numeric, 0) between 0 and 1000000
     and (r->'passes' is null or r->'passes' = 'null'::jsonb or (
          coalesce((r->'passes'->>'qty')::int, 0) between 1 and 100 and coalesce((r->'passes'->>'max_slots')::int, 0) between 1 and 10000
          and coalesce((r->'passes'->>'days')::int, 30) between 1 and 365))
     and (r->'plan' is null or r->'plan' = 'null'::jsonb or ((r->'plan'->>'months')::int in (1, 3, 6, 12)))
     and (coalesce((r->>'xu')::numeric, 0) > 0 or (r->'passes' is not null and r->'passes' <> 'null'::jsonb)
          or (r->'plan' is not null and r->'plan' <> 'null'::jsonb))
$$;

-- Gói tặng phải là gói cá nhân (VIP), không phải CLB Pro
create or replace function private.reward_plan_ok(r jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select r->'plan' is null or r->'plan' = 'null'::jsonb
      or exists (select 1 from public.plans x where x.code = upper(r->'plan'->>'code') and x.owner_type = 'USER')
$$;

-- Trao phần thưởng một lần cho một người (khóa chống lặp theo đợt + người)
create or replace function private.give_promo_reward(pr public.promotions, p_user uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb := pr.reward; v_parts text[] := '{}';
begin
  if coalesce((r->>'xu')::numeric, 0) > 0 then
    perform private.ledger_post('PROMO', 'promo:' || pr.id || ':' || p_user, left(pr.title, 200), p_actor,
      jsonb_build_array(jsonb_build_object('account_id', p_user, 'coin_kind', 'BONUS', 'amount', (r->>'xu')::numeric),
                        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -(r->>'xu')::numeric)), pr.id);
    v_parts := v_parts || ((r->>'xu') || ' Xu');
  end if;
  if r->'passes' is not null and r->'passes' <> 'null'::jsonb then
    insert into public.challenge_passes (owner_type, owner_id, max_slots, total, remaining, expires_at, note, granted_by, source_key)
    values ('USER', p_user, (r->'passes'->>'max_slots')::int, (r->'passes'->>'qty')::int, (r->'passes'->>'qty')::int,
            now() + make_interval(days => coalesce((r->'passes'->>'days')::int, 30)), left(pr.title, 200), p_actor, 'promo:' || pr.id || ':' || p_user)
    on conflict (source_key) where source_key is not null do nothing;
    v_parts := v_parts || ((r->'passes'->>'qty') || ' lượt tạo ≤' || (r->'passes'->>'max_slots') || ' người');
  end if;
  if r->'plan' is not null and r->'plan' <> 'null'::jsonb then
    perform private.grant_subscription('USER', p_user, upper(r->'plan'->>'code'), (r->'plan'->>'months')::int, 'ADMIN', null, left(pr.title, 200), p_actor);
    v_parts := v_parts || ('gói ' || upper(r->'plan'->>'code') || ' ' || (r->'plan'->>'months') || ' tháng');
  end if;
  perform private.notify(p_user, null, 'PROMO', pr.title,
    coalesce(nullif(trim(coalesce(pr.message, '')), ''), 'Bạn nhận: ' || array_to_string(v_parts, ', ')), '/wallet', p_actor, true);
end $$;

create or replace function public.admin_preview_segment(p_segment jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select jsonb_build_object('count', count(*),
            'sample', coalesce(jsonb_agg(t.display_name) filter (where t.rn <= 5), '[]'::jsonb))
            from (select p.display_name, row_number() over (order by p.created_at desc) as rn
                    from public.profiles p where private.in_segment(p.id, p_segment)) t);
end $$;

-- Tặng hàng loạt: tạo đợt + trao ngay cho mọi người trong nhóm (tối đa 50.000 người mỗi đợt)
create or replace function public.admin_run_grant(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  pr public.promotions;
  u record;
  n integer := 0;
begin
  if not private.valid_reward(p->'reward') or not private.reward_plan_ok(p->'reward') then raise exception 'INVALID_REWARD'; end if;
  if (select count(*) from public.profiles x where private.in_segment(x.id, p->'segment')) > 50000 then raise exception 'SEGMENT_TOO_LARGE'; end if;
  insert into public.promotions (kind, title, message, reward, segment, created_by)
  values ('GRANT', trim(coalesce(p->>'title', '')), nullif(trim(coalesce(p->>'message', '')), ''), p->'reward', coalesce(p->'segment', '{"type":"ALL"}'::jsonb), v_uid)
  returning * into pr;
  for u in select x.id from public.profiles x where private.in_segment(x.id, pr.segment) loop
    insert into public.promotion_redemptions (promotion_id, user_id) values (pr.id, u.id) on conflict do nothing;
    if found then
      perform private.give_promo_reward(pr, u.id, v_uid);
      n := n + 1;
    end if;
  end loop;
  update public.promotions set recipients = n where id = pr.id;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'PROMO_GRANT', pr.id::text, p || jsonb_build_object('recipients', n));
  return jsonb_build_object('promotion_id', pr.id, 'recipients', n);
end $$;

-- Mã khuyến mãi / đợt giảm giá: tạo, sửa, bật tắt
create or replace function public.admin_save_promo(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  v_id uuid := coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid());
  v_kind text := upper(coalesce(p->>'kind', ''));
  v_code text := nullif(upper(trim(coalesce(p->>'code', ''))), '');
begin
  if v_kind not in ('CODE', 'SALE') then raise exception 'INVALID_KIND'; end if;
  if v_kind = 'CODE' and (v_code is null or not private.valid_reward(p->'reward') or not private.reward_plan_ok(p->'reward')) then raise exception 'INVALID_REWARD'; end if;
  if v_kind = 'SALE' and coalesce((p->>'discount_pct')::int, 0) = 0 and coalesce((p->>'bonus_pct')::int, 0) = 0 then raise exception 'INVALID_SALE'; end if;
  insert into public.promotions (id, kind, title, message, reward, segment, code, max_uses, discount_pct, bonus_pct, applies_to, plan_code,
                                 starts_at, ends_at, is_active, created_by)
  values (v_id, v_kind, trim(coalesce(p->>'title', '')), nullif(trim(coalesce(p->>'message', '')), ''),
          case when v_kind = 'CODE' then p->'reward' else '{}'::jsonb end, case when p->'segment' = 'null'::jsonb then null else p->'segment' end,
          case when v_kind = 'CODE' then v_code end, nullif(p->>'max_uses', '')::int,
          coalesce((p->>'discount_pct')::int, 0), coalesce((p->>'bonus_pct')::int, 0), upper(coalesce(p->>'applies_to', 'ALL')),
          nullif(p->>'plan_code', ''), coalesce(nullif(p->>'starts_at', '')::timestamptz, now()), nullif(p->>'ends_at', '')::timestamptz,
          coalesce((p->>'is_active')::boolean, true), v_uid)
  on conflict (id) do update set title = excluded.title, message = excluded.message, reward = excluded.reward, segment = excluded.segment,
    code = excluded.code, max_uses = excluded.max_uses, discount_pct = excluded.discount_pct, bonus_pct = excluded.bonus_pct,
    applies_to = excluded.applies_to, plan_code = excluded.plan_code, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
    is_active = excluded.is_active;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SAVE_PROMO', v_id::text, p);
  return v_id;
end $$;

create or replace function public.admin_list_promotions() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(x) || jsonb_build_object('creator', private.display_name(x.created_by),
            'orders', (select count(*) from public.orders o where o.promotion_id = x.id and o.status = 'PAID')) order by x.created_at desc), '[]'::jsonb)
            from public.promotions x);
end $$;

-- Người dùng nhập mã
create or replace function public.redeem_promo_code(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  pr public.promotions := (select x from public.promotions x where x.kind = 'CODE' and x.code = upper(trim(coalesce(p_code, ''))) for update);
begin
  if (select count(*) from private.promo_attempts a where a.user_id = v_uid and a.at > now() - interval '1 hour') >= 10 then
    raise exception 'TOO_MANY_ATTEMPTS';
  end if;
  if pr.id is null or not pr.is_active or pr.starts_at > now() or (pr.ends_at is not null and pr.ends_at <= now()) then
    insert into private.promo_attempts (user_id) values (v_uid);     -- trả lỗi (không raise) để lần thử sai được ghi lại
    return jsonb_build_object('error', 'PROMO_INVALID');
  end if;
  if pr.max_uses is not null and pr.recipients >= pr.max_uses then raise exception 'PROMO_USED_UP'; end if;
  if not private.in_segment(v_uid, pr.segment) then raise exception 'PROMO_NOT_ELIGIBLE'; end if;
  insert into public.promotion_redemptions (promotion_id, user_id) values (pr.id, v_uid) on conflict do nothing;
  if not found then raise exception 'PROMO_ALREADY_USED'; end if;
  perform private.give_promo_reward(pr, v_uid, null);
  update public.promotions set recipients = recipients + 1 where id = pr.id;
  return jsonb_build_object('title', pr.title, 'reward', pr.reward, 'balance', private.balance(v_uid));
end $$;

-- Đợt giảm giá đang chạy tốt nhất cho một món (gói hoặc nạp Xu)
create or replace function private.best_sale(p_kind text, p_plan text) returns public.promotions
language sql stable security definer set search_path = public as $$
  select t.x from (select x, row_number() over (order by x.discount_pct desc, x.bonus_pct desc, x.created_at desc) as rn
                     from public.promotions x
                    where x.kind = 'SALE' and x.is_active and x.starts_at <= now() and (x.ends_at is null or x.ends_at > now())
                      and x.applies_to in ('ALL', p_kind) and (x.plan_code is null or x.plan_code = p_plan)) t
   where t.rn = 1
$$;

create or replace function public.active_sales() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'message', x.message, 'discount_pct', x.discount_pct,
           'bonus_pct', x.bonus_pct, 'applies_to', x.applies_to, 'plan_code', x.plan_code, 'ends_at', x.ends_at) order by x.discount_pct desc), '[]'::jsonb)
    from public.promotions x
   where x.kind = 'SALE' and x.is_active and x.starts_at <= now() and (x.ends_at is null or x.ends_at > now())
$$;

-- Đơn hàng áp đợt giảm giá / tặng thêm Xu (thay bản 003800)
create or replace function public.create_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_kind text := upper(coalesce(p->>'kind', ''));
  v_plan public.plans := (select x from public.plans x where x.code = p->>'plan_code' and x.active);
  v_months integer := coalesce((p->>'months')::int, 1);
  v_list integer;
  v_price integer;
  v_pkg public.xu_packages := (select x from public.xu_packages x where x.id = nullif(p->>'package_id', '')::uuid and x.active);
  v_owner uuid;
  v_owner_type text;
  v_sale public.promotions;
  v_bonus integer;
  v_id uuid := gen_random_uuid();
begin
  if (select count(*) from public.orders o where o.buyer_id = v_uid and o.status = 'PENDING' and o.expires_at > now()) >= 5 then
    raise exception 'TOO_MANY_PENDING_ORDERS';
  end if;
  if v_kind = 'PLAN' then
    if v_plan.code is null then raise exception 'INVALID_PLAN'; end if;
    v_list := (select pp.price_vnd from public.plan_prices pp where pp.plan_code = v_plan.code and pp.months = v_months and pp.active);
    if v_list is null then raise exception 'INVALID_MONTHS'; end if;
    v_owner_type := v_plan.owner_type;
    if v_owner_type = 'CLUB' then
      v_owner := nullif(p->>'club_id', '')::uuid;
      if v_owner is null or not public.club_is_staff(v_owner) then raise exception 'CLUB_STAFF_REQUIRED'; end if;
    else
      v_owner := v_uid;
    end if;
    v_sale := private.best_sale('PLAN', v_plan.code);
    v_price := greatest(1000, (round(v_list * (100 - coalesce(v_sale.discount_pct, 0)) / 100.0 / 1000) * 1000)::int);
    insert into public.orders (id, code, buyer_id, kind, plan_code, months, owner_type, owner_id, amount_vnd, list_price_vnd, promotion_id)
    values (v_id, 'RH' || nextval('public.order_code_seq'), v_uid, 'PLAN', v_plan.code, v_months, v_owner_type, v_owner, v_price, v_list,
            case when coalesce(v_sale.discount_pct, 0) > 0 then v_sale.id end);
  elsif v_kind = 'XU' then
    if v_pkg.id is null then raise exception 'INVALID_PACKAGE'; end if;
    v_sale := private.best_sale('XU', null);
    v_price := greatest(1000, (round(v_pkg.price_vnd * (100 - coalesce(v_sale.discount_pct, 0)) / 100.0 / 1000) * 1000)::int);
    v_bonus := v_pkg.bonus_xu + floor(v_pkg.xu * coalesce(v_sale.bonus_pct, 0) / 100.0)::int;
    insert into public.orders (id, code, buyer_id, kind, package_id, owner_type, owner_id, amount_vnd, xu, bonus_xu, list_price_vnd, promotion_id)
    values (v_id, 'RH' || nextval('public.order_code_seq'), v_uid, 'XU', v_pkg.id, 'USER', v_uid, v_price, v_pkg.xu, v_bonus, v_pkg.price_vnd,
            case when coalesce(v_sale.discount_pct, 0) > 0 or coalesce(v_sale.bonus_pct, 0) > 0 then v_sale.id end);
  else
    raise exception 'INVALID_ORDER';
  end if;
  return private.order_json((select o from public.orders o where o.id = v_id));
end $$;

-- ---------------------------------------------------------------------
-- Quyền
-- ---------------------------------------------------------------------
revoke all on function private.quest_period_start(text, timestamptz, timestamptz), private.quest_totals_on_reward(),
  private.in_segment(uuid, jsonb), private.valid_reward(jsonb), private.reward_plan_ok(jsonb), private.give_promo_reward(public.promotions, uuid, uuid),
  private.best_sale(text, text) from public, anon, authenticated;
revoke all on function public.my_quests(), public.admin_list_quests(), public.admin_save_quest(jsonb), public.admin_preview_segment(jsonb),
  public.admin_run_grant(jsonb), public.admin_save_promo(jsonb), public.admin_list_promotions(), public.redeem_promo_code(text),
  public.active_sales() from public, anon;
grant execute on function public.my_quests(), public.admin_list_quests(), public.admin_save_quest(jsonb), public.admin_preview_segment(jsonb),
  public.admin_run_grant(jsonb), public.admin_save_promo(jsonb), public.admin_list_promotions(), public.redeem_promo_code(text),
  public.active_sales() to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001004400_system_notice_client_errors.sql
-- ===================================================================
-- 004400: Thông báo hệ thống + nhật ký lỗi phía người dùng.
-- 1. Admin đặt một thông báo chung (thông tin / cảnh báo / bảo trì) hiện ở đầu app cho mọi người, có hạn tự tắt.
--    public.system_notice() đọc được cả khi chưa đăng nhập (màn đăng nhập cũng thấy thông báo bảo trì).
-- 2. App tự gửi lỗi người dùng gặp (mất kết nối máy chủ, máy chủ lỗi, tính năng chưa cập nhật…) về đây, gộp theo
--    mã lỗi mỗi ngày — admin xem ở Quản trị → Hệ thống để biết sự cố trước khi người dùng báo.
--    Chống spam: mỗi người tối đa 30 lần gửi / giờ, toàn hệ thống tối đa 2.000 mã lỗi khác nhau / ngày.
-- Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- 1. Thông báo hệ thống
-- ---------------------------------------------------------------------
create table if not exists private.system_notice (
  id integer primary key default 1 check (id = 1),
  level text not null check (level in ('INFO', 'WARNING', 'MAINTENANCE')),
  title text not null,
  message text,
  until timestamptz,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
revoke all on private.system_notice from public, anon, authenticated;

create or replace function public.system_notice() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('level', n.level, 'title', n.title, 'message', n.message, 'until', n.until, 'updated_at', n.updated_at)
  from private.system_notice n
  where n.id = 1 and (n.until is null or n.until > now())
$$;

create or replace function public.admin_set_system_notice(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  v_level text := upper(coalesce(p->>'level', ''));
  v_title text := trim(coalesce(p->>'title', ''));
  v_msg text := nullif(trim(coalesce(p->>'message', '')), '');
  v_until timestamptz := nullif(p->>'until', '')::timestamptz;
begin
  -- Gửi rỗng / level trống = tắt thông báo
  if p is null or v_level = '' then
    delete from private.system_notice where id = 1;
    insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SYSTEM_NOTICE_OFF', 'system_notice', '{}'::jsonb);
    return null;
  end if;
  if v_level not in ('INFO', 'WARNING', 'MAINTENANCE') then raise exception 'INVALID_LEVEL'; end if;
  if char_length(v_title) not between 2 and 80 then raise exception 'INVALID_TITLE'; end if;
  if char_length(coalesce(v_msg, '')) > 500 then raise exception 'INVALID_MESSAGE'; end if;
  if v_until is not null and v_until <= now() then raise exception 'INVALID_TIME_RANGE'; end if;
  insert into private.system_notice (id, level, title, message, until, updated_by, updated_at)
  values (1, v_level, v_title, v_msg, v_until, v_uid, now())
  on conflict (id) do update set level = excluded.level, title = excluded.title, message = excluded.message,
    until = excluded.until, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SYSTEM_NOTICE', 'system_notice', p);
  return public.system_notice();
end $$;

revoke all on function public.system_notice(), public.admin_set_system_notice(jsonb) from public;
grant execute on function public.system_notice() to anon, authenticated;
revoke all on function public.admin_set_system_notice(jsonb) from anon;
grant execute on function public.admin_set_system_notice(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Nhật ký lỗi phía người dùng (gộp theo ngày + mã lỗi)
-- ---------------------------------------------------------------------
create table if not exists private.client_errors (
  day date not null,
  code text not null,
  kind text not null,
  message text,
  path text,
  hits integer not null default 1,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  primary key (day, code)
);
create table if not exists private.client_error_users (
  day date not null,
  code text not null,
  user_id uuid not null,
  primary key (day, code, user_id)
);
create table if not exists private.client_error_hits (user_id uuid not null, at timestamptz not null default now());
create index if not exists client_error_hits_idx on private.client_error_hits (user_id, at);
revoke all on private.client_errors, private.client_error_users, private.client_error_hits from public, anon, authenticated;

create or replace function public.log_client_error(p_kind text, p_code text, p_message text default null, p_path text default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_day date := private.vn_day(now());
  v_kind text := upper(coalesce(p_kind, ''));
  v_code text := left(coalesce(p_code, ''), 16);
begin
  if v_uid is null then return false; end if;
  if v_kind not in ('OFFLINE', 'NETWORK', 'TIMEOUT', 'AUTH', 'FORBIDDEN', 'NOT_DEPLOYED', 'RATE_LIMIT', 'SERVER', 'UNKNOWN') then return false; end if;
  if v_code !~ '^[A-Z]{3}-[0-9A-Z]{3}$' then return false; end if;
  delete from private.client_error_hits where user_id = v_uid and at < now() - interval '1 hour';
  if (select count(*) from private.client_error_hits h where h.user_id = v_uid) >= 30 then return false; end if;
  if not exists (select 1 from private.client_errors e where e.day = v_day and e.code = v_code)
     and (select count(*) from private.client_errors e where e.day = v_day) >= 2000 then return false; end if;
  insert into private.client_error_hits (user_id) values (v_uid);
  insert into private.client_errors (day, code, kind, message, path)
  values (v_day, v_code, v_kind, left(p_message, 300), left(p_path, 120))
  on conflict (day, code) do update set hits = private.client_errors.hits + 1, last_at = now(),
    message = coalesce(excluded.message, private.client_errors.message), path = coalesce(excluded.path, private.client_errors.path);
  insert into private.client_error_users (day, code, user_id) values (v_day, v_code, v_uid) on conflict do nothing;
  -- Dọn dữ liệu cũ hơn 60 ngày
  delete from private.client_errors where day < v_day - 60;
  delete from private.client_error_users where day < v_day - 60;
  return true;
end $$;

create or replace function public.admin_client_errors(p_days integer default 7) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  v_from date := private.vn_day(now()) - (least(greatest(coalesce(p_days, 7), 1), 60) - 1);
begin
  return (
    select coalesce(jsonb_agg(to_jsonb(r) - 'rn' order by r.last_at desc), '[]'::jsonb)
    from (
      select g.*, row_number() over (order by g.last_at desc) rn
      from (
        select e.code, max(e.kind) kind, (array_agg(e.message order by e.last_at desc))[1] message,
               (array_agg(e.path order by e.last_at desc))[1] path, sum(e.hits)::integer hits,
               (select count(distinct u.user_id) from private.client_error_users u where u.code = e.code and u.day >= v_from)::integer users,
               count(*)::integer days, min(e.first_at) first_at, max(e.last_at) last_at
        from private.client_errors e
        where e.day >= v_from
        group by e.code
      ) g
    ) r
    where r.rn <= 200);
end $$;

revoke all on function public.log_client_error(text, text, text, text), public.admin_client_errors(integer) from public, anon;
grant execute on function public.log_client_error(text, text, text, text), public.admin_client_errors(integer) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001004500_run_synced_notify.sql
-- ===================================================================
-- 004500: "Bài chạy đã về" — chạy bằng đồng hồ / Strava xong là điện thoại báo ngay.
-- Khi một bài từ Strava / Garmin / COROS được cộng thưởng (hoặc được duyệt sau khi chờ xác minh), gửi một thông báo
-- (chuông + đẩy lên điện thoại) kèm km, pace, Xu, XP và số phần thưởng khác; bấm vào mở trang chủ và bật màn nhận thưởng.
-- Bài ghi bằng app không cần (người chạy đang xem màn tổng kết). Bài cũ hơn 2 ngày (nhập lại lịch sử) không báo.
-- Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

create or replace function private.pace_text(p_seconds numeric) returns text
language sql immutable as $$
  select case when p_seconds is null or p_seconds <= 0 or p_seconds > 3600 then null
              else floor(p_seconds / 60)::int || ':' || lpad((round(p_seconds)::int % 60)::text, 2, '0') end
$$;

create or replace function private.run_synced_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_km numeric;
  v_xu numeric;
  v_xp numeric;
  v_more integer;
  v_pace text;
  v_body text;
begin
  if new.user_id is null or new.source_activity_id is null or new.source = 'DIRECT_GPS' then return new; end if;
  if coalesce(new.started_at, now()) < now() - interval '2 days' then return new; end if;
  begin
    v_km := private.run_km(new);
    -- Trigger này tên "zz" nên chạy sau các trigger cộng thưởng khác (thẻ bài chạy, nhiệm vụ, chuỗi, huy hiệu…)
    v_xu := (select coalesce(sum(e.xu), 0) from public.game_events e where e.activity_id = new.id and e.kind <> 'CHEER_IN');
    v_xp := (select coalesce(sum(e.xp), 0) from public.game_events e where e.activity_id = new.id);
    v_more := (select count(*) from public.game_events e where e.activity_id = new.id and e.kind <> 'RUN');
    v_pace := private.pace_text(case when v_km > 0 then coalesce(nullif(new.moving_time_s, 0), new.elapsed_time_s) / v_km end);
    v_body := concat_ws(' · ',
      case when v_pace is not null then 'Pace ' || v_pace || '/km' end,
      case when v_xu > 0 then '+' || replace(trim_scale(round(v_xu, 1))::text, '.', ',') || ' Xu' end,
      case when v_xp > 0 then '+' || round(v_xp)::text || ' XP' end,
      case when v_more > 0 then v_more || ' phần thưởng khác' end);
    perform private.notify(new.user_id, null, 'RUN_SYNCED',
      'Bài chạy ' || replace(to_char(round(v_km, 2), 'FM999990.00'), '.', ',') || ' km đã về RaceHub',
      coalesce(nullif(v_body, ''), 'Mở app để xem tổng kết.'), '/feed?rewards=1', null, true);
  exception when others then
    raise warning 'run_synced_notify % lỗi: % %', new.id, sqlstate, sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists trg_zz_run_synced on public.activities;
create trigger trg_zz_run_synced after update of rewarded_at on public.activities
  for each row when (old.rewarded_at is null and new.rewarded_at is not null)
  execute function private.run_synced_notify();

revoke all on function private.run_synced_notify(), private.pace_text(numeric) from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
