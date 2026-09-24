-- =====================================================================
-- 20261001001400 — HỒ SƠ CÁ NHÂN: GIỚI TÍNH, NGÀY SINH, CHỈ SỐ CƠ THỂ, ẢNH ĐẠI DIỆN
--
--   * profiles.gender (công khai: dùng cho BXH theo giới) + profiles.bio (giới thiệu ngắn)
--   * profile_details: ngày sinh, chiều cao, cân nặng — CHỈ chủ tài khoản đọc được (profiles ai cũng đọc được)
--   * update_my_profile: sửa hồ sơ trong một lệnh, kiểm tra dữ liệu; đổi giới tính → nhân vật đổi theo
--   * my_profile: đọc hồ sơ đầy đủ của chính mình
--   * Bucket công khai "avatars": mỗi người chỉ ghi vào thư mục <user_id>/ của mình
-- Phụ thuộc: 001000 (nhân vật 2D). Idempotent.
-- Viết để chạy được trong SQL Editor của Supabase: không dùng SELECT ... INTO, khối DO, LIMIT.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Cột và bảng
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists gender text;
alter table public.profiles drop constraint if exists profiles_gender_check;
alter table public.profiles add constraint profiles_gender_check check (gender is null or gender in ('male', 'female'));
alter table public.profiles add column if not exists bio text;
alter table public.profiles drop constraint if exists profiles_bio_check;
alter table public.profiles add constraint profiles_bio_check check (bio is null or char_length(bio) <= 160);

create table if not exists public.profile_details (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  birth_date date check (birth_date is null or birth_date >= date '1920-01-01'),
  height_cm smallint check (height_cm is null or height_cm between 100 and 250),
  weight_kg numeric(4, 1) check (weight_kg is null or weight_kg between 25 and 250),
  updated_at timestamptz not null default now()
);
alter table public.profile_details enable row level security;
drop policy if exists profile_details_own on public.profile_details;
create policy profile_details_own on public.profile_details for select to authenticated using (user_id = auth.uid());
revoke all on public.profile_details from anon;
revoke insert, update, delete on public.profile_details from authenticated;
grant select on public.profile_details to authenticated;

-- Nhân vật nữ đã chọn trước đây → coi là giới tính đã khai (nam là mặc định cũ nên không suy ra được)
update public.profiles p set gender = 'female'
  from public.user_avatar a
 where a.user_id = p.id and a.gender = 'female' and p.gender is null;

-- ---------------------------------------------------------------------
-- 2. RPC
-- ---------------------------------------------------------------------
create or replace function public.my_profile() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  return (select jsonb_build_object(
      'id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url, 'bio', p.bio, 'gender', p.gender,
      'birth_date', d.birth_date, 'height_cm', d.height_cm, 'weight_kg', d.weight_kg)
    from public.profiles p
    left join public.profile_details d on d.user_id = p.id
   where p.id = v_uid);
end $$;

-- p: {display_name?, bio?, gender?, birth_date?, height_cm?, weight_kg?}; khóa có mặt với giá trị null = xóa (trừ tên)
create or replace function public.update_my_profile(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_name text := trim(p->>'display_name');
  v_bio text := nullif(trim(coalesce(p->>'bio', '')), '');
  v_gender text := p->>'gender';
  v_birth date;
  v_height smallint;
  v_weight numeric;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'INVALID_PROFILE'; end if;
  if p ? 'display_name' and (v_name is null or char_length(v_name) not between 2 and 40) then raise exception 'INVALID_NAME'; end if;
  if v_bio is not null and char_length(v_bio) > 160 then raise exception 'INVALID_BIO'; end if;
  if v_gender is not null and v_gender not in ('male', 'female') then raise exception 'INVALID_GENDER'; end if;
  begin
    v_birth := nullif(p->>'birth_date', '')::date;
    v_height := nullif(p->>'height_cm', '')::smallint;
    v_weight := nullif(p->>'weight_kg', '')::numeric;
  exception when others then
    raise exception 'INVALID_PROFILE';
  end;
  if v_birth is not null and (v_birth < date '1920-01-01' or v_birth > (current_date - interval '10 years')::date) then
    raise exception 'INVALID_BIRTH_DATE';
  end if;
  if v_height is not null and v_height not between 100 and 250 then raise exception 'INVALID_HEIGHT'; end if;
  if v_weight is not null and v_weight not between 25 and 250 then raise exception 'INVALID_WEIGHT'; end if;

  update public.profiles set
    display_name = case when p ? 'display_name' then v_name else display_name end,
    bio = case when p ? 'bio' then v_bio else bio end,
    gender = case when p ? 'gender' then v_gender else gender end,
    updated_at = now()
   where id = v_uid;

  if p ? 'birth_date' or p ? 'height_cm' or p ? 'weight_kg' then
    insert into public.profile_details (user_id) values (v_uid) on conflict (user_id) do nothing;
    update public.profile_details set
      birth_date = case when p ? 'birth_date' then v_birth else birth_date end,
      height_cm = case when p ? 'height_cm' then v_height else height_cm end,
      weight_kg = case when p ? 'weight_kg' then round(v_weight, 1) else weight_kg end,
      updated_at = now()
     where user_id = v_uid;
  end if;

  -- Nhân vật đi theo giới tính hồ sơ
  if v_gender is not null then
    insert into public.user_avatar (user_id, gender) values (v_uid, v_gender)
    on conflict (user_id) do update set gender = excluded.gender, updated_at = now();
  end if;

  return public.my_profile();
end $$;

-- Tủ đồ biết người chơi đã khai giới tính chưa (để nhắc chọn trong Cài đặt)
create or replace function public.character_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); v_items jsonb;
begin
  perform private.ensure_character(v_uid);
  v_items := (select coalesce(jsonb_agg(private.item_json(i) || jsonb_build_object('owned', inv.item_id is not null) order by i.category, i.sort, i.name), '[]'::jsonb)
                from public.avatar_items i
                left join public.user_inventory inv on inv.item_id = i.id and inv.user_id = v_uid
               where i.is_active and i.code is not null);
  return (private.character_look(v_uid) - 'items') || jsonb_build_object(
    'level', coalesce((select level from public.profiles where id = v_uid), 1),
    'balance', private.balance(v_uid),
    'gender_set', (select gender is not null from public.profiles where id = v_uid),
    'items', v_items);
end $$;

revoke all on function public.my_profile(), public.update_my_profile(jsonb) from public, anon;
grant execute on function public.my_profile(), public.update_my_profile(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Ảnh đại diện: bucket công khai, thư mục <user_id>/...
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists avatars_insert on storage.objects;
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatars_delete on storage.objects;
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

notify pgrst, 'reload schema';
