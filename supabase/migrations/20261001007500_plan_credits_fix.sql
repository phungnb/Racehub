-- 007500: Sửa lỗi "Không tính được phí" khi tạo thử thách / giải chạy cho CLB Pro + báo giá biết gói đang dùng.
-- Sự cố (09/2026): CLB được admin bật Pro bằng tay (NO BEER NO RUN) → tạo thử thách báo "Không tính được phí".
-- Nguyên nhân: private.issue_credits (003800) có biến vòng lặp tên "c" trùng bí danh bảng "clubs c" trong câu lấy pro_until
-- → lỗi 'record "c" is not assigned yet' mỗi lần báo giá / tạo cho CLB Pro không có đơn mua gói.
-- Sửa: đổi tên biến. Báo giá quote_challenge trả thêm:
--   plan: gói đang hiệu lực của bên trả phí (VIP / CLB Pro) — để giao diện ẩn phần phí khi đã được gói bao;
--   best_pass_slots: quy mô lớn nhất mà lượt tạo miễn phí còn lại bao được.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT. Chạy lại nhiều lần vẫn an toàn.

create or replace function private.issue_credits(p_owner_type text, p_owner uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_plan jsonb := private.active_plan(p_owner);
  v_code text;
  v_until timestamptz;
  v_month timestamptz := private.vn_month_start(now());
  v_next timestamptz := private.vn_month_start(private.vn_month_start(now()) + interval '32 days');
  r_credit record;
  n integer := 0;
begin
  if v_plan <> 'null'::jsonb then
    v_code := v_plan->>'plan_code'; v_until := (v_plan->>'ends_at')::timestamptz;
  elsif p_owner_type = 'CLUB' and private.club_is_pro(p_owner) then           -- CLB Pro do admin bật tay
    v_code := 'CLUB_PRO'; v_until := coalesce((select cl.pro_until from public.clubs cl where cl.id = p_owner), v_next);
  else
    return 0;
  end if;
  for r_credit in select pc.capacity, pc.per_month from public.plan_credits pc where pc.plan_code = v_code loop
    insert into public.challenge_passes (owner_type, owner_id, max_slots, total, remaining, expires_at, note, source_key)
    values (p_owner_type, p_owner, r_credit.capacity, r_credit.per_month, r_credit.per_month, least(v_next, v_until),
            'Lượt tạo ' || coalesce((select p.name from public.plans p where p.code = v_code), v_code) || ' tháng '
              || to_char(v_month at time zone 'Asia/Ho_Chi_Minh', 'MM/YYYY'),
            'credit:' || p_owner || ':' || v_code || ':' || to_char(v_month at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM') || ':' || r_credit.capacity)
    on conflict (source_key) where source_key is not null do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Gói đang hiệu lực của một người / CLB (CLB Pro bật tay cũng tính)
create or replace function private.plan_badge(p_owner uuid, p_is_club boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select case
    when private.active_plan(p_owner) <> 'null'::jsonb
      then jsonb_build_object('code', private.active_plan(p_owner)->>'plan_code', 'name', private.active_plan(p_owner)->>'name')
    when p_is_club and private.club_is_pro(p_owner)
      then jsonb_build_object('code', 'CLUB_PRO', 'name', coalesce((select p.name from public.plans p where p.code = 'CLUB_PRO'), 'CLB Pro'))
    else null end
$$;

create or replace function public.quote_challenge(p_max_slots integer, p_format text default 'RANKED', p_club_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_slots integer := case when p_format = 'DUEL' then 2 when p_format = 'SOLO_GOAL' then 1 else greatest(coalesce(p_max_slots, 1), 1) end;
  v_fee integer := private.challenge_creation_fee(p_format = 'TEAM', v_slots, now(), now() + interval '1 day');
  v_payer uuid := case when p_club_id is not null and public.club_is_staff(p_club_id) then p_club_id else v_uid end;
  v_pass public.challenge_passes;
begin
  perform private.issue_credits(case when v_payer = v_uid then 'USER' else 'CLUB' end, v_payer);
  v_pass := (select t.x from (select x, row_number() over (order by x.expires_at nulls last, x.max_slots, x.created_at) as rn
                                from public.challenge_passes x
                               where x.owner_id = v_payer and x.remaining > 0 and x.max_slots >= v_slots
                                 and (x.expires_at is null or x.expires_at > now())) t where t.rn = 1);
  return jsonb_build_object(
    'fee', v_fee, 'tier', private.capacity_tier(v_slots), 'custom', private.capacity_tier(v_slots)->>'xu' is null,
    'payer', case when v_payer = v_uid then 'USER' else 'CLUB' end,
    'payer_balance', private.balance(v_payer), 'wallet_balance', private.balance(v_uid),
    'pass', case when v_pass.id is null or v_fee = 0 then null
                 else jsonb_build_object('id', v_pass.id, 'remaining', v_pass.remaining, 'max_slots', v_pass.max_slots,
                                         'expires_at', v_pass.expires_at, 'note', v_pass.note) end,
    'plan', private.plan_badge(v_payer, v_payer <> v_uid),
    'best_pass_slots', coalesce((select max(x.max_slots) from public.challenge_passes x
                                  where x.owner_id = v_payer and x.remaining > 0 and (x.expires_at is null or x.expires_at > now())), 0),
    'xu_vnd', (private.economy_config()->>'xuVnd')::numeric,
    'policy', private.economy_config());
end $$;

revoke all on function private.issue_credits(text, uuid), private.plan_badge(uuid, boolean) from public, anon, authenticated;
revoke all on function public.quote_challenge(integer, text, uuid) from public, anon;
grant execute on function public.quote_challenge(integer, text, uuid) to authenticated;

notify pgrst, 'reload schema';
