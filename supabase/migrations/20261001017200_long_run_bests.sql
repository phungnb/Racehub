-- 017200: Thành tích Full / Half đầy đủ + nới sai số cự ly + thành tích cá nhân ở hồ sơ runner.
-- • Bài chạy tính là Full / Half khi cự ly từ 98,5% đến 106% mốc (Full: 41,56–44,73 km; Half: 20,78–22,36 km), nên 42,129 km và 42,7 km đều tính; thời gian quy về đúng cự ly.
-- • club_hall_of_fame trả `bests` = TẤT CẢ thành tích của từng người (nhanh nhất trước) thay cho `top3` (bấm tên VĐV trong Đại sảnh để xem).
-- • my_long_bests(): thành tích Full / Half của chính mình (hồ sơ runner), không phụ thuộc CLB. Chạy lại nhiều lần vẫn an toàn.

create or replace function public.club_hall_of_fame(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_year timestamptz := date_trunc('year', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh';
begin
  if not public.club_is_member(p_club_id) then raise exception 'NOT_A_MEMBER'; end if;
  return (
    with mem as (
      select m.user_id from public.club_members m where m.club_id = p_club_id and m.status = 'APPROVED'
    ), runs as (
      select x.id, x.user_id, x.distance_m, x.moving_time_s, x.started_at
        from public.activities x join mem on mem.user_id = x.user_id
       where x.validation_status = 'APPROVED' and x.shared and public.activity_is_countable(x.status, x.validation_status)
         and coalesce(x.distance_m, 0) > 0
    ), finishers as (
      select r.user_id, d.kind, count(*)::int as times, min(r.started_at) as first_at,
             min(case when r.distance_m >= d.need * 0.985 and r.distance_m <= d.need * 1.06 and r.moving_time_s > 0 then round(r.moving_time_s * d.need / r.distance_m) end)::int as best_s
        from runs r join (values ('FM', 42195::numeric), ('HM', 21097.5)) d(kind, need) on r.distance_m >= d.need * 0.985
       group by r.user_id, d.kind
    ), best3 as (
      select t.user_id, t.kind, jsonb_agg(jsonb_build_object('best_s', t.secs, 'at', t.started_at, 'km', round(t.distance_m / 1000, 2), 'activity_id', t.id) order by t.secs) as bests
        from (
          select r.id, r.user_id, d.kind, r.started_at, r.distance_m, round(r.moving_time_s * d.need / r.distance_m)::int as secs,
                 row_number() over (partition by r.user_id, d.kind order by r.moving_time_s * d.need / r.distance_m) as rn
            from runs r join (values ('FM', 42195::numeric), ('HM', 21097.5)) d(kind, need)
              on r.distance_m >= d.need * 0.985 and r.distance_m <= d.need * 1.06 and r.moving_time_s > 0
        ) t group by t.user_id, t.kind
    ), rec as (
      select d.label, d.need, r.user_id, min(round(r.moving_time_s * d.need / r.distance_m))::int as best_s
        from runs r join (values ('5K', 5000::numeric), ('10K', 10000), ('21K', 21097.5), ('42K', 42195)) d(label, need)
          on r.distance_m >= d.need and r.distance_m <= d.need * 1.05 and r.moving_time_s > 0
       group by d.label, d.need, r.user_id
    ), rec_ranked as (
      select rec.*, row_number() over (partition by rec.label order by rec.best_s) as rn from rec
    ), yr as (
      select mem.user_id, coalesce(sum(r.distance_m), 0) as distance_m, count(r.id)::int as runs,
             row_number() over (order by coalesce(sum(r.distance_m), 0) desc, private.display_name(mem.user_id)) as rn
        from mem left join runs r on r.user_id = mem.user_id and r.started_at >= v_year group by mem.user_id
    ), ms as (
      select um.user_id, um.code, um.reached_at, row_number() over (order by um.reached_at desc) as rn
        from public.user_milestones um join mem on mem.user_id = um.user_id
       where um.activity_id is not null
    )
    select jsonb_build_object(
      'marathon', coalesce((select jsonb_agg(jsonb_build_object('user_id', f.user_id, 'name', private.display_name(f.user_id),
                    'avatar_url', p.avatar_url, 'times', f.times, 'first_at', f.first_at, 'best_s', f.best_s,
                    'bests', coalesce(b.bests, '[]'::jsonb)) order by f.first_at)
                  from finishers f join public.profiles p on p.id = f.user_id
                  left join best3 b on b.user_id = f.user_id and b.kind = f.kind where f.kind = 'FM'), '[]'::jsonb),
      'half', coalesce((select jsonb_agg(jsonb_build_object('user_id', f.user_id, 'name', private.display_name(f.user_id),
                    'avatar_url', p.avatar_url, 'times', f.times, 'first_at', f.first_at, 'best_s', f.best_s,
                    'bests', coalesce(b.bests, '[]'::jsonb)) order by f.first_at)
                  from finishers f join public.profiles p on p.id = f.user_id
                  left join best3 b on b.user_id = f.user_id and b.kind = f.kind where f.kind = 'HM'), '[]'::jsonb),
      'records', coalesce((select jsonb_agg(jsonb_build_object('label', rr.label, 'rank', rr.rn, 'user_id', rr.user_id,
                    'name', private.display_name(rr.user_id), 'avatar_url', p.avatar_url, 'best_s', rr.best_s) order by rr.need, rr.rn)
                  from rec_ranked rr join public.profiles p on p.id = rr.user_id where rr.rn <= 3), '[]'::jsonb),
      'year', coalesce((select jsonb_agg(jsonb_build_object('rank', y.rn, 'user_id', y.user_id, 'name', private.display_name(y.user_id),
                    'avatar_url', p.avatar_url, 'distance_m', y.distance_m, 'runs', y.runs) order by y.rn)
                  from yr y join public.profiles p on p.id = y.user_id ), '[]'::jsonb),
      'milestones', coalesce((select jsonb_agg(jsonb_build_object('user_id', ms.user_id, 'name', private.display_name(ms.user_id),
                    'avatar_url', p.avatar_url, 'code', ms.code, 'label', d.label, 'reached_at', ms.reached_at) order by ms.reached_at desc)
                  from ms join public.profiles p on p.id = ms.user_id join private.milestone_defs() d on d.code = ms.code
                 where ms.rn <= 20), '[]'::jsonb),
      'year_start', v_year));
end $$;

revoke all on function private.milestone_defs(), private.countable_km_m(uuid), private.check_milestones(uuid, uuid),
  private.milestones_on_activity() from public, anon, authenticated;
revoke all on function public.club_hall_of_fame(uuid) from public, anon;
grant execute on function public.club_hall_of_fame(uuid) to authenticated;


create or replace function public.my_long_bests() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  return (
    with runs as (
      select x.id, x.title, x.distance_m, x.moving_time_s, x.started_at
        from public.activities x
       where x.user_id = v_uid and x.validation_status = 'APPROVED' and public.activity_is_countable(x.status, x.validation_status)
         and coalesce(x.distance_m, 0) > 0 and coalesce(x.moving_time_s, 0) > 0
    ), t as (
      select d.kind, r.id, r.title, r.started_at, r.distance_m, round(r.moving_time_s * d.need / r.distance_m)::int as secs
        from runs r join (values ('FM', 42195::numeric), ('HM', 21097.5)) d(kind, need)
          on r.distance_m >= d.need * 0.985 and r.distance_m <= d.need * 1.06
    )
    select jsonb_build_object(
      'fm', coalesce((select jsonb_agg(jsonb_build_object('best_s', secs, 'at', started_at, 'km', round(distance_m / 1000, 2), 'activity_id', id, 'title', title) order by secs) from t where kind = 'FM'), '[]'::jsonb),
      'hm', coalesce((select jsonb_agg(jsonb_build_object('best_s', secs, 'at', started_at, 'km', round(distance_m / 1000, 2), 'activity_id', id, 'title', title) order by secs) from t where kind = 'HM'), '[]'::jsonb)));
end $$;
revoke all on function public.my_long_bests() from public, anon;
grant execute on function public.my_long_bests() to authenticated;

notify pgrst, 'reload schema';
