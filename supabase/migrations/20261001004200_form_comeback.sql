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
