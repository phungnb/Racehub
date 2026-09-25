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
