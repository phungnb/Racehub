-- 003000: BIB đa dạng hơn.
-- • Ảnh BIB có sẵn (thiết kế từ Canva / Photoshop): art_url + tick use_art để dùng làm khung, căn chỉnh
--   art_fit {zoom 0.5..3, x / y -1..1}. Khi dùng khung có thể tắt đầu BIB (show_header) và dải tài trợ (show_sponsors).
-- • Bố cục số BIB & tên: text {layout below / above / inline, align left / center / right, y 0.15..0.85 (vị trí dọc),
--   scale / name_scale 0.5..1.5, font mono / sans / italic / outline}; vị trí QR qr_pos right / left / corner.
-- Cần file 002900. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- Số trong khoảng [lo, hi]; không phải số → mặc định
create or replace function private.bib_num(j jsonb, lo numeric, hi numeric, def numeric) returns numeric
language sql immutable as $$
  select case when jsonb_typeof(j) = 'number' then round(greatest(lo, least(hi, (j #>> '{}')::numeric)), 3) else def end
$$;

-- Giá trị thuộc danh sách cho phép; thiếu → mặc định; sai → lỗi
create or replace function private.bib_pick(v text, allowed text[], def text) returns text
language plpgsql immutable as $$
begin
  if v is null then return def; end if;
  if not (v = any (allowed)) then raise exception 'INVALID_BIB_DESIGN'; end if;
  return v;
end $$;

create or replace function private.bib_bool(j jsonb, def boolean) returns boolean
language sql immutable as $$
  select case when jsonb_typeof(j) = 'boolean' then (j #>> '{}')::boolean else def end
$$;

create or replace function public.set_race_bib_design(p_race_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  r public.virtual_races := (select x from public.virtual_races x where x.id = p_race_id);
  v_tpl text := coalesce(p->>'template', 'classic');
  v_colors jsonb := '{}'::jsonb;
  k text;
  v_sponsors jsonb;
  v_text jsonb := coalesce(p->'text', '{}'::jsonb);
  v_fit jsonb := coalesce(p->'art_fit', '{}'::jsonb);
  v_out jsonb;
begin
  if r.id is null then raise exception 'RACE_NOT_FOUND'; end if;
  if not private.race_is_manager(r) then raise exception 'FORBIDDEN'; end if;
  if v_tpl not in ('classic', 'stripe', 'neon', 'minimal') then raise exception 'INVALID_BIB_DESIGN'; end if;
  if jsonb_typeof(v_text) <> 'object' or jsonb_typeof(v_fit) <> 'object' then raise exception 'INVALID_BIB_DESIGN'; end if;
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
    'show_name', private.bib_bool(p->'show_name', true),
    'show_qr', private.bib_bool(p->'show_qr', true),
    'art_url', p->>'art_url',
    'use_art', private.bib_bool(p->'use_art', false) and p->>'art_url' is not null,
    'art_fit', jsonb_build_object(
      'zoom', private.bib_num(v_fit->'zoom', 0.5, 3, 1),
      'x', private.bib_num(v_fit->'x', -1, 1, 0),
      'y', private.bib_num(v_fit->'y', -1, 1, 0)),
    'show_header', private.bib_bool(p->'show_header', true),
    'show_sponsors', private.bib_bool(p->'show_sponsors', true),
    'text', jsonb_build_object(
      'layout', private.bib_pick(v_text->>'layout', array['below', 'above', 'inline'], 'below'),
      'align', private.bib_pick(v_text->>'align', array['left', 'center', 'right'], 'center'),
      'font', private.bib_pick(v_text->>'font', array['mono', 'sans', 'italic', 'outline'], 'mono'),
      'y', private.bib_num(v_text->'y', 0.15, 0.85, 0.5),
      'scale', private.bib_num(v_text->'scale', 0.5, 1.5, 1),
      'name_scale', private.bib_num(v_text->'name_scale', 0.5, 1.5, 1)),
    'qr_pos', private.bib_pick(p->>'qr_pos', array['right', 'left', 'corner'], 'right'));
  update public.virtual_races set bib_design = v_out where id = r.id;
  return v_out;
end $$;

revoke all on function private.bib_num(jsonb, numeric, numeric, numeric), private.bib_pick(text, text[], text), private.bib_bool(jsonb, boolean)
  from public, anon, authenticated;
revoke all on function public.set_race_bib_design(uuid, jsonb) from public, anon;
grant execute on function public.set_race_bib_design(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
