-- 010200: ĐỔI TÊN "Giải chạy ảo" → "Giải chạy" (tên tính năng, không đổi chức năng).
-- Đổi chữ trong: trang Hướng dẫn / Điều khoản / Quyền riêng tư, bài Kiến thức, thông báo cấp quyền tổ chức giải,
-- lý do trừ Xu khi tạo giải, thẻ gói mặc định. Thông báo / giao dịch đã gửi trước đây giữ nguyên chữ cũ.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

update public.help_pages
   set title = replace(replace(replace(title, 'GIẢI CHẠY ẢO', 'GIẢI CHẠY'), 'Giải chạy ảo', 'Giải chạy'), 'giải chạy ảo', 'giải chạy'), summary = replace(replace(replace(summary, 'GIẢI CHẠY ẢO', 'GIẢI CHẠY'), 'Giải chạy ảo', 'Giải chạy'), 'giải chạy ảo', 'giải chạy'), body = replace(replace(replace(body, 'GIẢI CHẠY ẢO', 'GIẢI CHẠY'), 'Giải chạy ảo', 'Giải chạy'), 'giải chạy ảo', 'giải chạy')
 where title ilike '%chạy ảo%' or summary ilike '%chạy ảo%' or body ilike '%giải chạy ảo%';

update public.content_articles
   set title = replace(replace(replace(title, 'GIẢI CHẠY ẢO', 'GIẢI CHẠY'), 'Giải chạy ảo', 'Giải chạy'), 'giải chạy ảo', 'giải chạy'), summary = replace(replace(replace(summary, 'GIẢI CHẠY ẢO', 'GIẢI CHẠY'), 'Giải chạy ảo', 'Giải chạy'), 'giải chạy ảo', 'giải chạy'), body = replace(replace(replace(body, 'GIẢI CHẠY ẢO', 'GIẢI CHẠY'), 'Giải chạy ảo', 'Giải chạy'), 'giải chạy ảo', 'giải chạy'), ctas = replace(replace(replace(ctas::text, 'GIẢI CHẠY ẢO', 'GIẢI CHẠY'), 'Giải chạy ảo', 'Giải chạy'), 'giải chạy ảo', 'giải chạy')::jsonb
 where title ilike '%giải chạy ảo%' or summary ilike '%giải chạy ảo%' or body ilike '%giải chạy ảo%' or ctas::text ilike '%giải chạy ảo%';

-- Thông báo khi admin cấp quyền tổ chức giải (bản 003800, chỉ đổi chữ)
create or replace function public.admin_set_race_organizer(p_owner_type text, p_owner_id uuid, p_allow boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_admin();
begin
  if upper(p_owner_type) not in ('USER', 'CLUB') then raise exception 'INVALID_OWNER'; end if;
  if p_allow then
    insert into public.race_organizer_grants (owner_type, owner_id, note, granted_by) values (upper(p_owner_type), p_owner_id, p_note, v_uid)
    on conflict (owner_type, owner_id) do update set note = excluded.note, granted_by = excluded.granted_by, created_at = now();
    if upper(p_owner_type) = 'CLUB' then
      perform private.notify_club(p_owner_id, true, 'CLUB_PRO', 'CLB được cấp quyền tổ chức giải chạy', null, '/races/new', v_uid);
    else
      perform private.notify(p_owner_id, null, 'VIP', 'Bạn được cấp quyền tổ chức giải chạy', null, '/races/new', v_uid, true);
    end if;
  else
    delete from public.race_organizer_grants where owner_type = upper(p_owner_type) and owner_id = p_owner_id;
  end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'RACE_ORGANIZER', p_owner_id::text, jsonb_build_object('type', upper(p_owner_type), 'allow', p_allow, 'note', p_note));
end $$;

-- Tạo giải: lý do trừ phí trong lịch sử Xu (bản 003800, chỉ đổi chữ)
create or replace function public.create_virtual_race(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_id uuid := gen_random_uuid();
  v_club uuid := nullif(p->>'club_id', '')::uuid;
  v_title text := trim(coalesce(p->>'title', ''));
  v_start timestamptz := (p->>'start_at')::timestamptz;
  v_end timestamptz := (p->>'end_at')::timestamptz;
  v_close timestamptz := coalesce(nullif(p->>'reg_close_at', '')::timestamptz, (p->>'end_at')::timestamptz);
  v_aud text := upper(coalesce(p->>'audience', 'PUBLIC'));
  v_max integer := nullif(p->>'max_participants', '')::integer;
  v_prefix text := upper(coalesce(nullif(trim(p->>'bib_prefix'), ''), 'RH'));
  v_dist numeric[];
  v_admin boolean := public.is_system_admin();
  v_payer uuid;
  v_fee integer := 0;
  v_pass uuid;
begin
  if not v_admin then
    if v_club is not null then
      if not public.club_is_staff(v_club) then raise exception 'FORBIDDEN'; end if;
      if not exists (select 1 from public.race_organizer_grants g where g.owner_type = 'CLUB' and g.owner_id = v_club) then raise exception 'RACE_ORGANIZER_REQUIRED'; end if;
    elsif not exists (select 1 from public.race_organizer_grants g where g.owner_type = 'USER' and g.owner_id = v_uid) then
      raise exception 'RACE_ORGANIZER_REQUIRED';
    end if;
    if v_max is null then raise exception 'CAPACITY_REQUIRED'; end if;
  end if;
  if length(v_title) < 3 or length(v_title) > 120 then raise exception 'INVALID_TITLE'; end if;
  if v_start is null or v_end is null or v_end <= v_start then raise exception 'INVALID_TIME_RANGE'; end if;
  if v_end < now() or v_end - v_start > interval '92 days' then raise exception 'INVALID_DURATION'; end if;
  if v_close > v_end or v_close < now() then raise exception 'INVALID_REG_CLOSE'; end if;
  if v_aud not in ('PUBLIC', 'CLUB_ONLY') or (v_aud = 'CLUB_ONLY' and v_club is null) then raise exception 'INVALID_AUDIENCE'; end if;
  if v_max is not null and (v_max < 2 or v_max > 100000) then raise exception 'INVALID_MAX'; end if;
  if v_prefix !~ '^[A-Z0-9]{1,6}$' then raise exception 'INVALID_BIB_PREFIX'; end if;
  v_dist := (select array_agg(d order by d) from (
               select distinct round((e)::numeric, 2) as d from jsonb_array_elements_text(coalesce(p->'distances', '[]'::jsonb)) as t(e)) s);
  if v_dist is null or array_length(v_dist, 1) > 6 or v_dist[1] < 1 or v_dist[array_length(v_dist, 1)] > 250 then
    raise exception 'INVALID_DISTANCES';
  end if;

  -- Phí theo quy mô (admin miễn phí). Lượt tạo (vé) dùng trước, rồi mới trừ Xu.
  if not v_admin then
    v_payer := coalesce(v_club, v_uid);
    perform private.issue_credits(case when v_club is null then 'USER' else 'CLUB' end, v_payer);
    v_fee := private.challenge_creation_fee(false, v_max, v_start, v_end);
    if v_fee > 0 then
      v_pass := (select t.id from (select x.id, row_number() over (order by x.expires_at nulls last, x.max_slots, x.created_at) as rn
                                     from public.challenge_passes x
                                    where x.owner_id = v_payer and x.remaining > 0 and x.max_slots >= v_max
                                      and (x.expires_at is null or x.expires_at > now())) t where t.rn = 1);
      if v_pass is not null then
        update public.challenge_passes set remaining = remaining - 1, updated_at = now() where id = v_pass;
        v_fee := 0;
      elsif private.balance(v_payer) < v_fee then
        raise exception '%', case when v_club is null then 'INSUFFICIENT_BALANCE' else 'INSUFFICIENT_TREASURY' end;
      else
        perform private.ledger_post('RACE_FEE', 'race_fee:' || v_id, 'Phí tạo giải chạy: ' || v_title, v_uid,
          private.debit_entries(v_payer, v_fee, private.system_account()), v_id);
        if v_club is not null then
          insert into public.club_treasury_log (club_id, user_id, amount, kind, note)
          values (v_club, v_uid, -v_fee, 'SPEND', left('Phí tạo giải: ' || v_title, 200));
        end if;
      end if;
    end if;
  end if;

  insert into public.virtual_races (id, organizer_id, club_id, title, description, start_at, end_at, reg_close_at, distances,
                                    audience, max_participants, bib_prefix, fee_charged, pass_id)
  values (v_id, v_uid, v_club, v_title, nullif(left(trim(coalesce(p->>'description', '')), 3000), ''), v_start, v_end, v_close,
          v_dist, v_aud, v_max, v_prefix, v_fee, v_pass);
  return v_id;
end $$;

-- Thẻ gói mặc định (bản 009200, chỉ đổi chữ)
create or replace function private.plan_content_defaults() returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'free', jsonb_build_object('title', 'Miễn phí', 'subtitle', '',
      'perks', jsonb_build_array(
        'Ghi bài bằng GPS trong app hoặc tự động từ Strava',
        'Xu, XP, cấp độ, huy hiệu, nhiệm vụ, nhân vật',
        'Tham gia thử thách, CLB, giải chạy, tổ chức không giới hạn',
        'Tạo miễn phí thử thách cá nhân và thử thách nhóm tới {freeSlots} người',
        'Thử thách đông hơn {freeSlots} người: trả Xu theo quy mô'),
      'note', 'VIP không tăng km, XP hay thứ hạng — mọi runner thi đấu công bằng.'),
    'clubFree', jsonb_build_object('title', 'CLB Miễn phí', 'subtitle', '',
      'perks', jsonb_build_array(
        'Tối đa {clubMaxMembers} thành viên',
        '{clubMaxOpen} thử thách nội bộ miễn phí cùng lúc, mỗi thử thách ≤ {clubMaxSlots} người (cần ≥ {clubMinActive} thành viên có bài chạy trong {activeDays} ngày)',
        'Tối đa {clubCaptains} quản trị viên',
        'Bảng tin, chat, lịch, điểm danh QR, quỹ VietQR, bảng xếp hạng',
        'Ngày hội ×2/×3, đại sảnh danh vọng, cửa hàng CLB, giao lưu CLB'),
      'note', 'CLB miễn phí vượt số thành viên vẫn giữ đủ người, chỉ chưa duyệt thêm người mới cho tới khi nâng Pro.'),
    'org', jsonb_build_object('title', 'RaceHub Doanh nghiệp', 'subtitle', 'Báo giá riêng theo số người và thời hạn',
      'perks', jsonb_build_array(
        'Chiến dịch sức khoẻ cho cả tổ chức (km, số buổi, số ngày chạy)',
        'Bảng xếp hạng phòng ban / chi nhánh / CLB — tổng và bình quân đầu người',
        'Nhập danh sách nhân viên từ Excel, tự duyệt email công ty, đơn vị nhiều cấp',
        'Báo cáo theo mã nhân viên, xuất Excel',
        'Chốt kết quả, chứng nhận hoàn thành, quay thưởng minh bạch',
        'Quản lý nhiều CLB, tài trợ CLB Pro cho cả hệ thống'),
      'note', ''))
$$;

notify pgrst, 'reload schema';
