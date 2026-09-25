-- 005400: Thử thách — thể lệ bổ sung + danh sách gọn.
-- • Thể lệ bổ sung (không bắt buộc) do người tạo điền: thưởng, phạt, lệ phí / đóng góp, điều kiện tham gia, liên hệ BTC,
--   và tối đa 5 mục tự đặt tên. Sửa được khi thử thách còn mở; nếu đã bắt đầu thì người tham gia được báo "BTC cập nhật thể lệ".
--   RaceHub không thu tiền hộ: lệ phí / phạt (nếu có) do BTC tự thu, app chỉ hiển thị.
-- • Danh sách thử thách: thử thách ĐÃ HỦY không còn nằm ở tab "Của tôi", "Khám phá", "CLB" (chỉ còn trong "Đã kết thúc").
--   Giải chạy ảo đã hủy cũng rời tab "Của tôi" (vẫn xem được ở "Đã qua").
-- Cần 000600, 002700. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

alter table public.challenges add column if not exists rules_info jsonb not null default '{}'::jsonb;
alter table public.challenges add column if not exists rules_updated_at timestamptz;

-- Chuẩn hóa thể lệ: chỉ giữ khóa hợp lệ, cắt độ dài, bỏ mục rỗng
create or replace function private.challenge_rules_clean(p jsonb) returns jsonb
language plpgsql immutable as $$
declare v_out jsonb := '{}'::jsonb; k text; v text; n int;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return v_out; end if;
  foreach k in array array['prizes', 'penalties', 'fees', 'conduct', 'contact'] loop
    v := nullif(trim(coalesce(p->>k, '')), '');
    n := case k when 'contact' then 200 when 'fees' then 600 else 1500 end;
    if v is not null then v_out := v_out || jsonb_build_object(k, left(v, n)); end if;
  end loop;
  if jsonb_typeof(p->'custom') = 'array' then
    if jsonb_array_length(p->'custom') > 5 then raise exception 'TOO_MANY_RULES'; end if;
    v_out := v_out || jsonb_build_object('custom', (
      select coalesce(jsonb_agg(jsonb_build_object('title', left(trim(e->>'title'), 60), 'body', left(trim(e->>'body'), 1500)) order by o), '[]'::jsonb)
        from jsonb_array_elements(p->'custom') with ordinality t(e, o)
       where char_length(trim(coalesce(e->>'title', ''))) >= 2 and char_length(trim(coalesce(e->>'body', ''))) >= 1));
    if v_out->'custom' = '[]'::jsonb then v_out := v_out - 'custom'; end if;
  end if;
  return v_out;
end $$;

create or replace function public.set_challenge_rules(p_challenge_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
  v_new jsonb := private.challenge_rules_clean(p);
  r record;
begin
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if c.created_by is distinct from v_uid and not (c.target_club_id is not null and public.club_is_staff(c.target_club_id))
     and not public.is_system_admin() then
    raise exception 'FORBIDDEN';
  end if;
  if c.status <> 'ACTIVE' or c.end_date <= now() then raise exception 'CHALLENGE_CLOSED'; end if;
  if v_new = c.rules_info then return v_new; end if;
  update public.challenges set rules_info = v_new, rules_updated_at = now() where id = c.id;
  -- Đã bắt đầu: báo người tham gia (trừ người sửa)
  if now() >= c.start_date then
    for r in select p2.profile_id from public.challenge_participants p2
              where p2.challenge_id = c.id and p2.status <> 'LEFT' and p2.profile_id <> v_uid loop
      perform private.notify(r.profile_id, c.target_club_id, 'CHALLENGE_RULES', 'BTC cập nhật thể lệ: ' || c.title,
        'Xem lại phần Luật chơi để nắm thể lệ mới.', '/challenges/' || c.id, v_uid, false);
    end loop;
  end if;
  return v_new;
end $$;

-- Danh sách thử thách: như 000600, bỏ thử thách đã hủy khỏi tab Của tôi / Khám phá / CLB; giới hạn 60 bằng row_number
create or replace function public.list_challenges(p_tab text default 'MINE', p_club_id uuid default null)
returns table (
  id uuid, title text, description text, format text, objective text, game_mode text, target_value numeric,
  start_date timestamptz, end_date timestamptz, status text, target_audience text, target_club_id uuid,
  club_name text, club_accent text, reward_xu numeric, participant_count integer, max_slots integer,
  my_status text, my_score numeric, my_rank integer, total_score numeric, created_by uuid
)
language sql stable security definer set search_path = public as $$
  with base as (
    select c.*,
           (select count(*)::int from public.challenge_participants p where p.challenge_id = c.id and p.status <> 'LEFT') as n,
           (select coalesce(sum(p.current_progress), 0) from public.challenge_participants p where p.challenge_id = c.id and p.status <> 'LEFT') as total,
           me.status as my_status, me.current_progress as my_score,
           case when me.id is not null then (select count(*)::int + 1 from public.challenge_participants o
                  where o.challenge_id = c.id and o.status <> 'LEFT' and o.current_progress > me.current_progress) end as my_rank
      from public.challenges c
      left join public.challenge_participants me on me.challenge_id = c.id and me.profile_id = auth.uid()
     where c.status in ('ACTIVE', 'FINISHED', 'CANCELLED')
       and case upper(coalesce(p_tab, 'MINE'))
         when 'MINE' then c.status <> 'CANCELLED'
                          and ((me.id is not null and me.status <> 'LEFT') or c.created_by = auth.uid())
                          and (c.status = 'ACTIVE' or c.end_date > now() - interval '30 days')
         when 'DISCOVER' then c.target_audience = 'PUBLIC' and c.status = 'ACTIVE' and c.end_date > now()
                          and (c.format <> 'TEAM' or c.start_date > now())
                          and (me.id is null or me.status = 'LEFT')
         when 'CLUB' then c.status <> 'CANCELLED'
                          and c.target_audience = 'CLUB_ONLY' and public.club_is_member(c.target_club_id)
                          and (p_club_id is null or c.target_club_id = p_club_id)
                          and (c.status = 'ACTIVE' or c.end_date > now() - interval '60 days')
         when 'ENDED' then me.id is not null and (c.status <> 'ACTIVE' or c.end_date <= now())
         else false end
  ), ranked as (
    select b.*, row_number() over (
             order by (b.status = 'ACTIVE' and b.end_date > now()) desc,
                      case when upper(coalesce(p_tab, 'MINE')) = 'DISCOVER' then -b.n else 0 end,
                      b.end_date) as rn
      from base b
  )
  select b.id, b.title, b.description, b.format, b.objective, b.game_mode, b.target_value, b.start_date, b.end_date,
         b.status, b.target_audience, b.target_club_id, cl.name, cl.accent_color, b.reward_xu, b.n, b.max_slots,
         b.my_status, b.my_score, b.my_rank, round(b.total, 2), b.created_by
    from ranked b left join public.clubs cl on cl.id = b.target_club_id
   where b.rn <= 60
   order by b.rn
$$;

-- Giải chạy ảo: như 002700, tab "Của tôi" bỏ giải đã hủy
create or replace function public.list_races(p_scope text default 'UPCOMING') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return (select coalesce(jsonb_agg(private.race_card(t.race) order by
            case when upper(p_scope) = 'PAST' then extract(epoch from (t.race).end_at) * -1 else extract(epoch from (t.race).start_at) end), '[]'::jsonb)
    from (select x as race, row_number() over (order by x.start_at desc) as rn from public.virtual_races x
           where private.race_visible(x)
             and case upper(coalesce(p_scope, 'UPCOMING'))
                   when 'MINE' then x.status <> 'CANCELLED'
                                and exists (select 1 from public.race_registrations g where g.race_id = x.id and g.user_id = auth.uid() and g.status <> 'WITHDRAWN')
                   when 'PAST' then x.end_at < now()
                   else x.end_at >= now() and x.status = 'PUBLISHED' end) t
   where t.rn <= 100);
end $$;

revoke all on function private.challenge_rules_clean(jsonb) from public, anon, authenticated;
revoke all on function public.set_challenge_rules(uuid, jsonb) from public, anon;
grant execute on function public.set_challenge_rules(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
