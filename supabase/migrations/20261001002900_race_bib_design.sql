-- 002900: BIB điện tử do ban tổ chức tự thiết kế.
-- • virtual_races.bib_design: mẫu (classic / stripe / neon / minimal), màu, logo giải, ảnh nền, khẩu hiệu,
--   tối đa 4 nhà tài trợ, bật / tắt tên VĐV và mã QR. Ảnh nằm trong kho race-media/<race_id>/<user_id>/…
-- • Mã QR trên BIB mở trang giải kèm ?bib=… → race_bib_lookup xác thực VĐV (tên, cự ly, trạng thái, thành tích).
-- Cần file 002700. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

alter table public.virtual_races add column if not exists bib_design jsonb;

-- Hàm công khai (dùng trong chính sách kho ảnh): người gọi có quản lý giải này không
create or replace function public.can_manage_race(p_race_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select private.race_is_manager(x) from public.virtual_races x where x.id = p_race_id), false)
$$;

-- ---------------------------------------------------------------------
-- 1. Kho ảnh BIB: race-media/<race_id>/<user_id>/<tên file>; chỉ ban tổ chức giải đó tải lên
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('race-media', 'race-media', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists race_media_insert on storage.objects;
create policy race_media_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'race-media'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.can_manage_race(((storage.foldername(name))[1])::uuid)
  );
drop policy if exists race_media_delete on storage.objects;
create policy race_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'race-media' and (storage.foldername(name))[2] = auth.uid()::text);

-- Ảnh hợp lệ: đúng kho race-media của chính giải này (không nhúng ảnh ngoài vào BIB)
create or replace function private.race_media_ok(p_race_id uuid, p_url text) returns boolean
language sql immutable as $$
  select p_url is null or p_url ~ ('/storage/v1/object/public/race-media/' || p_race_id::text || '/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$')
$$;

-- ---------------------------------------------------------------------
-- 2. Lưu thiết kế (làm sạch từng trường, bỏ trường lạ)
-- ---------------------------------------------------------------------
create or replace function public.set_race_bib_design(p_race_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  r public.virtual_races := (select x from public.virtual_races x where x.id = p_race_id);
  v_tpl text := coalesce(p->>'template', 'classic');
  v_colors jsonb := '{}'::jsonb;
  k text;
  v_sponsors jsonb;
  v_out jsonb;
begin
  if r.id is null then raise exception 'RACE_NOT_FOUND'; end if;
  if not private.race_is_manager(r) then raise exception 'FORBIDDEN'; end if;
  if v_tpl not in ('classic', 'stripe', 'neon', 'minimal') then raise exception 'INVALID_BIB_DESIGN'; end if;
  foreach k in array array['bg', 'band', 'number', 'text', 'accent'] loop
    if p->'colors' ? k then
      if coalesce(p->'colors'->>k, '') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_BIB_DESIGN'; end if;
      v_colors := v_colors || jsonb_build_object(k, lower(p->'colors'->>k));
    end if;
  end loop;
  if not private.race_media_ok(r.id, p->>'logo_url') or not private.race_media_ok(r.id, p->>'bg_url') then
    raise exception 'INVALID_BIB_IMAGE';
  end if;
  if jsonb_typeof(coalesce(p->'sponsors', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p->'sponsors', '[]'::jsonb)) > 4 then
    raise exception 'INVALID_BIB_DESIGN';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p->'sponsors', '[]'::jsonb)) s
              where not private.race_media_ok(r.id, s->>'logo_url')) then
    raise exception 'INVALID_BIB_IMAGE';
  end if;
  v_sponsors := (select coalesce(jsonb_agg(jsonb_build_object('name', left(trim(coalesce(s->>'name', '')), 24), 'logo_url', s->>'logo_url')), '[]'::jsonb)
                   from jsonb_array_elements(coalesce(p->'sponsors', '[]'::jsonb)) s
                  where trim(coalesce(s->>'name', '')) <> '' or s->>'logo_url' is not null);
  v_out := jsonb_build_object(
    'template', v_tpl, 'colors', v_colors,
    'logo_url', p->>'logo_url', 'bg_url', p->>'bg_url',
    'bg_opacity', greatest(0, least(1, coalesce((p->>'bg_opacity')::numeric, 0.35))),
    'tagline', nullif(left(trim(coalesce(p->>'tagline', '')), 40), ''),
    'sponsors', v_sponsors,
    'show_name', coalesce((p->>'show_name')::boolean, true),
    'show_qr', coalesce((p->>'show_qr')::boolean, true));
  update public.virtual_races set bib_design = v_out where id = r.id;
  return v_out;
end $$;

-- ---------------------------------------------------------------------
-- 3. Thẻ giải kèm thiết kế BIB (thay bản 002700)
-- ---------------------------------------------------------------------
create or replace function private.race_card(r public.virtual_races) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.id, 'title', r.title, 'description', r.description, 'start_at', r.start_at, 'end_at', r.end_at,
    'reg_close_at', r.reg_close_at, 'distances', to_jsonb(r.distances), 'audience', r.audience, 'status', r.status,
    'cancelled_reason', r.cancelled_reason, 'max_participants', r.max_participants, 'bib_prefix', r.bib_prefix,
    'bib_design', r.bib_design,
    'club', (select jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url, 'accent_color', c.accent_color)
               from public.clubs c where c.id = r.club_id),
    'organizer', (select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url)
                    from public.profiles p where p.id = r.organizer_id),
    'registered', (select count(*) from public.race_registrations g where g.race_id = r.id and g.status <> 'WITHDRAWN'),
    'finished', (select count(*) from public.race_registrations g where g.race_id = r.id and g.status = 'FINISHED'),
    'me', (select jsonb_build_object('id', g.id, 'bib', g.bib, 'display_name', (select pp.display_name from public.profiles pp where pp.id = g.user_id),
                                     'distance_km', g.distance_km, 'status', g.status,
                                     'finish_time_s', g.finish_time_s, 'finish_distance_m', g.finish_distance_m,
                                     'finish_moving_s', g.finish_moving_s, 'finished_at', g.finished_at,
                                     'finish_activity_id', g.finish_activity_id, 'registered_at', g.registered_at,
                                     'rank', case when g.status = 'FINISHED' then
                                       (select count(*) + 1 from public.race_registrations o
                                         where o.race_id = r.id and o.distance_km = g.distance_km and o.status = 'FINISHED'
                                           and (o.finish_time_s < g.finish_time_s or (o.finish_time_s = g.finish_time_s and o.finished_at < g.finished_at))) end)
             from public.race_registrations g where g.race_id = r.id and g.user_id = auth.uid() and g.status <> 'WITHDRAWN'),
    'can_manage', private.race_is_manager(r))
$$;

-- ---------------------------------------------------------------------
-- 4. Quét QR trên BIB: xác thực VĐV (trọng tài / BTC / bạn bè)
-- ---------------------------------------------------------------------
create or replace function public.race_bib_lookup(p_race_id uuid, p_bib text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.virtual_races := (select x from public.virtual_races x where x.id = p_race_id);
begin
  if r.id is null or not private.race_visible(r) then raise exception 'RACE_NOT_FOUND'; end if;
  return (select jsonb_build_object('bib', g.bib, 'display_name', p.display_name, 'avatar_url', p.avatar_url,
            'distance_km', g.distance_km, 'status', g.status, 'finish_time_s', g.finish_time_s, 'finished_at', g.finished_at)
    from public.race_registrations g join public.profiles p on p.id = g.user_id
   where g.race_id = r.id and g.bib = upper(trim(p_bib)) and g.status <> 'WITHDRAWN');
end $$;

revoke all on function private.race_media_ok(uuid, text) from public, anon, authenticated;
revoke all on function public.can_manage_race(uuid), public.set_race_bib_design(uuid, jsonb), public.race_bib_lookup(uuid, text) from public, anon;
grant execute on function public.can_manage_race(uuid), public.set_race_bib_design(uuid, jsonb), public.race_bib_lookup(uuid, text) to authenticated;

notify pgrst, 'reload schema';
