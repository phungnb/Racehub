-- 011300: TÀI KHOẢN QUẢN TRỊ CŨNG LÀ VĐV — VẪN NHẬN XU TỪ CHẠY BỘ VÀ NẠP TIỀN, CHỈ CHẶN XU TỰ CẤP
--   Admin dùng Strava chính để chạy như mọi người: thưởng bài chạy, điểm danh, chuỗi tuần, lên cấp, huy hiệu, league,
--   giải thưởng thử thách (Xu người tạo treo, không phát hành mới), Xu nạp bằng tiền (VietQR / cửa hàng) và hoàn tiền → NHẬN bình thường.
--   Vẫn CHẶN nguồn admin có thể tự cấp cho mình: khuyến mãi / mã khuyến mãi, cộng tay (ADMIN_GRANT), thưởng giới thiệu,
--   thưởng nhiệm vụ (admin tự tạo được nhiệm vụ) → phần đó không phát hành (về tài khoản hệ thống).
--   Admin KHÔNG tự xác nhận đơn nạp / mua gói của chính mình (cần admin khác xác nhận) — chặn "in Xu" không trả tiền.
-- Thay luật "admin không nhận Xu" của 010800. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT. Chạy lại an toàn.

-- Loại giao dịch admin vẫn được cộng Xu vào ví của mình
create or replace function private.admin_credit_allowed(p_type text) returns boolean
language sql immutable as $$
  select p_type like '%REFUND%' or p_type = any (array[
    'RUN_REWARD', 'LEVEL_UP_XU', 'GAME_CHECKIN', 'GAME_STREAK', 'GAME_COMEBACK', 'GAME_BADGE', 'GAME_LEAGUE',
    'CHALLENGE_PRIZE', 'XU_PURCHASE', 'XU_PURCHASE_BONUS', 'IAP_TOPUP_VND', 'RATE_CONVERSION'])
$$;
revoke all on function private.admin_credit_allowed(text) from public, anon, authenticated;

create or replace function private.ledger_post(
  p_type text, p_idempotency_key text, p_reason text, p_created_by uuid, p_entries jsonb,
  p_ref uuid default null, p_allow_negative boolean default false
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_tx uuid;
  v_e record;
  v_entries jsonb := p_entries;
  v_bal numeric;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 3 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  -- 1. Cùng mã giao dịch → xếp hàng; ai tới sau nhận lại giao dịch đã ghi
  perform pg_advisory_xact_lock(hashtextextended('ledger-key:' || p_idempotency_key, 0));
  v_tx := (select t.id from public.ledger_transactions t where t.idempotency_key = p_idempotency_key);
  if v_tx is not null then return v_tx; end if;

  if jsonb_typeof(v_entries) <> 'array' or jsonb_array_length(v_entries) < 2 then raise exception 'LEDGER_INVALID_ENTRIES'; end if;
  if (select coalesce(sum((e->>'amount')::numeric), 0) from jsonb_array_elements(v_entries) e) <> 0 then raise exception 'LEDGER_UNBALANCED'; end if;

  -- 2. Tài khoản quản trị không nhận Xu TỰ CẤP (khuyến mãi, cộng tay, giới thiệu, nhiệm vụ): phần đó về tài khoản hệ thống.
  --    Xu kiếm theo luật (chạy bộ, điểm danh, chuỗi, lên cấp…), Xu nạp bằng tiền và hoàn tiền vẫn nhận như người thường.
  --    Admin không tự nạp Xu cho mình (tự xác nhận đơn của chính mình = in Xu không cần trả tiền).
  if not private.admin_credit_allowed(p_type) or p_type like 'XU_PURCHASE%' then
    v_entries := (select jsonb_agg(case when (e->>'amount')::numeric > 0 and private.is_admin_account((e->>'account_id')::uuid)
                                         and (not private.admin_credit_allowed(p_type) or (e->>'account_id')::uuid = p_created_by)
                                        then jsonb_set(e, '{account_id}', to_jsonb(private.system_account()::text)) else e end)
                    from jsonb_array_elements(v_entries) e);
  end if;
  if p_allow_negative then perform set_config('racehub.ledger_allow_negative', 'on', true); end if;

  -- 3. Khóa từng ví theo thứ tự cố định (tránh deadlock), rồi mới kiểm tra số dư
  for v_e in
    select distinct (e->>'account_id')::uuid as acc, e->>'coin_kind' as kind
      from jsonb_array_elements(v_entries) e
     order by 1, 2
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_e.acc::text || ':' || v_e.kind, 0));
  end loop;

  v_tx := gen_random_uuid();
  insert into public.ledger_transactions (id, type, idempotency_key, reason, created_by, campaign_id)
  values (v_tx, p_type, p_idempotency_key, p_reason, p_created_by, p_ref);

  for v_e in
    select (e->>'account_id')::uuid as acc, e->>'coin_kind' as kind, sum((e->>'amount')::numeric) as amt
      from jsonb_array_elements(v_entries) e
     group by 1, 2
  loop
    if v_e.kind not in ('BONUS', 'PAID') then raise exception 'LEDGER_INVALID_COIN_KIND'; end if;
    if v_e.amt = 0 then continue; end if;
    if v_e.amt < 0 and v_e.acc <> private.system_account() and not p_allow_negative then
      v_bal := (select coalesce(sum(le.amount), 0) from public.ledger_entries le where le.account_id = v_e.acc and le.coin_kind = v_e.kind);
      if v_bal + v_e.amt < 0 then raise exception 'INSUFFICIENT_BALANCE'; end if;
    end if;
    insert into public.ledger_entries (transaction_id, account_id, coin_kind, amount)
    values (v_tx, v_e.acc, v_e.kind, v_e.amt);
  end loop;

  -- 4. Đồng bộ bản sao số dư
  update public.profiles p set xu = s.total
    from (select account_id, sum(amount) as total from public.ledger_entries
           where account_id in (select (e->>'account_id')::uuid from jsonb_array_elements(v_entries) e)
           group by account_id) s
   where p.id = s.account_id;
  update public.clubs c set treasury_balance = s.total
    from (select account_id, sum(amount) as total from public.ledger_entries
           where account_id in (select (e->>'account_id')::uuid from jsonb_array_elements(v_entries) e)
           group by account_id) s
   where c.id = s.account_id;

  return v_tx;
end $$;

create or replace function private.award(
  p_user uuid, p_kind text, p_title text, p_subtitle text, p_xu numeric, p_xp integer, p_key text,
  p_activity uuid default null, p_payload jsonb default '{}'::jsonb
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_rows integer; v_xu numeric := case when private.is_admin_account(p_user) and not private.admin_credit_allowed('GAME_' || p_kind) then 0 else coalesce(p_xu, 0) end;
begin
  insert into public.game_events (user_id, kind, title, subtitle, xu, xp, activity_id, payload, dedupe_key)
  values (p_user, p_kind, left(p_title, 160), left(p_subtitle, 200), v_xu, coalesce(p_xp, 0), p_activity,
          coalesce(p_payload, '{}'::jsonb), p_key)
  on conflict (dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return false; end if;
  if v_xu > 0 then
    perform private.ledger_post('GAME_' || p_kind, 'game:' || p_key, p_title, p_user,
      jsonb_build_array(
        jsonb_build_object('account_id', p_user, 'coin_kind', 'BONUS', 'amount', v_xu),
        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -v_xu)),
      p_activity);
  end if;
  perform private.add_xp(p_user, p_xp, p_activity);
  return true;
end $$;

-- Xác nhận đơn: không tự xác nhận đơn của chính mình
create or replace function public.admin_confirm_order(p_order_id uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_admin(); o public.orders := (select x from public.orders x where x.id = p_order_id for update);
begin
  if o.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.status = 'PAID' then return private.order_json(o); end if;
  if o.status <> 'PENDING' then raise exception 'ORDER_NOT_PENDING'; end if;
  -- Đơn của chính mình (người mua hoặc chủ ví / gói) phải do admin khác xác nhận
  if o.buyer_id = v_uid or o.owner_id = v_uid then raise exception 'SELF_CONFIRM_FORBIDDEN'; end if;
  update public.orders set status = 'PAID', paid_at = now(), confirmed_by = v_uid, note = nullif(trim(coalesce(p_note, '')), '') where id = o.id;
  if o.kind = 'PLAN' then
    perform private.grant_subscription(o.owner_type, o.owner_id, o.plan_code, o.months, 'ORDER', o.id, 'Đơn ' || o.code, v_uid);
  else
    perform private.ledger_post('XU_PURCHASE', 'order:' || o.id, 'Nạp Xu — đơn ' || o.code, v_uid,
      jsonb_build_array(jsonb_build_object('account_id', o.owner_id, 'coin_kind', 'PAID', 'amount', o.xu),
                        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'PAID', 'amount', -o.xu)), o.id);
    if o.bonus_xu > 0 then
      perform private.ledger_post('XU_PURCHASE_BONUS', 'order_bonus:' || o.id, 'Tặng thêm khi nạp — đơn ' || o.code, v_uid,
        jsonb_build_array(jsonb_build_object('account_id', o.owner_id, 'coin_kind', 'BONUS', 'amount', o.bonus_xu),
                          jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -o.bonus_xu)), o.id);
    end if;
    perform private.notify(o.owner_id, null, 'ADMIN_XU', 'Đã nạp ' || (o.xu + o.bonus_xu) || ' Xu', 'Đơn ' || o.code || ' đã được xác nhận.', '/wallet', v_uid, true);
  end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'CONFIRM_ORDER', o.code, jsonb_build_object('kind', o.kind, 'amount_vnd', o.amount_vnd, 'plan', o.plan_code, 'xu', o.xu));
  return private.order_json((select x from public.orders x where x.id = o.id));
end $$;
