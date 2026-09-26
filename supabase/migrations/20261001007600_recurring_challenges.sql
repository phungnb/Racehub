-- 007600: Thử thách tự lặp lại (hằng tuần / tháng / quý / năm) — học từ Tucana.
-- Ban quản trị tạo "Thử thách tuần của CLB" MỘT lần, bật lặp lại; trước khi kỳ hiện tại kết thúc ~1,5 ngày, cron hằng
-- ngày (/api/cron/challenges) tự tạo kỳ kế tiếp với cùng luật chơi (luật km/pace, mục tiêu tự đăng ký, nhịp tim, thể lệ).
-- Kỳ mới được tạo ĐÚNG như người tạo tự bấm tạo (gọi create_challenge_v2 dưới danh nghĩa người tạo): kiểm tra quyền
-- ban quản trị CLB, tính phí theo quy mô, dùng lượt miễn phí VIP / CLB Pro, trừ quỹ — không có đường tắt miễn phí.
-- Không tạo được (hết Xu / quỹ, không còn là ban quản trị…) → ghi lý do + báo người tạo; ngày sau cron thử lại.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT. Chạy lại nhiều lần vẫn an toàn.

alter table public.challenges add column if not exists recurrence text not null default 'NONE';
alter table public.challenges add column if not exists series_id uuid;
alter table public.challenges add column if not exists occurrence integer not null default 1;
alter table public.challenges add column if not exists recur_next_id uuid;
alter table public.challenges add column if not exists recur_error text;
alter table public.challenges drop constraint if exists challenges_recurrence_check;
alter table public.challenges add constraint challenges_recurrence_check check (recurrence in ('NONE', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'));
create index if not exists challenges_recurring_idx on public.challenges (end_date) where recurrence <> 'NONE' and recur_next_id is null;

create or replace function private.recurrence_step(p_recurrence text) returns interval
language sql immutable as $$
  select case p_recurrence when 'WEEKLY' then interval '7 days' when 'MONTHLY' then interval '1 month'
                           when 'QUARTERLY' then interval '3 months' when 'YEARLY' then interval '1 year' end
$$;

-- Bật / tắt lặp lại (ban quản trị thử thách). Tắt thì kỳ hiện tại vẫn chạy bình thường, chỉ không sinh kỳ mới.
create or replace function public.set_challenge_recurrence(p_challenge_id uuid, p_recurrence text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id for update);
  v_rec text := upper(coalesce(p_recurrence, 'NONE'));
begin
  perform private.require_uid();
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if not private.challenge_is_manager(c) then raise exception 'FORBIDDEN'; end if;
  if v_rec not in ('NONE', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY') then raise exception 'INVALID_RECURRENCE'; end if;
  if v_rec <> 'NONE' and c.format = 'DUEL' then raise exception 'RECURRENCE_NOT_SUPPORTED'; end if;
  if v_rec <> 'NONE' and c.status = 'CANCELLED' then raise exception 'CHALLENGE_CLOSED'; end if;
  if v_rec <> 'NONE' and c.end_date - c.start_date > private.recurrence_step(v_rec) then raise exception 'RECURRENCE_TOO_SHORT'; end if;
  update public.challenges set recurrence = v_rec, series_id = coalesce(series_id, id), recur_error = null where id = c.id;
  return jsonb_build_object('recurrence', v_rec, 'series_id', coalesce(c.series_id, c.id));
end $$;

-- Tạo kỳ kế tiếp cho một thử thách lặp lại (gọi từ cron, quyền service_role)
create or replace function private.spawn_next_occurrence(p_id uuid) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  c public.challenges := (select x from public.challenges x where x.id = p_id for update);
  v_step interval;
  v_start timestamptz;
  v_end timestamptz;
  v_base text;
  v_payload jsonb;
  v_old_claims text := current_setting('request.jwt.claims', true);
  v_old_sub text := current_setting('request.jwt.claim.sub', true);
  v_new uuid;
  v_n integer := 0;
begin
  if c.id is null or c.recurrence = 'NONE' or c.recur_next_id is not null or c.status = 'CANCELLED' or c.created_by is null then return null; end if;
  v_step := private.recurrence_step(c.recurrence);
  v_start := c.start_date + v_step;
  v_end := c.end_date + v_step;
  while v_end <= now() + interval '1 hour' and v_n < 60 loop          -- bỏ lỡ nhiều kỳ (cron dừng): nhảy tới kỳ còn hiệu lực
    v_start := v_start + v_step; v_end := v_end + v_step; v_n := v_n + 1;
  end loop;
  if c.format = 'TEAM' and v_start < now() + interval '15 minutes' then v_start := now() + interval '15 minutes'; end if;
  v_base := regexp_replace(c.title, '\s*·\s*Kỳ \d+$', '');
  v_payload := jsonb_build_object(
    'title', left(v_base, 108) || ' · Kỳ ' || (c.occurrence + 1), 'description', c.description, 'format', c.format,
    'objective', c.objective, 'game_mode', c.game_mode, 'target_value', c.target_value, 'min_km', c.min_km,
    'min_pace', c.min_pace, 'max_pace', c.max_pace, 'daily_cap_km', c.daily_cap_km,
    'start_date', v_start, 'end_date', v_end, 'max_slots', c.max_slots, 'audience', c.target_audience,
    'club_id', c.target_club_id, 'team_size', c.fixed_team_size, 'reward_xu', c.reward_xu,
    'reward_source', c.reward_source, 'reward_split', c.reward_split,
    'team_names', coalesce((select jsonb_agg(t.name order by t.position) from public.challenge_teams t where t.challenge_id = c.id), '[]'::jsonb));

  -- Tạo như chính người tạo bấm tạo: mọi kiểm tra quyền / phí / lượt / quỹ giữ nguyên
  perform set_config('request.jwt.claims', json_build_object('sub', c.created_by, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', c.created_by::text, true);
  begin
    v_new := (public.create_challenge_v2(v_payload, 'recur:' || c.id)->>'challenge_id')::uuid;
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_old_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(v_old_sub, ''), true);
    if c.recur_error is distinct from sqlerrm then
      update public.challenges set recur_error = left(sqlerrm, 200) where id = c.id;
      perform private.notify(c.created_by, c.target_club_id, 'CHALLENGE_RECUR_FAILED', 'Chưa tạo được kỳ mới: ' || left(c.title, 80),
        case when sqlerrm like '%INSUFFICIENT%' then 'Ví / quỹ CLB không đủ Xu cho phí tạo. Nạp thêm hoặc giảm quy mô — hệ thống thử lại mỗi ngày.'
             when sqlerrm like '%FORBIDDEN%' then 'Bạn không còn là ban quản trị CLB. Tắt lặp lại hoặc nhờ ban quản trị tạo.'
             else 'Hệ thống thử lại mỗi ngày. Lý do: ' || left(sqlerrm, 120) end,
        '/challenges/' || c.id, null, true);
    end if;
    return null;
  end;
  perform set_config('request.jwt.claims', coalesce(v_old_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_old_sub, ''), true);

  -- Chép phần thiết lập thêm (nhịp tim, mục tiêu tự đăng ký, thể lệ) và nối chuỗi kỳ
  update public.challenges n set
    require_hr = c.require_hr, rules_info = c.rules_info, rules_updated_at = case when c.rules_info <> '{}'::jsonb then now() end,
    pledge_enabled = c.pledge_enabled, pledge_options = c.pledge_options, pledge_min_km = c.pledge_min_km,
    pledge_max_km = c.pledge_max_km, pledge_cap_pct = c.pledge_cap_pct, pledge_team_size = c.pledge_team_size,
    game_mode = case when c.pledge_enabled and c.format = 'TEAM' then 'TEAM_SUM' else n.game_mode end,
    recurrence = c.recurrence, series_id = coalesce(c.series_id, c.id), occurrence = c.occurrence + 1
  where n.id = v_new;
  update public.challenges set recur_next_id = v_new, recur_error = null, series_id = coalesce(series_id, id) where id = c.id;
  return v_new;
end $$;

create or replace function public.spawn_recurring_challenges() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in select id from public.challenges
            where recurrence <> 'NONE' and recur_next_id is null and status <> 'CANCELLED'
              and end_date <= now() + interval '36 hours'
            order by end_date loop
    if private.spawn_next_occurrence(r.id) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Danh sách các kỳ trong một chuỗi (để xem lại kết quả kỳ trước)
create or replace function public.challenge_series(p_challenge_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'occurrence', x.occurrence, 'status', x.status,
                                              'start_date', x.start_date, 'end_date', x.end_date) order by x.occurrence desc), '[]'::jsonb)
    from public.challenges x
   where x.series_id = (select coalesce(c.series_id, c.id) from public.challenges c where c.id = p_challenge_id)
     and x.status <> 'CANCELLED'
$$;

revoke all on function private.recurrence_step(text), private.spawn_next_occurrence(uuid) from public, anon, authenticated;
revoke all on function public.set_challenge_recurrence(uuid, text), public.challenge_series(uuid), public.spawn_recurring_challenges() from public, anon;
grant execute on function public.set_challenge_recurrence(uuid, text), public.challenge_series(uuid) to authenticated;
revoke all on function public.spawn_recurring_challenges() from authenticated;
grant execute on function public.spawn_recurring_challenges() to service_role;

notify pgrst, 'reload schema';
