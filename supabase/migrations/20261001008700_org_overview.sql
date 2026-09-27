-- 008700: Tổng quan tổ chức — màn đầu tiên khi vào tổ chức (chuẩn như bảng điều khiển phong trào của doanh nghiệp).
-- org_overview(org, từ, đến) trong khoảng ngày bất kỳ (≤ 400 ngày):
--   • kpi: số người, số người đã chạy, tỷ lệ tham gia, tổng km, số buổi, km bình quân / người;
--   • units: từng đơn vị (có parent_id để app cộng dồn lên cấp trên): thành viên, đã chạy, km — BXH phòng ban theo tổng và bình quân;
--   • clubs: CLB thuộc tổ chức (liên đoàn): thành viên, đã chạy, km;
--   • top: 10 người chạy nhiều km nhất (chế độ riêng tư: thành viên thường không thấy danh sách, chỉ thấy thứ hạng của mình);
--   • me: km / buổi / hạng của chính mình; days: km theo ngày (giờ Việt Nam) để vẽ biểu đồ.
-- Chỉ tính bài hợp lệ, đang chia sẻ, không bị tự duyệt vì nghi vấn (cùng luật chiến dịch — private.org_person_stats).
-- Ai xem được: thành viên tổ chức (trực tiếp hoặc qua CLB thuộc tổ chức), admin hệ thống.
-- Cần 008300, 008400, 008500. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create or replace function public.org_overview(p_org uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  o public.organizations := (select x from public.organizations x where x.id = p_org);
  v_uid uuid := auth.uid();
  v_admin boolean := public.org_is_admin(p_org) or public.is_system_admin();
  v_hide boolean;
begin
  if o.id is null then raise exception 'ORG_NOT_FOUND'; end if;
  if not (v_admin or public.org_is_member(p_org) or exists (select 1 from private.org_people(p_org) pp where pp.user_id = v_uid)) then
    raise exception 'NOT_A_MEMBER';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '400 days' then raise exception 'INVALID_TIME_RANGE'; end if;
  v_hide := o.privacy_mode and not v_admin;

  return (
    with st as (
      select pp.user_id, pp.unit_id, pp.direct, s.km, s.runs, s.active_days
        from private.org_people(p_org) pp
        cross join lateral private.org_person_stats(pp.user_id, p_from, p_to, 0) s
    ), ranked as (
      select st.*, (rank() over (order by st.km desc))::int as rnk from st
    )
    select jsonb_build_object(
      'kpi', (select jsonb_build_object('people', count(*)::int, 'active', count(*) filter (where runs > 0)::int,
                                        'km', coalesce(round(sum(km), 1), 0), 'runs', coalesce(sum(runs), 0)::int,
                                        'avg_km', case when count(*) > 0 then round(coalesce(sum(km), 0) / count(*), 2) else 0 end)
                from st),
      'units', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'parent_id', u.parent_id,
                                          'members', coalesce(x.members, 0), 'active', coalesce(x.active, 0), 'km', coalesce(x.km, 0))
                                          order by u.sort, u.name)
                           from public.org_units u
                           left join (select st.unit_id, count(*)::int as members, count(*) filter (where st.runs > 0)::int as active,
                                             round(sum(st.km), 1) as km
                                        from st where st.unit_id is not null group by st.unit_id) x on x.unit_id = u.id
                          where u.org_id = p_org), '[]'::jsonb),
      'clubs', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url,
                                          'members', y.members, 'active', y.active, 'km', y.km) order by y.km desc)
                           from (select oc.club_id, count(distinct st.user_id)::int as members,
                                        count(distinct st.user_id) filter (where st.runs > 0)::int as active, round(coalesce(sum(st.km), 0), 1) as km
                                   from public.org_clubs oc
                                   join public.club_members cm on cm.club_id = oc.club_id and cm.status = 'APPROVED'
                                   join st on st.user_id = cm.user_id
                                  where oc.org_id = p_org and oc.status = 'APPROVED'
                                  group by oc.club_id) y
                           join public.clubs c on c.id = y.club_id), '[]'::jsonb),
      'top', case when v_hide then '[]'::jsonb else coalesce((
               select jsonb_agg(jsonb_build_object('rank', r.rnk, 'user_id', r.user_id, 'name', private.display_name(r.user_id),
                                                   'avatar_url', pr.avatar_url, 'unit_name', u.name, 'km', r.km, 'runs', r.runs)
                                order by r.rnk, private.display_name(r.user_id))
                 from ranked r
                 join public.profiles pr on pr.id = r.user_id
                 left join public.org_units u on u.id = r.unit_id
                where r.rnk <= 10 and r.km > 0), '[]'::jsonb) end,
      'me', (select jsonb_build_object('rank', r.rnk, 'km', r.km, 'runs', r.runs, 'active_days', r.active_days)
               from ranked r where r.user_id = v_uid),
      'days', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'km', d.km) order by d.day)
                          from (select (a.started_at at time zone 'Asia/Ho_Chi_Minh')::date as day, round(sum(a.distance_m) / 1000.0, 1) as km
                                  from public.activities a
                                  join st on st.user_id = a.user_id
                                 where a.validation_status = 'APPROVED' and a.shared and not a.review_skipped
                                   and public.activity_is_countable(a.status, a.validation_status)
                                   and a.started_at >= p_from and a.started_at < p_to
                                 group by 1) d), '[]'::jsonb),
      'privacy_mode', o.privacy_mode, 'hidden', v_hide, 'is_admin', v_admin, 'unit_label', o.unit_label)
  );
end $$;

revoke all on function public.org_overview(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.org_overview(uuid, timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';
