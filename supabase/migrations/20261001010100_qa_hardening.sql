-- 010100: VÁ SAU NGHIỆM THU
-- 1. Chín bảng tạo sau này còn quyền ghi mặc định (INSERT / UPDATE / DELETE) cho anon và authenticated. RLS không có luật ghi
--    nên thực tế đã bị chặn, nhưng thu hồi để hai lớp bảo vệ: mọi thao tác ghi chỉ đi qua RPC đã kiểm tra quyền.
-- 2. Yêu cầu báo giá Doanh nghiệp (gửi được khi chưa đăng nhập): trước chỉ giới hạn theo số điện thoại → đổi số là gửi được
--    hàng loạt, spam thông báo tới admin. Thêm giới hạn 5 / ngày mỗi tài khoản và 20 / giờ cho toàn bộ khách chưa đăng nhập.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

revoke insert, update, delete, truncate on public.challenge_honor_prefs, public.challenge_honorees, public.challenge_honors,
  public.item_promo_redemptions, public.item_promotions, public.partners, public.voucher_campaigns, public.voucher_codes,
  public.voucher_grants from anon, authenticated;

create index if not exists org_leads_user_idx on public.org_leads (user_id, created_at desc);

create or replace function public.request_enterprise_quote(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_phone text := regexp_replace(trim(coalesce(p->>'phone', '')), '\s+', ' ', 'g');
  v_id uuid;
  a record;
begin
  if char_length(trim(coalesce(p->>'contact_name', ''))) < 2 then raise exception 'NAME_REQUIRED'; end if;
  if char_length(trim(coalesce(p->>'org_name', ''))) < 2 then raise exception 'ORG_NAME_REQUIRED'; end if;
  if v_phone !~ '^[0-9+ .()-]{8,20}$' then raise exception 'INVALID_PHONE'; end if;
  if (select count(*) from public.org_leads l where l.phone = v_phone and l.created_at > now() - interval '1 day') >= 3 then
    raise exception 'RATE_LIMITED';
  end if;
  -- 010100: đổi số điện thoại để gửi hàng loạt → giới hạn thêm theo tài khoản và tổng số yêu cầu chưa đăng nhập
  if auth.uid() is not null
     and (select count(*) from public.org_leads l where l.user_id = auth.uid() and l.created_at > now() - interval '1 day') >= 5 then
    raise exception 'RATE_LIMITED';
  end if;
  if auth.uid() is null
     and (select count(*) from public.org_leads l where l.user_id is null and l.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'RATE_LIMITED';
  end if;
  v_id := gen_random_uuid();
  insert into public.org_leads (id, user_id, contact_name, org_name, kind, size, phone, email, note)
  values (v_id, auth.uid(), left(trim(p->>'contact_name'), 80), left(trim(p->>'org_name'), 120),
          case when p->>'kind' in ('COMPANY', 'FEDERATION', 'SCHOOL', 'OTHER') then p->>'kind' else 'OTHER' end,
          case when coalesce(p->>'size', '') ~ '^[0-9]{1,7}$' then greatest((p->>'size')::int, 1) end, v_phone,
          nullif(left(trim(coalesce(p->>'email', '')), 120), ''), nullif(left(trim(coalesce(p->>'note', '')), 1000), ''));
  for a in select pr.id from public.profiles pr where pr.role = 'SYSTEM_ADMIN' loop
    perform private.notify(a.id, null, 'ENTERPRISE_LEAD', 'Yêu cầu báo giá Doanh nghiệp: ' || left(trim(p->>'org_name'), 80),
      left(trim(p->>'contact_name'), 80) || ' · ' || v_phone, '/admin?tab=enterprise', auth.uid(), true);
  end loop;
  return jsonb_build_object('id', v_id);
end $$;

notify pgrst, 'reload schema';
