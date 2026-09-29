-- 010800: KHÓA CHỐNG TRỪ XU HAI LẦN, TÀI KHOẢN QUẢN TRỊ KHÔNG NHẬN XU, SỬA LỖI BXH ĐẤU CLB
--   • Sổ cái: khóa theo mã giao dịch TRƯỚC khi kiểm tra trùng → hai yêu cầu cùng mã (bấm 2 lần, mạng gửi lại) chỉ ghi 1 lần,
--     lần sau nhận lại đúng giao dịch cũ (không báo lỗi). Khóa từng ví theo thứ tự cố định, kiểm tra số dư sau khi khóa.
--   • Lưới an toàn cuối: ví người dùng không bao giờ âm — kể cả khi có đoạn code ghi thẳng vào sổ cái (kiểm tra lúc chốt giao dịch).
--   • Tài khoản quản trị hệ thống không được cộng Xu (thưởng chạy, nhiệm vụ, giới thiệu, khuyến mãi…): phần Xu đó không phát hành.
--     Hoàn tiền (…REFUND) vẫn trả lại bình thường.
--   • Sửa lỗi "cannot cast type record to club_battles" ở tab BXH → Đấu CLB.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create unique index if not exists ledger_transactions_idempotency_uidx on public.ledger_transactions (idempotency_key);

-- Tài khoản quản trị hệ thống (không nhận Xu)
create or replace function private.is_admin_account(p_account uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = p_account and p.role = 'SYSTEM_ADMIN')
$$;

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

  -- 2. Tài khoản quản trị không nhận Xu: phần cộng cho admin trả về tài khoản hệ thống (không phát hành); hoàn tiền giữ nguyên
  if p_type not like '%REFUND%' then
    v_entries := (select jsonb_agg(case when (e->>'amount')::numeric > 0 and private.is_admin_account((e->>'account_id')::uuid)
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

-- Lưới an toàn: ví (trừ tài khoản hệ thống) không được âm khi chốt giao dịch
create or replace function private.ledger_no_negative() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.amount < 0 and new.account_id <> private.system_account()
     and coalesce(current_setting('racehub.ledger_allow_negative', true), '') <> 'on'
     and (select coalesce(sum(le.amount), 0) from public.ledger_entries le
           where le.account_id = new.account_id and le.coin_kind = new.coin_kind) < 0 then
    raise exception 'INSUFFICIENT_BALANCE';
  end if;
  return null;
end $$;
drop trigger if exists trg_ledger_no_negative on public.ledger_entries;
create constraint trigger trg_ledger_no_negative after insert on public.ledger_entries
  deferrable initially deferred for each row execute function private.ledger_no_negative();

-- Sự kiện thưởng: quản trị viên vẫn có XP, huy hiệu nhưng không hiện "+Xu"
create or replace function private.award(
  p_user uuid, p_kind text, p_title text, p_subtitle text, p_xu numeric, p_xp integer, p_key text,
  p_activity uuid default null, p_payload jsonb default '{}'::jsonb
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_rows integer; v_xu numeric := case when private.is_admin_account(p_user) then 0 else coalesce(p_xu, 0) end;
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

-- Sửa: truyền đúng kiểu club_battles (bản cũ kèm cột rn → lỗi "cannot cast type record to club_battles")
create or replace function public.club_battles_of(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return (select coalesce(jsonb_agg(private.club_battle_json(t.b)
                   order by case (t.b).status when 'ACCEPTED' then 0 when 'PENDING' then 1 else 2 end, (t.b).start_at desc), '[]'::jsonb)
            from (select x as b, row_number() over (order by x.created_at desc) as rn
                    from public.club_battles x where p_club_id in (x.challenger_id, x.opponent_id)) t
           where t.rn <= 30);
end $$;

revoke all on function private.is_admin_account(uuid), private.ledger_no_negative() from public, anon, authenticated;
