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
