-- 010900: BXH GIẢI CHẠY THEO TỪNG CỰ LY — AI HOÀN THÀNH, AI CHƯA; ĐỔI "MỐC" → "MỤC TIÊU"
--   • race_results_v2(race, cự ly): mọi VĐV đã đăng ký cự ly đó (trừ người rút tên): người hoàn thành xếp theo thành tích,
--     người chưa hoàn thành xếp sau; kèm số người đăng ký / hoàn thành. Ai xem được giải thì xem được bảng.
--   • Thử thách tuần đã tạo: câu mô tả "Chọn mốc km…" đổi thành "Chọn mục tiêu km…" (cả bài đăng trên bảng tin CLB).
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create or replace function public.race_results_v2(p_race_id uuid, p_distance_km numeric) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r public.virtual_races := (select x from public.virtual_races x where x.id = p_race_id);
  v_km numeric := round(p_distance_km, 2);
begin
  if r.id is null or not private.race_visible(r) then raise exception 'RACE_NOT_FOUND'; end if;
  return jsonb_build_object(
    'registered', (select count(*) from public.race_registrations g where g.race_id = r.id and g.distance_km = v_km and g.status <> 'WITHDRAWN'),
    'finished', (select count(*) from public.race_registrations g where g.race_id = r.id and g.distance_km = v_km and g.status = 'FINISHED'),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
               'rank', case when t.status = 'FINISHED' then t.rn end, 'user_id', t.user_id, 'display_name', p.display_name,
               'avatar_url', p.avatar_url, 'bib', t.bib, 'status', t.status,
               'finish_time_s', t.finish_time_s, 'pace_s', case when t.finish_time_s is not null then round(t.finish_time_s / t.distance_km) end,
               'finished_at', t.finished_at, 'activity_id', t.finish_activity_id, 'is_me', t.user_id = auth.uid())
               order by (t.status <> 'FINISHED'), t.rn, t.bib), '[]'::jsonb)
               from (select g.*, row_number() over (order by (g.status <> 'FINISHED'), g.finish_time_s nulls last, g.finished_at, g.bib) as rn
                       from public.race_registrations g
                      where g.race_id = r.id and g.distance_km = v_km and g.status <> 'WITHDRAWN') t
               join public.profiles p on p.id = t.user_id
              where t.rn <= 1000 or t.user_id = auth.uid())
  );
end $$;

revoke all on function public.race_results_v2(uuid, numeric) from public, anon;
grant execute on function public.race_results_v2(uuid, numeric) to authenticated;

-- "Mốc" → "Mục tiêu" trong mô tả thử thách tuần đã tạo trước đây
update public.challenges
   set description = replace(replace(description, 'Chọn mốc km của bạn cho tuần này', 'Chọn mục tiêu km của bạn cho tuần này'),
                             'Hoàn thành mốc đã đăng ký là chiến thắng', 'Hoàn thành mục tiêu đã đăng ký là chiến thắng')
 where description like '%Chọn mốc km của bạn cho tuần này%' or description like '%Hoàn thành mốc đã đăng ký%';
update public.club_posts
   set body = replace(replace(body, 'Chọn mốc km của bạn cho tuần này', 'Chọn mục tiêu km của bạn cho tuần này'),
                      'Hoàn thành mốc đã đăng ký là chiến thắng', 'Hoàn thành mục tiêu đã đăng ký là chiến thắng')
 where kind = 'CHALLENGE' and (body like '%Chọn mốc km của bạn cho tuần này%' or body like '%Hoàn thành mốc đã đăng ký%');
