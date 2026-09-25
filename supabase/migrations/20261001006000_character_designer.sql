-- 006000: Bộ sưu tập nhân vật + trình thiết kế trang phục chuyên nghiệp.
-- • Nhân vật có nhiều dáng (bộ gốc + thư thái, đang chạy, áo thun…): user_avatar.body; dáng khác giới tự về bộ gốc (client).
-- • Thiết kế món đồ (cột print) mở rộng:
--     layers  — lớp in tự do (chữ / ảnh) đặt theo hộp bao vùng áo / quần: x, y (0..1), w (tỉ lệ bề rộng), xoay, độ mờ,
--               chữ: font, màu, viền, giãn chữ; "{TEN}" = tên gọi của người mặc. Tối đa 12 lớp, chỉ áo và quần.
--     tone    — độ đậm màu (strength 0.2..1) và sáng / tối (light -0.4..0.4) của màu nền món đồ.
--     texture — ảnh vải / ảnh áo thật phủ lên vùng (url, độ mờ, tỉ lệ), giữ nếp vải.
-- Cần 005900. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

alter table public.user_avatar add column if not exists body text;

create or replace function private.character_bodies() returns text[]
language sql immutable as $$
  select array['male', 'female', 'male_relax', 'male_run', 'female_tee', 'female_run']
$$;

create or replace function private.character_look(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'gender', coalesce(a.gender, 'male'),
    'body', a.body,
    'equipped', coalesce((
      select jsonb_object_agg(s.slot, i.code)
        from unnest(private.character_slots()) s(slot)
        join public.avatar_items i on i.is_active and i.id = (to_jsonb(e) ->> (s.slot || '_item_id'))::uuid
    ), '{}'::jsonb),
    'items', coalesce((
      select jsonb_agg(private.item_json(i))
        from public.avatar_items i
       where i.is_active and i.id in (e.top_item_id, e.bottom_item_id, e.socks_item_id, e.shoes_item_id, e.hair_item_id,
         e.hat_item_id, e.glasses_item_id, e.watch_item_id, e.accessory_item_id, e.effect_item_id)
    ), '[]'::jsonb))
    from (select p_user as uid) x
    left join public.user_avatar a on a.user_id = x.uid
    left join public.user_equipment e on e.user_id = x.uid
$$;

-- Như 005800 + chọn dáng nhân vật
create or replace function public.save_character(p_look jsonb, p_equipped jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_gender text := p_look->>'gender';
  v_body text := nullif(p_look->>'body', '');
  k text;
  v_code text;
  v_id uuid;
begin
  perform private.ensure_character(v_uid);
  if v_gender is not null and v_gender not in ('male', 'female') then raise exception 'INVALID_LOOK'; end if;
  if v_body is not null and not (v_body = any(private.character_bodies())) then raise exception 'INVALID_LOOK'; end if;
  update public.user_avatar set gender = coalesce(v_gender, gender),
    body = case when p_look ? 'body' then v_body else body end, updated_at = now() where user_id = v_uid;

  if p_equipped is not null and jsonb_typeof(p_equipped) = 'object' then
    for k in select jsonb_object_keys(p_equipped) loop
      if not (k = any(private.character_slots())) then raise exception 'INVALID_SLOT'; end if;
      v_code := p_equipped->>k;
      if v_code is null then
        if k = any(private.character_required_slots()) then raise exception 'SLOT_REQUIRED'; end if;
        v_id := null;
      else
        v_id := (select i.id from public.avatar_items i
                   join public.user_inventory inv on inv.item_id = i.id and inv.user_id = v_uid
                  where i.code = v_code and i.category = k and i.is_active);
        if v_id is null then raise exception 'ITEM_NOT_OWNED'; end if;
        if not private.item_wearable(v_uid, v_id) then raise exception 'CLUB_ONLY'; end if;
      end if;
      execute format('update public.user_equipment set %I = $1, updated_at = now() where user_id = $2', k || '_item_id') using v_id, v_uid;
    end loop;
  end if;
  return private.character_look(v_uid);
end $$;

create or replace function private.num_in(p jsonb, k text, lo numeric, hi numeric, dflt numeric) returns numeric
language sql immutable as $$
  select greatest(lo, least(hi, coalesce(case when jsonb_typeof(p->k) = 'number' then (p->>k)::numeric end, dflt)))
$$;

-- Ảnh hợp lệ cho thiết kế: trong app (/character/…) hoặc https, định dạng ảnh
create or replace function private.design_url_ok(u text) returns boolean
language sql immutable as $$
  select u ~ '^(/character/|https://)[^\s"<>]+\.(png|webp|jpe?g)(\?[^\s"<>]*)?$'
$$;

-- Thiết kế của một món: như 005900 + layers, tone, texture
create or replace function private.clean_design(p jsonb, p_slot text) returns jsonb
language plpgsql immutable as $$
declare
  v_pat jsonb := case when jsonb_typeof(p->'pattern') = 'object' and coalesce(p->'pattern'->>'kind', 'none') <> 'none' then p->'pattern' end;
  v_base jsonb;
  v_out jsonb;
  v_layers jsonb := '[]'::jsonb;
  l jsonb;
  v_type text;
  v_text text;
  v_n integer := 0;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return null; end if;
  if v_pat is not null then
    if not ((v_pat->>'kind') = any(private.pattern_kinds(p_slot))) then raise exception 'INVALID_PATTERN'; end if;
    if coalesce(v_pat->>'color', '') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_PATTERN'; end if;
    v_pat := jsonb_build_object('kind', v_pat->>'kind', 'color', lower(v_pat->>'color'));
  end if;
  if p_slot = 'top' then
    v_base := private.clean_print(p - 'pattern' - 'layers' - 'tone' - 'texture');
  elsif nullif(trim(coalesce(p->>'logo_url', '')), '') is not null or nullif(trim(coalesce(p->>'title', '')), '') is not null
        or nullif(trim(coalesce(p->>'subtitle', '')), '') is not null or coalesce(p->>'personal', 'NONE') = 'NAME' then
    raise exception 'PRINT_TOP_ONLY';
  end if;
  v_out := coalesce(v_base, '{}'::jsonb);
  if v_pat is not null then v_out := v_out || jsonb_build_object('pattern', v_pat); end if;

  if jsonb_typeof(p->'layers') = 'array' and jsonb_array_length(p->'layers') > 0 then
    if p_slot not in ('top', 'bottom') then raise exception 'PRINT_TOP_ONLY'; end if;
    if jsonb_array_length(p->'layers') > 12 then raise exception 'TOO_MANY_LAYERS'; end if;
    for l in select value from jsonb_array_elements(p->'layers') loop
      v_type := l->>'type';
      if v_type not in ('text', 'image') then raise exception 'INVALID_LAYER'; end if;
      v_n := v_n + 1;
      if v_type = 'text' then
        v_text := left(trim(coalesce(l->>'text', '')), 40);
        if v_text = '' then continue; end if;
        if coalesce(l->>'font', 'athletic') !~ '^[a-z_]{2,20}$' then raise exception 'INVALID_LAYER'; end if;
        if coalesce(l->>'color', '#ffffff') !~ '^#[0-9a-fA-F]{6}$' or coalesce(l->>'stroke', '#000000') !~ '^#[0-9a-fA-F]{6}$' then
          raise exception 'INVALID_LAYER';
        end if;
        v_layers := v_layers || jsonb_build_array(jsonb_build_object('id', left(coalesce(l->>'id', v_n::text), 16), 'type', 'text', 'text', v_text,
          'font', coalesce(l->>'font', 'athletic'), 'color', lower(coalesce(l->>'color', '#ffffff')),
          'stroke', lower(coalesce(l->>'stroke', '#000000')), 'stroke_w', private.num_in(l, 'stroke_w', 0, 0.3, 0),
          'spacing', private.num_in(l, 'spacing', -0.1, 0.8, 0), 'bold', coalesce((l->>'bold')::boolean, true),
          'x', private.num_in(l, 'x', -0.2, 1.2, 0.5), 'y', private.num_in(l, 'y', -0.2, 1.2, 0.5), 'w', private.num_in(l, 'w', 0.02, 1.6, 0.4),
          'rot', private.num_in(l, 'rot', -180, 180, 0), 'opacity', private.num_in(l, 'opacity', 0.05, 1, 1)));
      else
        if not private.design_url_ok(coalesce(l->>'url', '')) then raise exception 'INVALID_LAYER'; end if;
        v_layers := v_layers || jsonb_build_array(jsonb_build_object('id', left(coalesce(l->>'id', v_n::text), 16), 'type', 'image', 'url', l->>'url',
          'x', private.num_in(l, 'x', -0.2, 1.2, 0.5), 'y', private.num_in(l, 'y', -0.2, 1.2, 0.5), 'w', private.num_in(l, 'w', 0.02, 1.6, 0.3),
          'rot', private.num_in(l, 'rot', -180, 180, 0), 'opacity', private.num_in(l, 'opacity', 0.05, 1, 1)));
      end if;
    end loop;
    if jsonb_array_length(v_layers) > 0 then v_out := v_out || jsonb_build_object('layers', v_layers); end if;
  end if;

  if jsonb_typeof(p->'tone') = 'object' then
    v_out := v_out || jsonb_build_object('tone', jsonb_build_object('strength', private.num_in(p->'tone', 'strength', 0.2, 1, 1),
      'light', private.num_in(p->'tone', 'light', -0.4, 0.4, 0)));
  end if;
  if jsonb_typeof(p->'texture') = 'object' then
    if not private.design_url_ok(coalesce(p->'texture'->>'url', '')) then raise exception 'INVALID_TEXTURE'; end if;
    v_out := v_out || jsonb_build_object('texture', jsonb_build_object('url', p->'texture'->>'url',
      'opacity', private.num_in(p->'texture', 'opacity', 0.05, 1, 0.6), 'scale', private.num_in(p->'texture', 'scale', 0.3, 3, 1)));
  end if;
  return nullif(v_out, '{}'::jsonb);
end $$;

-- Đồng phục CLB: ảnh trong thiết kế (lớp ảnh, vải) phải nằm trong kho của chính CLB
create or replace function private.design_urls(p jsonb) returns text[]
language sql immutable as $$
  select array_remove(array[p->>'logo_url', p->'texture'->>'url'] ||
    coalesce((select array_agg(l->>'url') from jsonb_array_elements(case when jsonb_typeof(p->'layers') = 'array' then p->'layers' else '[]'::jsonb end) l
               where l->>'type' = 'image'), array[]::text[]), null)
$$;

create or replace function public.request_club_uniform(p_club_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_print jsonb := private.clean_design(p->'print', 'top');
  v_parts jsonb := private.clean_parts(p->'parts');
  v_url text;
  k text;
  r public.club_uniform_requests;
begin
  if not public.club_is_staff(p_club_id) then raise exception 'FORBIDDEN'; end if;
  if char_length(trim(coalesce(p->>'name', ''))) < 2 then raise exception 'INVALID_NAME'; end if;
  if coalesce(p->>'color', '') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_COLOR'; end if;
  if v_print is null then raise exception 'INVALID_PRINT'; end if;
  foreach v_url in array private.design_urls(v_print) loop
    if v_url !~ ('/storage/v1/object/public/uniform-media/' || p_club_id::text || '/') and v_url !~ '^/character/' then raise exception 'INVALID_PRINT'; end if;
  end loop;
  for k in select jsonb_object_keys(coalesce(v_parts, '{}'::jsonb)) loop
    foreach v_url in array private.design_urls(coalesce(v_parts->k->'print', '{}'::jsonb)) loop
      if v_url !~ ('/storage/v1/object/public/uniform-media/' || p_club_id::text || '/') and v_url !~ '^/character/' then raise exception 'INVALID_PRINT'; end if;
    end loop;
  end loop;
  if (select count(*) from public.club_uniform_requests x where x.club_id = p_club_id and x.status = 'PENDING') >= 3 then
    raise exception 'TOO_MANY_REQUESTS';
  end if;
  insert into public.club_uniform_requests (club_id, requested_by, name, color, print, note, parts)
  values (p_club_id, v_uid, left(trim(p->>'name'), 60), lower(p->>'color'), v_print, nullif(left(trim(coalesce(p->>'note', '')), 500), ''), v_parts)
  returning * into r;
  return private.uniform_request_json(r);
end $$;

revoke all on function private.character_bodies(), private.num_in(jsonb, text, numeric, numeric, numeric), private.design_url_ok(text),
  private.design_urls(jsonb) from public, anon, authenticated;

notify pgrst, 'reload schema';
