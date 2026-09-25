-- 004800: Thiết kế BIB bản 2 + Giấy chứng nhận do BTC thiết kế.
-- • Mọi thứ trên BIB / chứng nhận là LỚP kéo thả: chữ (gắn trường dữ liệu hoặc chữ tự nhập, 40 font tiếng Việt, hiệu ứng
--   viền / bóng / phát sáng / bôi dạ quang / nền khối / băng chéo…), ảnh (logo, nhà tài trợ, chữ ký), mã QR (xác thực VĐV,
--   trang giải, đơn vị tổ chức, phí tham gia, đường link, ảnh QR tải lên), hình trang trí (khối, đường kẻ, nguyệt quế, con dấu).
-- • virtual_races.cert_design + set_race_cert_design: mẫu chứng nhận (khổ dọc 4:5 / ngang A4).
-- • race_design_assets: BTC lấy sẵn QR nhận tiền / tài khoản ngân hàng đã lưu của CLB để in "QR phí tham gia".
-- • Ảnh hợp lệ: kho race-media của giải, hoặc ảnh trong thư mục club-media của CLB tổ chức (QR ngân hàng đã lưu).
-- Cần 002900 → 003200. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

alter table public.virtual_races add column if not exists cert_design jsonb;

-- ---------------------------------------------------------------------
-- 1. Hàm làm sạch dùng chung
-- ---------------------------------------------------------------------
create or replace function private.design_src_ok(r public.virtual_races, p_url text) returns boolean
language sql stable as $$
  select p_url is null
      or private.race_media_ok(r.id, p_url)
      or (r.club_id is not null and char_length(p_url) <= 500 and p_url ~ '^https://'
          and position('/storage/v1/object/public/club-media/' || r.club_id::text || '/' in p_url) > 0)
$$;

-- Màu: một màu trong bảng màu (bg, band, number, text, accent) hoặc #rrggbb; sai → mặc định
create or replace function private.design_paint(v jsonb, def text) returns text
language sql immutable as $$
  select case
    when jsonb_typeof(v) <> 'string' then def
    when (v #>> '{}') ~ '^#[0-9a-fA-F]{6}$' then lower(v #>> '{}')
    when (v #>> '{}') = any (array['bg', 'band', 'number', 'text', 'accent']) then v #>> '{}'
    else def end
$$;

create or replace function private.design_str(v jsonb, n int) returns text
language sql immutable as $$
  select case when jsonb_typeof(v) = 'string' then left(v #>> '{}', n) else '' end
$$;

-- Danh sách lớp: tối đa 40; lớp lạ bị bỏ; lựa chọn sai → INVALID_BIB_DESIGN; ảnh ngoài kho → INVALID_BIB_IMAGE
create or replace function private.design_layers(r public.virtual_races, arr jsonb, p_binds text[]) returns jsonb
language plpgsql stable as $$
declare
  v_fonts text[] := array['sans', 'montserrat', 'inter', 'lexend', 'unbounded', 'impact', 'dela', 'paytone', 'sigmar', 'bungee', 'bungee_shade',
    'rowdies', 'condensed', 'athletic', 'saira', 'roboto_c', 'asap_c', 'fjalla', 'mono', 'tech', 'exo', 'kanit', 'tourney', 'protest', 'stencil',
    'slab', 'alfa', 'serif', 'cormorant', 'garamond', 'yeseva', 'script', 'vibes', 'allura', 'pacifico', 'lobster', 'graffiti', 'brush', 'bangers', 'patrick'];
  v_fx text[] := array['none', 'outline', 'stroke', 'shadow', 'glow', 'extrude', 'marker', 'box', 'pill', 'slant', 'underline', 'gold', 'gradient'];
begin
  if arr is null or jsonb_typeof(arr) = 'null' then return '[]'::jsonb; end if;
  if jsonb_typeof(arr) <> 'array' or jsonb_array_length(arr) > 40 then raise exception 'INVALID_BIB_DESIGN'; end if;
  if exists (select 1 from jsonb_array_elements(arr) e
              where e->>'type' in ('image', 'qr') and not private.design_src_ok(r, e->>'src')) then
    raise exception 'INVALID_BIB_IMAGE';
  end if;
  return (select coalesce(jsonb_agg(x.j order by x.ord), '[]'::jsonb) from (
    select e.ord,
      jsonb_build_object(
        'id', case when e.v->>'id' ~ '^[A-Za-z0-9_-]{1,24}$' then e.v->>'id' else 'l' || e.ord::text end,
        'type', e.v->>'type',
        'x', private.bib_num(e.v->'x', -0.2, 1.2, 0.5), 'y', private.bib_num(e.v->'y', -0.2, 1.2, 0.5),
        'rot', private.bib_num(e.v->'rot', -180, 180, 0), 'opacity', private.bib_num(e.v->'opacity', 0.05, 1, 1),
        'hidden', private.bib_bool(e.v->'hidden', false), 'locked', private.bib_bool(e.v->'locked', false))
      || case e.v->>'type'
        when 'text' then jsonb_build_object(
          'bind', case when e.v->>'bind' = any (p_binds || 'custom'::text) then e.v->>'bind' else 'custom' end,
          'text', private.design_str(e.v->'text', 120),
          'font', private.bib_pick(e.v->>'font', v_fonts, 'sans'),
          'size', private.bib_num(e.v->'size', 8, 800, 48), 'w', private.bib_num(e.v->'w', 0.03, 1.2, 0.8),
          'align', private.bib_pick(e.v->>'align', array['left', 'center', 'right'], 'center'),
          'color', private.design_paint(e.v->'color', 'text'),
          'italic', private.bib_bool(e.v->'italic', false), 'upper', private.bib_bool(e.v->'upper', false),
          'spacing', private.bib_num(e.v->'spacing', -0.1, 1, 0),
          'fx', private.bib_pick(e.v->>'fx', v_fx, 'none'),
          'fx_color', private.design_paint(e.v->'fx_color', 'accent'))
        when 'image' then jsonb_build_object(
          'role', private.bib_pick(e.v->>'role', array['logo', 'sponsor', 'image', 'signature'], 'image'),
          'src', e.v->>'src', 'name', trim(private.design_str(e.v->'name', 40)),
          'w', private.bib_num(e.v->'w', 0.02, 1.2, 0.16), 'h', private.bib_num(e.v->'h', 0.02, 1.2, 0.12))
        when 'qr' then jsonb_build_object(
          'source', private.bib_pick(e.v->>'source', array['verify', 'race', 'club', 'fee', 'link', 'image'], 'verify'),
          'src', e.v->>'src', 'url', private.design_str(e.v->'url', 400),
          'w', private.bib_num(e.v->'w', 0.05, 0.6, 0.14),
          'label', private.design_str(e.v->'label', 40), 'card', private.bib_bool(e.v->'card', true))
        else jsonb_build_object(
          'shape', private.bib_pick(e.v->>'shape', array['rect', 'round', 'pill', 'circle', 'line', 'slash', 'laurel', 'seal'], 'rect'),
          'w', private.bib_num(e.v->'w', 0.005, 1.5, 0.3), 'h', private.bib_num(e.v->'h', 0.003, 1.5, 0.1),
          'fill', private.design_paint(e.v->'fill', 'band'))
      end as j
    from jsonb_array_elements(arr) with ordinality as e(v, ord)
    where e.v->>'type' in ('text', 'image', 'qr', 'shape')) x);
end $$;

create or replace function private.design_colors(c jsonb) returns jsonb
language plpgsql immutable as $$
declare k text; v_out jsonb := '{}'::jsonb;
begin
  if c is null or jsonb_typeof(c) <> 'object' then return v_out; end if;
  foreach k in array array['bg', 'band', 'number', 'text', 'accent'] loop
    if c ? k then
      if coalesce(c->>k, '') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_BIB_DESIGN'; end if;
      v_out := v_out || jsonb_build_object(k, lower(c->>k));
    end if;
  end loop;
  return v_out;
end $$;

create or replace function private.design_fit(f jsonb) returns jsonb
language sql immutable as $$
  select jsonb_build_object('zoom', private.bib_num(f->'zoom', 0.5, 3, 1), 'x', private.bib_num(f->'x', -1, 1, 0), 'y', private.bib_num(f->'y', -1, 1, 0))
$$;

-- ---------------------------------------------------------------------
-- 2. Lưu thiết kế BIB (bản 2 — bản 1 cũ vẫn hiển thị được, app tự chuyển đổi)
-- ---------------------------------------------------------------------
create or replace function public.set_race_bib_design(p_race_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  r public.virtual_races := (select x from public.virtual_races x where x.id = p_race_id);
  v_tpl text := coalesce(p->>'template', 'classic');
  v_out jsonb;
begin
  if r.id is null then raise exception 'RACE_NOT_FOUND'; end if;
  if not private.race_is_manager(r) then raise exception 'FORBIDDEN'; end if;
  if coalesce(p->>'v', '1') <> '2' then raise exception 'APP_OUTDATED'; end if;
  if v_tpl not in ('classic', 'marathon', 'stripe', 'split', 'gradient', 'speed', 'neon', 'minimal') then raise exception 'INVALID_BIB_DESIGN'; end if;
  if not private.race_media_ok(r.id, p->>'bg_url') or not private.race_media_ok(r.id, p->>'art_url') then raise exception 'INVALID_BIB_IMAGE'; end if;
  v_out := jsonb_build_object(
    'v', 2, 'template', v_tpl, 'colors', private.design_colors(p->'colors'),
    'bg_url', p->>'bg_url', 'bg_opacity', private.bib_num(p->'bg_opacity', 0, 1, 0.35),
    'art_url', p->>'art_url', 'use_art', private.bib_bool(p->'use_art', false) and p->>'art_url' is not null,
    'art_fit', private.design_fit(coalesce(p->'art_fit', '{}'::jsonb)),
    'decor', private.bib_bool(p->'decor', true), 'strip', private.bib_bool(p->'strip', false), 'pins', private.bib_bool(p->'pins', true),
    'layers', private.design_layers(r, p->'layers', array['number', 'name', 'org', 'race', 'distance', 'dates']));
  update public.virtual_races set bib_design = v_out where id = r.id;
  return v_out;
end $$;

-- ---------------------------------------------------------------------
-- 3. Thiết kế giấy chứng nhận
-- ---------------------------------------------------------------------
create or replace function public.set_race_cert_design(p_race_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  r public.virtual_races := (select x from public.virtual_races x where x.id = p_race_id);
  v_out jsonb;
begin
  if r.id is null then raise exception 'RACE_NOT_FOUND'; end if;
  if not private.race_is_manager(r) then raise exception 'FORBIDDEN'; end if;
  if p is null or jsonb_typeof(p) = 'null' then
    update public.virtual_races set cert_design = null where id = r.id;       -- về mẫu mặc định
    return null;
  end if;
  if not private.race_media_ok(r.id, p->>'bg_url') or not private.race_media_ok(r.id, p->>'art_url') then raise exception 'INVALID_BIB_IMAGE'; end if;
  v_out := jsonb_build_object(
    'v', 2,
    'format', private.bib_pick(p->>'format', array['portrait', 'landscape'], 'portrait'),
    'template', private.bib_pick(p->>'template', array['midnight', 'ivory', 'bold', 'minimal'], 'midnight'),
    'colors', private.design_colors(p->'colors'),
    'bg_url', p->>'bg_url', 'bg_opacity', private.bib_num(p->'bg_opacity', 0, 1, 0.3),
    'art_url', p->>'art_url', 'use_art', private.bib_bool(p->'use_art', false) and p->>'art_url' is not null,
    'art_fit', private.design_fit(coalesce(p->'art_fit', '{}'::jsonb)),
    'decor', private.bib_bool(p->'decor', true),
    'layers', private.design_layers(r, p->'layers', array['name', 'race', 'org', 'distance', 'time', 'pace', 'rank', 'date', 'bib']));
  update public.virtual_races set cert_design = v_out where id = r.id;
  return v_out;
end $$;

-- ---------------------------------------------------------------------
-- 4. Tài nguyên có sẵn cho trình thiết kế (chỉ BTC): QR nhận tiền / tài khoản ngân hàng của CLB tổ chức
-- ---------------------------------------------------------------------
create or replace function public.race_design_assets(p_race_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  r public.virtual_races := (select x from public.virtual_races x where x.id = p_race_id);
begin
  if r.id is null then raise exception 'RACE_NOT_FOUND'; end if;
  if not private.race_is_manager(r) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'club', (select jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url) from public.clubs c where c.id = r.club_id),
    'bank_qr_url', (select c.bank_qr_url from public.clubs c where c.id = r.club_id),
    'bank', (select case when c.bank_bin is null or c.bank_account_no is null then null
                         else jsonb_build_object('bin', c.bank_bin, 'account_no', c.bank_account_no, 'account_name', c.bank_account_name) end
               from public.clubs c where c.id = r.club_id));
end $$;

-- ---------------------------------------------------------------------
-- 5. Chi tiết giải kèm thiết kế chứng nhận (thay bản 002700)
-- ---------------------------------------------------------------------
create or replace function public.race_detail(p_race_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.virtual_races := (select x from public.virtual_races x where x.id = p_race_id);
begin
  if r.id is null or not private.race_visible(r) then raise exception 'RACE_NOT_FOUND'; end if;
  return private.race_card(r) || jsonb_build_object('cert_design', r.cert_design, 'per_distance', (
    select coalesce(jsonb_agg(jsonb_build_object('distance_km', d,
             'registered', (select count(*) from public.race_registrations g where g.race_id = r.id and g.distance_km = d and g.status <> 'WITHDRAWN'),
             'finished', (select count(*) from public.race_registrations g where g.race_id = r.id and g.distance_km = d and g.status = 'FINISHED'))
             order by d), '[]'::jsonb)
      from unnest(r.distances) as d));
end $$;

revoke all on function private.design_src_ok(public.virtual_races, text), private.design_paint(jsonb, text), private.design_str(jsonb, int),
  private.design_layers(public.virtual_races, jsonb, text[]), private.design_colors(jsonb), private.design_fit(jsonb)
  from public, anon, authenticated;
revoke all on function public.set_race_bib_design(uuid, jsonb), public.set_race_cert_design(uuid, jsonb), public.race_design_assets(uuid) from public, anon;
grant execute on function public.set_race_bib_design(uuid, jsonb), public.set_race_cert_design(uuid, jsonb), public.race_design_assets(uuid) to authenticated;

notify pgrst, 'reload schema';
