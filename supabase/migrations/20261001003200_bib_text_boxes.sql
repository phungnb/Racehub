-- 003200: Chữ trên BIB thành 3 khung tự do: Đơn vị tổ chức, Số BIB, Tên VĐV.
-- Mỗi khung: show, x / y (tâm theo tỉ lệ khổ BIB 0..1), align left / center / right,
-- font (10 font có tiếng Việt), italic, outline (viền rỗng), size 0.3..2.5, color (một màu trong bảng màu BIB).
-- org_text: chữ Đơn vị tổ chức (trống = tên CLB / người tổ chức). Thay trường text của bản 003000.
-- Cần file 003000. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- Một khung chữ: làm sạch từng thuộc tính, thiếu → mặc định, lựa chọn lạ → lỗi
create or replace function private.bib_box(b jsonb, dx numeric, dy numeric, dfont text, dcolor text) returns jsonb
language plpgsql immutable as $$
begin
  if b is null or jsonb_typeof(b) = 'null' then b := '{}'::jsonb; end if;
  if jsonb_typeof(b) <> 'object' then raise exception 'INVALID_BIB_DESIGN'; end if;
  return jsonb_build_object(
    'show', private.bib_bool(b->'show', true),
    'x', private.bib_num(b->'x', 0, 1, dx),
    'y', private.bib_num(b->'y', 0, 1, dy),
    'align', private.bib_pick(b->>'align', array['left', 'center', 'right'], 'center'),
    'font', private.bib_pick(b->>'font', array['sans', 'mono', 'condensed', 'impact', 'athletic', 'tech', 'slab', 'stencil', 'script', 'serif'], dfont),
    'italic', private.bib_bool(b->'italic', false),
    'outline', private.bib_bool(b->'outline', false),
    'size', private.bib_num(b->'size', 0.3, 2.5, 1),
    'color', private.bib_pick(b->>'color', array['bg', 'band', 'number', 'text', 'accent'], dcolor));
end $$;

create or replace function public.set_race_bib_design(p_race_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  r public.virtual_races := (select x from public.virtual_races x where x.id = p_race_id);
  v_tpl text := coalesce(p->>'template', 'classic');
  v_colors jsonb := '{}'::jsonb;
  k text;
  v_sponsors jsonb;
  v_boxes jsonb := coalesce(p->'boxes', '{}'::jsonb);
  v_fit jsonb := coalesce(p->'art_fit', '{}'::jsonb);
  v_out jsonb;
begin
  if r.id is null then raise exception 'RACE_NOT_FOUND'; end if;
  if not private.race_is_manager(r) then raise exception 'FORBIDDEN'; end if;
  if v_tpl not in ('classic', 'stripe', 'neon', 'minimal') then raise exception 'INVALID_BIB_DESIGN'; end if;
  if jsonb_typeof(v_boxes) <> 'object' or jsonb_typeof(v_fit) <> 'object' then raise exception 'INVALID_BIB_DESIGN'; end if;
  foreach k in array array['bg', 'band', 'number', 'text', 'accent'] loop
    if p->'colors' ? k then
      if coalesce(p->'colors'->>k, '') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_BIB_DESIGN'; end if;
      v_colors := v_colors || jsonb_build_object(k, lower(p->'colors'->>k));
    end if;
  end loop;
  if not private.race_media_ok(r.id, p->>'logo_url') or not private.race_media_ok(r.id, p->>'bg_url')
     or not private.race_media_ok(r.id, p->>'art_url') then
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
    'bg_opacity', private.bib_num(p->'bg_opacity', 0, 1, 0.35),
    'tagline', nullif(left(trim(coalesce(p->>'tagline', '')), 40), ''),
    'sponsors', v_sponsors,
    'show_name', private.bib_bool(p->'boxes'->'name'->'show', private.bib_bool(p->'show_name', true)),
    'show_qr', private.bib_bool(p->'show_qr', true),
    'art_url', p->>'art_url',
    'use_art', private.bib_bool(p->'use_art', false) and p->>'art_url' is not null,
    'art_fit', jsonb_build_object(
      'zoom', private.bib_num(v_fit->'zoom', 0.5, 3, 1),
      'x', private.bib_num(v_fit->'x', -1, 1, 0),
      'y', private.bib_num(v_fit->'y', -1, 1, 0)),
    'show_header', private.bib_bool(p->'show_header', true),
    'show_sponsors', private.bib_bool(p->'show_sponsors', true),
    'org_text', nullif(left(trim(coalesce(p->>'org_text', '')), 60), ''),
    'boxes', jsonb_build_object(
      'org', private.bib_box(v_boxes->'org', 0.42, 0.30, 'sans', 'text'),
      'number', private.bib_box(v_boxes->'number', 0.42, 0.54, 'mono', 'number'),
      'name', private.bib_box(v_boxes->'name', 0.42, 0.72, 'sans', 'text')),
    'qr_pos', private.bib_pick(p->>'qr_pos', array['right', 'left', 'corner'], 'right'));
  update public.virtual_races set bib_design = v_out where id = r.id;
  return v_out;
end $$;

revoke all on function private.bib_box(jsonb, numeric, numeric, text, text) from public, anon, authenticated;
revoke all on function public.set_race_bib_design(uuid, jsonb) from public, anon;
grant execute on function public.set_race_bib_design(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
