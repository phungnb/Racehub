-- 002800: Gói CLB Pro.
-- • clubs.plan FREE / PRO, pro_until (null = vô thời hạn), slug (link mời riêng /c/<slug>).
-- • Quyền lợi Pro: không giới hạn Quản trị viên (gói miễn phí tối đa 2), link mời riêng dễ nhớ,
--   báo cáo chuyên cần (buổi chạy, km, sự kiện tham gia / điểm danh, đóng quỹ) xuất CSV.
-- • Chưa có thanh toán trong app (chờ ý kiến pháp lý, ADR-011): admin hệ thống bật / tắt Pro, có nhật ký.
-- Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

alter table public.clubs add column if not exists plan text not null default 'FREE';
alter table public.clubs add column if not exists pro_until timestamptz;
alter table public.clubs add column if not exists slug text;
alter table public.clubs drop constraint if exists clubs_plan_chk;
alter table public.clubs add constraint clubs_plan_chk check (plan in ('FREE', 'PRO'));
alter table public.clubs drop constraint if exists clubs_slug_chk;
alter table public.clubs add constraint clubs_slug_chk check (slug is null or slug ~ '^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$');
create unique index if not exists clubs_slug_key on public.clubs (slug) where slug is not null;

create or replace function private.club_is_pro(p_club uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.clubs c where c.id = p_club and c.plan = 'PRO' and (c.pro_until is null or c.pro_until > now()))
$$;

-- ---------------------------------------------------------------------
-- 1. Gói miễn phí: tối đa 2 Quản trị viên (không tính Chủ nhiệm). Chỉ chặn khi THÊM mới, không hạ cấp người đang giữ.
-- ---------------------------------------------------------------------
create or replace function private.club_captain_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'CAPTAIN' and new.status = 'APPROVED'
     and (tg_op = 'INSERT' or (old.role is distinct from 'CAPTAIN' and old.role is distinct from 'OWNER') or old.status is distinct from 'APPROVED')   -- chủ nhiệm cũ khi trao quyền: không tính
     and not private.club_is_pro(new.club_id)
     and (select count(*) from public.club_members m
           where m.club_id = new.club_id and m.role = 'CAPTAIN' and m.status = 'APPROVED' and m.user_id <> new.user_id) >= 2 then
    raise exception 'CAPTAIN_LIMIT';
  end if;
  return new;
end $$;

drop trigger if exists trg_club_captain_limit on public.club_members;
create trigger trg_club_captain_limit before insert or update of role, status on public.club_members
  for each row execute function private.club_captain_limit();

-- ---------------------------------------------------------------------
-- 2. Thông tin gói (thành viên xem), link mời riêng
-- ---------------------------------------------------------------------
create or replace function public.club_plan(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.clubs := (select x from public.clubs x where x.id = p_club_id);
begin
  if c.id is null or not public.club_is_member(c.id) then raise exception 'NOT_A_MEMBER'; end if;
  return jsonb_build_object(
    'plan', c.plan, 'active', private.club_is_pro(c.id), 'pro_until', c.pro_until,
    'slug', case when public.club_is_staff(c.id) or private.club_is_pro(c.id) then c.slug end,
    'captains', (select count(*) from public.club_members m where m.club_id = c.id and m.role = 'CAPTAIN' and m.status = 'APPROVED'),
    'captain_limit', case when private.club_is_pro(c.id) then null else 2 end);
end $$;

create or replace function public.set_club_slug(p_club_id uuid, p_slug text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_slug text := nullif(lower(trim(coalesce(p_slug, ''))), '');
begin
  if not public.club_is_staff(p_club_id) then raise exception 'FORBIDDEN'; end if;
  if v_slug is not null and not private.club_is_pro(p_club_id) then raise exception 'PRO_REQUIRED'; end if;
  if v_slug is not null and (v_slug !~ '^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$'
       or v_slug in ('admin', 'api', 'app', 'racehub', 'club', 'clubs', 'login', 'join', 'races', 'challenges')) then
    raise exception 'INVALID_SLUG';
  end if;
  if v_slug is not null and exists (select 1 from public.clubs c where c.slug = v_slug and c.id <> p_club_id) then
    raise exception 'SLUG_TAKEN';
  end if;
  update public.clubs set slug = v_slug where id = p_club_id;
  return v_slug;
end $$;

-- Link /c/<slug> → mã mời (chỉ khi CLB đang Pro). Người chưa đăng nhập cũng gọi được.
create or replace function public.resolve_club_slug(p_slug text) returns text
language sql stable security definer set search_path = public as $$
  select c.invite_code from public.clubs c
   where c.slug = lower(trim(p_slug)) and c.plan = 'PRO' and (c.pro_until is null or c.pro_until > now())
$$;

-- ---------------------------------------------------------------------
-- 3. Báo cáo chuyên cần (Pro): mỗi thành viên — buổi chạy, km, sự kiện đăng ký đi / điểm danh, khoản quỹ đã đóng
-- ---------------------------------------------------------------------
create or replace function public.club_attendance_report(p_club_id uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.club_is_staff(p_club_id) then raise exception 'FORBIDDEN'; end if;
  if not private.club_is_pro(p_club_id) then raise exception 'PRO_REQUIRED'; end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '400 days' then raise exception 'INVALID_TIME_RANGE'; end if;
  return jsonb_build_object(
    'events', (select count(*) from public.club_events e where e.club_id = p_club_id and e.status = 'SCHEDULED'
                 and e.starts_at >= p_from and e.starts_at < p_to),
    'dues', (select count(*) from public.club_dues d where d.club_id = p_club_id and d.created_at >= p_from and d.created_at < p_to),
    'members', (select coalesce(jsonb_agg(s.j order by (s.j->>'runs')::int desc, s.j->>'display_name'), '[]'::jsonb) from (
      select jsonb_build_object(
        'user_id', m.user_id, 'display_name', p.display_name, 'role', m.role, 'joined_at', m.joined_at,
        'runs', (select count(*) from public.activities a where a.user_id = m.user_id and a.validation_status = 'APPROVED'
                   and coalesce(a.status, '') <> 'DELETED' and a.started_at >= p_from and a.started_at < p_to),
        'km', round(coalesce((select sum(a.distance_m) from public.activities a where a.user_id = m.user_id and a.validation_status = 'APPROVED'
                   and coalesce(a.status, '') <> 'DELETED' and a.started_at >= p_from and a.started_at < p_to), 0) / 1000.0, 1),
        'events_going', (select count(*) from public.club_event_rsvps r join public.club_events e on e.id = r.event_id
                          where r.user_id = m.user_id and e.club_id = p_club_id and r.status = 'GOING'
                            and e.starts_at >= p_from and e.starts_at < p_to),
        'events_checked_in', (select count(*) from public.club_event_rsvps r join public.club_events e on e.id = r.event_id
                               where r.user_id = m.user_id and e.club_id = p_club_id and r.checked_in_at is not null
                                 and e.starts_at >= p_from and e.starts_at < p_to),
        'dues_paid', (select count(*) from public.club_due_payments dp join public.club_dues d on d.id = dp.due_id
                       where dp.user_id = m.user_id and d.club_id = p_club_id and dp.status in ('CONFIRMED', 'EXEMPT')
                         and d.created_at >= p_from and d.created_at < p_to)) as j
        from public.club_members m join public.profiles p on p.id = m.user_id
       where m.club_id = p_club_id and m.status = 'APPROVED') s));
end $$;

-- ---------------------------------------------------------------------
-- 4. Admin hệ thống: tìm CLB, bật / tắt Pro (có nhật ký + báo ban quản trị CLB)
-- ---------------------------------------------------------------------
create or replace function public.admin_list_clubs(p_query text default '') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url, 'accent_color', c.accent_color,
            'member_count', c.member_count, 'plan', c.plan, 'pro_until', c.pro_until, 'slug', c.slug, 'active', private.club_is_pro(c.id))
            order by (c.plan = 'PRO') desc, c.member_count desc), '[]'::jsonb)
    from (select x.*, row_number() over (order by (x.plan = 'PRO') desc, x.member_count desc) as rn from public.clubs x
           where coalesce(trim(p_query), '') = '' or x.name ilike '%' || trim(p_query) || '%' or x.slug = lower(trim(p_query))) c
   where c.rn <= 50);
end $$;

create or replace function public.admin_set_club_plan(p_club_id uuid, p_plan text, p_until timestamptz, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.clubs := (select x from public.clubs x where x.id = p_club_id);
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  if c.id is null then raise exception 'CLUB_NOT_FOUND'; end if;
  if upper(coalesce(p_plan, '')) not in ('FREE', 'PRO') then raise exception 'INVALID_PLAN'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  update public.clubs set plan = upper(p_plan), pro_until = case when upper(p_plan) = 'PRO' then p_until end where id = c.id;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'SET_CLUB_PLAN', c.id::text, jsonb_build_object('plan', upper(p_plan), 'until', p_until, 'reason', trim(p_reason), 'old_plan', c.plan));
  perform private.notify_club(c.id, true, 'CLUB_PRO',
    case when upper(p_plan) = 'PRO' then c.name || ' đã lên gói CLB Pro' else c.name || ' trở về gói miễn phí' end,
    case when upper(p_plan) = 'PRO' then 'Mở khóa: không giới hạn quản trị viên, link mời riêng, báo cáo chuyên cần.'
         else 'Các tính năng Pro tạm khóa. Dữ liệu vẫn được giữ nguyên.' end,
    '/clubs/' || c.id || '/settings', v_uid);
  return jsonb_build_object('plan', upper(p_plan), 'pro_until', case when upper(p_plan) = 'PRO' then p_until end);
end $$;

-- ---------------------------------------------------------------------
-- 5. Quyền
-- ---------------------------------------------------------------------
revoke all on function private.club_is_pro(uuid), private.club_captain_limit() from public, anon, authenticated;
revoke all on function public.club_plan(uuid), public.set_club_slug(uuid, text), public.club_attendance_report(uuid, timestamptz, timestamptz),
  public.admin_list_clubs(text), public.admin_set_club_plan(uuid, text, timestamptz, text), public.resolve_club_slug(text) from public;
grant execute on function public.club_plan(uuid), public.set_club_slug(uuid, text), public.club_attendance_report(uuid, timestamptz, timestamptz),
  public.admin_list_clubs(text), public.admin_set_club_plan(uuid, text, timestamptz, text) to authenticated;
grant execute on function public.resolve_club_slug(text) to anon, authenticated;

notify pgrst, 'reload schema';
