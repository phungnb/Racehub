-- 008600: Tổ chức DEMO cho admin và khách dùng thử gói Doanh nghiệp.
-- • admin_create_demo_org(p): admin bấm một nút → tạo tổ chức "[DEMO] …" có sẵn dữ liệu mẫu để xem ngay cấu trúc quản lý:
--     đơn vị nhiều cấp (theo loại hình: phòng ban / khối-lớp / khu vực), một chiến dịch đang chạy (mục tiêu chung + mỗi người,
--     trần km/ngày, ngày hội ×2, chứng nhận), bảng tin có thông báo ghim. Admin là chủ tổ chức.
--   Tuỳ chọn guest_email: thêm khách (đã có tài khoản RaceHub) làm QUẢN TRỊ VIÊN để khách tự bấm thử mọi chức năng quản lý.
--   Demo hết hạn sau p.days ngày (mặc định 14, tối đa 60), tối đa 50 chỗ; không tài trợ CLB Pro. Người khác vào bằng mã mời như thật.
-- • admin_delete_demo_org(p_org): xoá hẳn tổ chức demo (chỉ tổ chức tên bắt đầu "[DEMO]"), ghi nhật ký.
-- Cần 008300, 008400. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create or replace function public.admin_create_demo_org(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  v_kind text := case when p->>'kind' in ('COMPANY', 'FEDERATION', 'SCHOOL') then p->>'kind' else 'COMPANY' end;
  v_name text := left(coalesce(nullif(trim(coalesce(p->>'name', '')), ''),
                               case v_kind when 'FEDERATION' then 'Liên đoàn Chạy bộ Mẫu' when 'SCHOOL' then 'Trường THPT Mẫu' else 'Công ty Mẫu' end), 100);
  v_guest_email text := nullif(lower(trim(coalesce(p->>'guest_email', ''))), '');
  v_guest uuid := (select u.id from auth.users u where lower(u.email) = v_guest_email);
  v_days integer := least(greatest(coalesce(nullif(p->>'days', '')::int, 14), 1), 60);
  v_id uuid := gen_random_uuid();
  v_code text := private.org_new_code();
  v_a uuid := gen_random_uuid();
  v_a1 uuid := gen_random_uuid();
  v_a2 uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_c uuid := gen_random_uuid();
  v_camp uuid := gen_random_uuid();
  v_boost text := to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date + 7, 'YYYY-MM-DD');
begin
  if v_guest_email is not null and v_guest is null then raise exception 'OWNER_NOT_FOUND'; end if;

  insert into public.organizations (id, name, kind, description, tagline, theme, invite_code, join_policy, unit_label,
                                    seat_limit, club_limit, include_club_pro, active_until, contact_email, created_by)
  values (v_id, '[DEMO] ' || v_name, v_kind,
          'Tổ chức dùng thử gói RaceHub Doanh nghiệp. Dữ liệu mẫu — có thể xoá bất cứ lúc nào.',
          'Chạy vì sức khoẻ, về đích cùng nhau', 'OCEAN', v_code, 'OPEN',
          case v_kind when 'SCHOOL' then 'Lớp' when 'FEDERATION' then 'Khu vực' else 'Phòng ban' end,
          50, case when v_kind = 'FEDERATION' then 5 else 0 end, false, now() + make_interval(days => v_days), v_guest_email, v_admin);

  -- Đơn vị nhiều cấp theo loại hình
  insert into public.org_units (id, org_id, name, sort, parent_id) values
    (v_a, v_id, case v_kind when 'SCHOOL' then 'Khối 10' when 'FEDERATION' then 'Miền Bắc' else 'Phòng Kinh doanh' end, 1, null),
    (v_a1, v_id, case v_kind when 'SCHOOL' then '10A1' when 'FEDERATION' then 'Hà Nội' else 'Kinh doanh Miền Bắc' end, 1, v_a),
    (v_a2, v_id, case v_kind when 'SCHOOL' then '10A2' when 'FEDERATION' then 'Hải Phòng' else 'Kinh doanh Miền Nam' end, 2, v_a),
    (v_b, v_id, case v_kind when 'SCHOOL' then 'Khối 11' when 'FEDERATION' then 'Miền Trung' else 'Phòng Kỹ thuật' end, 2, null),
    (v_c, v_id, case v_kind when 'SCHOOL' then 'Giáo viên' when 'FEDERATION' then 'Miền Nam' else 'Hành chính – Nhân sự' end, 3, null);

  insert into public.org_members (org_id, user_id, role, status, unit_id) values (v_id, v_admin, 'OWNER', 'APPROVED', v_c);
  if v_guest is not null and v_guest <> v_admin then
    insert into public.org_members (org_id, user_id, role, status, unit_id) values (v_id, v_guest, 'ADMIN', 'APPROVED', v_a1)
    on conflict (org_id, user_id) do nothing;
  end if;

  insert into public.org_campaigns (id, org_id, title, description, metric, starts_at, ends_at, goal_total, goal_per_person, min_run_km,
                                    daily_cap_km, boost_days, cert_enabled, created_by)
  values (v_camp, v_id, '30 ngày – cùng nhau 1.000 km',
          'Chiến dịch mẫu: mỗi người 30 km trong 30 ngày, cả tổ chức cùng chinh phục 1.000 km. Bài từ 1 km, tối đa 21 km mỗi ngày. '
          || 'Ngày hội ' || v_boost || ' tính ×2. Đạt mục tiêu nhận chứng nhận hoàn thành.',
          'DISTANCE', now() - interval '3 days', now() + interval '27 days', 1000, 30, 1, 21,
          jsonb_build_array(jsonb_build_object('date', v_boost, 'mult', 2)), true, v_admin);

  insert into public.org_posts (org_id, author_id, kind, body, is_pinned, meta) values
    (v_id, v_admin, 'ANNOUNCEMENT',
     'Chào mừng đến với tổ chức dùng thử! Mời đồng nghiệp bằng mã ' || v_code || ', xem bảng xếp hạng theo '
     || case v_kind when 'SCHOOL' then 'lớp' when 'FEDERATION' then 'khu vực' else 'phòng ban' end
     || ', thử nhập danh sách từ Excel và xuất báo cáo ở tab Báo cáo.', true, '{}'::jsonb),
    (v_id, v_admin, 'CAMPAIGN', 'Chiến dịch "30 ngày – cùng nhau 1.000 km" đã bắt đầu. Chạy bài đầu tiên để lên bảng!', false,
     jsonb_build_object('campaign_id', v_camp));

  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_admin, 'ORG_DEMO_CREATE', 'org:' || v_id, jsonb_build_object('kind', v_kind, 'days', v_days, 'guest_id', v_guest));
  if v_guest is not null and v_guest <> v_admin then
    perform private.notify(v_guest, null, 'ORG_CREATED', 'Mời bạn dùng thử RaceHub Doanh nghiệp',
      'Bạn là quản trị viên của tổ chức dùng thử "' || v_name || '" trong ' || v_days || ' ngày.', '/orgs/' || v_id, v_admin, true);
  end if;
  return jsonb_build_object('id', v_id, 'invite_code', v_code, 'campaign_id', v_camp);
end $$;

create or replace function public.admin_delete_demo_org(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  v_old public.organizations := (select o from public.organizations o where o.id = p_org);
begin
  if v_old.id is null then raise exception 'ORG_NOT_FOUND'; end if;
  if v_old.name not like '[DEMO]%' then raise exception 'NOT_DEMO'; end if;
  delete from public.organizations where id = p_org;
  insert into public.admin_audit_log (actor_id, action, target, old_value)
  values (v_admin, 'ORG_DEMO_DELETE', 'org:' || p_org, jsonb_build_object('name', v_old.name));
end $$;

revoke all on function public.admin_create_demo_org(jsonb), public.admin_delete_demo_org(uuid) from public, anon;
grant execute on function public.admin_create_demo_org(jsonb), public.admin_delete_demo_org(uuid) to authenticated;

notify pgrst, 'reload schema';
