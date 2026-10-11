-- Bảng xếp hạng mục tiêu: % hiển thị theo km chạy thực tế (distance_m), không bị chặn ở mức trần được tính.
-- Xếp hạng vẫn theo km được tính (counted_km, đã áp trần); chỉ thêm tiêu chí phụ là km thực tế khi bằng nhau.
create or replace function public.challenge_pledge_board(p_challenge_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
begin
  if c.id is null or not public.challenge_visible(c.id) then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  return jsonb_build_object(
    'can_manage', private.challenge_is_manager(c),
    'missing', (select count(*) from public.challenge_participants x
                 where x.challenge_id = c.id and x.status <> 'LEFT' and x.pledge_km is null),
    'members', (select coalesce(jsonb_agg(jsonb_build_object(
        'participant_id', x.id, 'user_id', x.profile_id, 'display_name', pr.display_name, 'avatar_url', pr.avatar_url,
        'team_id', x.team_id, 'pledge_km', x.pledge_km, 'km', round(x.distance_m / 1000.0, 2), 'counted_km', x.current_progress,
        'pct', case when x.pledge_km > 0 then round(x.distance_m / 1000.0 / x.pledge_km * 100, 1) end,
        'completed', x.completed_at is not null)
        order by case when x.pledge_km > 0 then x.current_progress / x.pledge_km else -1 end desc, x.current_progress desc, x.distance_m desc, pr.display_name), '[]'::jsonb)
      from public.challenge_participants x join public.profiles pr on pr.id = x.profile_id
     where x.challenge_id = c.id and x.status <> 'LEFT'),
    'teams', case when c.format = 'TEAM' then (
      select coalesce(jsonb_agg(jsonb_build_object(
          'team_id', t2.id, 'name', t2.name, 'color', t2.color,
          'members', (select count(*) from public.challenge_participants x where x.team_id = t2.id and x.status <> 'LEFT'),
          'pledge_total', (select coalesce(sum(x.pledge_km), 0) from public.challenge_participants x where x.team_id = t2.id and x.status <> 'LEFT'),
          'counted_total', (select coalesce(sum(x.current_progress), 0) from public.challenge_participants x where x.team_id = t2.id and x.status <> 'LEFT'))
          order by t2.position), '[]'::jsonb)
        from public.challenge_teams t2 where t2.challenge_id = c.id) end);
end $$;

notify pgrst, 'reload schema';
