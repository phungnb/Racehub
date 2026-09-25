-- 004100: Rà soát bảo mật + cơ chế quản trị (governance) + sửa lệch kinh tế.
-- A. Bảo mật: khóa ghi trực tiếp vào các bảng cũ không còn dùng; bỏ quyền gọi hàm quản trị / CLB của khách chưa đăng nhập;
--    cố định search_path cho 3 hàm SECURITY DEFINER cũ; hàm cấp lượt hằng tháng chỉ cho máy chủ (service_role).
-- B. Quản trị:
--    • Không tự phục vụ mình: admin không cộng Xu / tặng lượt / cấp gói / xác nhận đơn / cấp quyền tổ chức giải / bật Pro
--      cho chính mình hoặc CLB mình là thành viên (SELF_ACTION_FORBIDDEN).
--    • Hai người duyệt (maker-checker): lệnh cộng/trừ Xu lớn, vượt trần ngày của một admin, tặng nhiều lượt, cấp gói dài
--      → thành yêu cầu chờ MỘT ADMIN KHÁC duyệt (Quản trị → Phê duyệt). Ngưỡng nằm ở private.app_settings,
--      CHỈ sửa được bằng SQL Editor (admin trong app không tự nới được).
--    • Nhật ký quản trị và sổ cái không sửa / xóa được (kể cả bằng quyền admin trong app).
-- C. Kinh tế: bỏ XP thưởng khi chốt thử thách (XP chỉ từ km); thưởng từ quỹ CLB chỉ trao khi có ≥ 3 người có kết quả
--    (chống ban quản trị tự tạo thử thách rồi tự nhận quỹ), và mỗi lần treo tối đa 50% số dư quỹ.
-- Cần file 004000. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

-- ---------------------------------------------------------------------
-- A. Bảo mật
-- ---------------------------------------------------------------------
-- Bảng cũ (hệ thống quyền động, nhật ký cũ, mẫu cũ): app không ghi trực tiếp → thu quyền ghi (RLS đã chặn, đây là lớp thứ hai)
revoke insert, update, delete on public.achievements, public.audit_logs, public.challenge_templates, public.club_tournaments,
  public.permissions, public.roles, public.role_permissions, public.club_member_roles, public.club_announcements from anon, authenticated;
revoke delete on public.profiles, public.user_avatar from anon, authenticated;

-- Hàm SECURITY DEFINER cũ chưa cố định search_path (chống chiếm quyền bằng đối tượng trùng tên)
alter function public.delete_club(uuid, text) set search_path = public;
alter function public.delete_club(uuid) set search_path = public;
alter function public.equip_avatar_item(uuid, text) set search_path = public;
alter function public.execute_ledger_transaction(text, text, text, uuid, jsonb) set search_path = public;

-- Khách chưa đăng nhập không cần gọi các hàm quản trị / quản lý CLB (hàm vẫn tự kiểm tra, đây là lớp thứ hai)
revoke execute on function public.admin_set_club_plan(uuid, text, timestamptz, text), public.delete_club(uuid, text), public.delete_club(uuid),
  public.join_club(uuid), public.leave_club(uuid, uuid), public.remove_member(uuid), public.rotate_invite_code(uuid),
  public.set_club_announcement(uuid, text), public.set_club_slug(uuid, text), public.set_member_role(uuid, text),
  public.set_member_status(uuid, text), public.transfer_club_ownership(uuid, uuid), public.transfer_ownership(uuid, uuid),
  public.update_club(uuid, text, text, text, text), public.update_club_policy(uuid, text, integer),
  public.club_attendance_report(uuid, timestamptz, timestamptz), public.club_plan(uuid) from anon;

-- Việc định kỳ: chỉ máy chủ (cron) gọi
revoke execute on function public.issue_due_credits() from public, anon, authenticated;
grant execute on function public.issue_due_credits() to service_role;

-- ---------------------------------------------------------------------
-- B1. Ngưỡng quản trị (chỉ chỉnh bằng SQL Editor)
-- ---------------------------------------------------------------------
insert into private.app_settings (key, value) values
  ('gov_approval_xu', '5000'),          -- |Xu| mỗi lệnh từ mức này → cần admin khác duyệt
  ('gov_daily_xu', '20000'),            -- tổng |Xu| một admin tự cộng/trừ trong ngày; vượt → cần duyệt
  ('gov_approval_pass_qty', '10'),      -- tặng từ 10 lượt tạo một lần → cần duyệt
  ('gov_approval_pass_slots', '500'),   -- lượt cho quy mô > 500 người → cần duyệt
  ('gov_approval_plan_months', '3')     -- cấp gói tay từ 3 tháng → cần duyệt
on conflict (key) do nothing;

create or replace function private.gov_num(p_key text, p_default numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(value, '')::numeric from private.app_settings where key = p_key), p_default)
$$;

-- Admin không tự phục vụ mình / CLB của mình
create or replace function private.forbid_self(p_admin uuid, p_type text, p_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_admin is null then return; end if;
  if upper(p_type) = 'USER' and p_id = p_admin then raise exception 'SELF_ACTION_FORBIDDEN'; end if;
  if upper(p_type) = 'CLUB' and exists (select 1 from public.club_members m where m.club_id = p_id and m.user_id = p_admin and m.status = 'APPROVED') then
    raise exception 'SELF_ACTION_FORBIDDEN';
  end if;
end $$;

create or replace function private.target_name(p_type text, p_id uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if upper(p_type) = 'USER' then v := (select p.display_name from public.profiles p where p.id = p_id); if v is null then raise exception 'USER_NOT_FOUND'; end if;
  elsif upper(p_type) = 'CLUB' then v := (select c.name from public.clubs c where c.id = p_id); if v is null then raise exception 'CLUB_NOT_FOUND'; end if;
  else raise exception 'INVALID_TARGET';
  end if;
  return coalesce(v, 'Runner');
end $$;

-- ---------------------------------------------------------------------
-- B2. Yêu cầu chờ duyệt
-- ---------------------------------------------------------------------
create table if not exists public.admin_approvals (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('GRANT_XU', 'GRANT_PASS', 'GRANT_PLAN')),
  payload jsonb not null,
  summary text not null,
  idem_key text unique,
  requested_by uuid not null references public.profiles(id),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  note text,
  result jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_approvals_status_idx on public.admin_approvals (status, created_at desc);
alter table public.admin_approvals enable row level security;
revoke all on public.admin_approvals from anon, authenticated;

create or replace function private.request_approval(p_admin uuid, p_action text, p_payload jsonb, p_summary text, p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid := (select a.id from public.admin_approvals a where a.idem_key = p_key); s record;
begin
  if v_id is null then
    insert into public.admin_approvals (action, payload, summary, idem_key, requested_by) values (p_action, p_payload, p_summary, p_key, p_admin)
    returning id into v_id;
    insert into public.admin_audit_log (actor_id, action, target, new_value, reason)
    values (p_admin, 'REQUEST_APPROVAL', p_action, p_payload || jsonb_build_object('approval_id', v_id), p_summary);
    for s in select p.id from public.profiles p where p.role = 'SYSTEM_ADMIN' and p.id <> p_admin loop
      perform private.notify(s.id, null, 'ADMIN_APPROVAL', 'Cần duyệt: ' || p_summary, 'Yêu cầu từ ' || private.display_name(p_admin), '/admin', p_admin, true);
    end loop;
  end if;
  return jsonb_build_object('pending', true, 'approval_id', v_id);
end $$;

-- ---------------------------------------------------------------------
-- B3. Thực thi (dùng chung cho lệnh trực tiếp và lệnh đã duyệt)
-- ---------------------------------------------------------------------
create or replace function private.exec_grant_xu(p_actor uuid, p_approver uuid, p_type text, p_id uuid, p_amount numeric, p_kind text,
                                                 p_reason text, p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_name text := private.target_name(p_type, p_id);
  v_tx uuid := (select t.id from public.ledger_transactions t where t.idempotency_key = 'admin_grant:' || p_key);
  s record;
begin
  if v_tx is not null then return jsonb_build_object('transaction_id', v_tx, 'balance', private.balance(p_id), 'duplicate', true); end if;
  v_tx := private.ledger_post(case when p_amount > 0 then 'ADMIN_GRANT' else 'ADMIN_DEDUCT' end, 'admin_grant:' || p_key, p_reason, p_actor,
    jsonb_build_array(jsonb_build_object('account_id', p_id, 'coin_kind', p_kind, 'amount', p_amount),
                      jsonb_build_object('account_id', private.system_account(), 'coin_kind', p_kind, 'amount', -p_amount)),
    case when upper(p_type) = 'CLUB' then p_id end);
  update public.ledger_transactions set approved_by = coalesce(p_approver, p_actor) where id = v_tx;
  if upper(p_type) = 'CLUB' then
    insert into public.club_treasury_log (club_id, user_id, amount, kind, note)
    values (p_id, p_actor, p_amount, case when p_amount > 0 then 'CONTRIBUTE' else 'SPEND' end,
            left(case when p_amount > 0 then 'RaceHub tặng: ' else 'RaceHub điều chỉnh: ' end || p_reason, 200));
    for s in select m.user_id from public.club_members m where m.club_id = p_id and m.status = 'APPROVED' and m.role in ('OWNER', 'CAPTAIN') loop
      perform private.notify(s.user_id, p_id, 'ADMIN_XU',
        case when p_amount > 0 then 'Quỹ ' || v_name || ' được RaceHub tặng ' || p_amount || ' Xu' else 'Quỹ ' || v_name || ' được điều chỉnh ' || p_amount || ' Xu' end,
        p_reason, '/clubs/' || p_id || '/treasury', null, true);
    end loop;
  else
    perform private.notify(p_id, null, 'ADMIN_XU',
      case when p_amount > 0 then 'RaceHub tặng bạn ' || p_amount || ' Xu' else 'Ví của bạn được điều chỉnh ' || p_amount || ' Xu' end,
      p_reason, '/wallet', null, true);
  end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value, reason)
  values (p_actor, 'ADMIN_GRANT_XU', upper(p_type) || ':' || p_id,
          jsonb_build_object('amount', p_amount, 'coin_kind', p_kind, 'tx', v_tx, 'name', v_name, 'approved_by', p_approver), p_reason);
  return jsonb_build_object('transaction_id', v_tx, 'balance', private.balance(p_id));
end $$;

create or replace function private.exec_grant_pass(p_actor uuid, p_approver uuid, p_type text, p_id uuid, p_qty integer, p_slots integer,
                                                   p_expires timestamptz, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_name text := private.target_name(p_type, p_id); v_id uuid; s record;
begin
  insert into public.challenge_passes (owner_type, owner_id, max_slots, total, remaining, expires_at, note, granted_by)
  values (upper(p_type), p_id, p_slots, p_qty, p_qty, p_expires, nullif(trim(coalesce(p_note, '')), ''), p_actor)
  returning id into v_id;
  if upper(p_type) = 'CLUB' then
    for s in select m.user_id from public.club_members m where m.club_id = p_id and m.status = 'APPROVED' and m.role in ('OWNER', 'CAPTAIN') loop
      perform private.notify(s.user_id, p_id, 'ADMIN_PASS', v_name || ' nhận ' || p_qty || ' lượt tạo miễn phí',
        'Mỗi lượt dùng cho thử thách / giải tối đa ' || p_slots || ' người', '/challenges/new?club=' || p_id, null, true);
    end loop;
  else
    perform private.notify(p_id, null, 'ADMIN_PASS', 'Bạn nhận ' || p_qty || ' lượt tạo miễn phí',
      'Mỗi lượt dùng cho thử thách / giải tối đa ' || p_slots || ' người', '/challenges/new', null, true);
  end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value, reason)
  values (p_actor, 'GRANT_CHALLENGE_PASS', upper(p_type) || ':' || p_id,
          jsonb_build_object('pass_id', v_id, 'quantity', p_qty, 'max_slots', p_slots, 'expires_at', p_expires, 'name', v_name, 'approved_by', p_approver), p_note);
  return v_id;
end $$;

create or replace function private.exec_grant_plan(p_actor uuid, p_approver uuid, p_type text, p_id uuid, p_plan text, p_months integer,
                                                   p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.subscriptions;
begin
  s := private.grant_subscription(upper(p_type), p_id, upper(p_plan), p_months, 'ADMIN', null, trim(p_reason), p_actor);
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (p_actor, 'GRANT_PLAN', p_id::text, jsonb_build_object('plan', s.plan_code, 'ends_at', s.ends_at, 'reason', trim(p_reason), 'approved_by', p_approver));
  return to_jsonb(s);
end $$;

-- ---------------------------------------------------------------------
-- B4. Lệnh của admin (kiểm tra + chuyển thành yêu cầu duyệt khi vượt ngưỡng)
-- ---------------------------------------------------------------------
create or replace function public.admin_grant_xu(
  p_target_type text, p_target_id uuid, p_amount numeric, p_coin_kind text, p_reason text, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  v_amount numeric := round(coalesce(p_amount, 0), 1);
  v_kind text := coalesce(p_coin_kind, 'BONUS');
  v_reason text := trim(coalesce(p_reason, ''));
  v_type text := upper(coalesce(p_target_type, ''));
  v_today numeric;
  v_name text;
begin
  if v_amount = 0 or abs(v_amount) > 1000000 then raise exception 'INVALID_AMOUNT'; end if;
  if v_kind not in ('BONUS', 'PAID') then raise exception 'INVALID_COIN_KIND'; end if;
  if char_length(v_reason) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  v_name := private.target_name(v_type, p_target_id);
  perform private.forbid_self(v_admin, v_type, p_target_id);
  if exists (select 1 from public.ledger_transactions t where t.idempotency_key = 'admin_grant:' || p_idempotency_key) then
    return private.exec_grant_xu(v_admin, null, v_type, p_target_id, v_amount, v_kind, v_reason, p_idempotency_key);
  end if;
  v_today := coalesce((select sum(abs((l.new_value->>'amount')::numeric)) from public.admin_audit_log l
                        where l.actor_id = v_admin and l.action = 'ADMIN_GRANT_XU' and l.new_value->>'approved_by' is null
                          and l.created_at >= private.vn_start(private.vn_day(now()))), 0);
  if abs(v_amount) >= private.gov_num('gov_approval_xu', 5000) or v_today + abs(v_amount) > private.gov_num('gov_daily_xu', 20000) then
    return private.request_approval(v_admin, 'GRANT_XU',
      jsonb_build_object('target_type', v_type, 'target_id', p_target_id, 'amount', v_amount, 'coin_kind', v_kind, 'reason', v_reason, 'key', p_idempotency_key),
      case when v_amount > 0 then 'Cộng ' else 'Trừ ' end || abs(v_amount) || ' Xu ' || v_kind || ' cho ' || v_name, 'grant_xu:' || p_idempotency_key);
  end if;
  return private.exec_grant_xu(v_admin, null, v_type, p_target_id, v_amount, v_kind, v_reason, p_idempotency_key);
end $$;

create or replace function public.admin_grant_challenge_pass(
  p_target_type text, p_target_id uuid, p_quantity integer, p_max_slots integer, p_expires_at timestamptz, p_note text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_admin uuid := private.require_admin(); v_type text := upper(coalesce(p_target_type, '')); v_name text;
begin
  if coalesce(p_quantity, 0) not between 1 and 100 then raise exception 'INVALID_AMOUNT'; end if;
  if coalesce(p_max_slots, 0) not between 1 and 10000 then raise exception 'INVALID_MAX_SLOTS'; end if;
  if p_expires_at is not null and p_expires_at <= now() then raise exception 'INVALID_TIME_RANGE'; end if;
  v_name := private.target_name(v_type, p_target_id);
  perform private.forbid_self(v_admin, v_type, p_target_id);
  if p_quantity >= private.gov_num('gov_approval_pass_qty', 10) or p_max_slots > private.gov_num('gov_approval_pass_slots', 500) then
    perform private.request_approval(v_admin, 'GRANT_PASS',
      jsonb_build_object('target_type', v_type, 'target_id', p_target_id, 'quantity', p_quantity, 'max_slots', p_max_slots, 'expires_at', p_expires_at, 'note', p_note),
      'Tặng ' || p_quantity || ' lượt tạo ≤' || p_max_slots || ' người cho ' || v_name, null);
    return null;                                    -- null = đã chuyển thành yêu cầu chờ admin khác duyệt
  end if;
  return private.exec_grant_pass(v_admin, null, v_type, p_target_id, p_quantity, p_max_slots, p_expires_at, p_note);
end $$;

create or replace function public.admin_grant_plan(p_owner_type text, p_owner_id uuid, p_plan text, p_months integer, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_admin uuid := private.require_admin(); v_type text := upper(coalesce(p_owner_type, '')); v_name text;
begin
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if p_months not in (1, 3, 6, 12) then raise exception 'INVALID_MONTHS'; end if;
  v_name := private.target_name(v_type, p_owner_id);
  perform private.forbid_self(v_admin, v_type, p_owner_id);
  if p_months >= private.gov_num('gov_approval_plan_months', 3) then
    return private.request_approval(v_admin, 'GRANT_PLAN',
      jsonb_build_object('target_type', v_type, 'target_id', p_owner_id, 'plan', upper(p_plan), 'months', p_months, 'reason', trim(p_reason)),
      'Cấp gói ' || upper(p_plan) || ' ' || p_months || ' tháng cho ' || v_name, null);
  end if;
  return private.exec_grant_plan(v_admin, null, v_type, p_owner_id, p_plan, p_months, p_reason);
end $$;

-- Duyệt / từ chối — người duyệt phải là admin khác người yêu cầu và không hưởng lợi
create or replace function private.decide_approval(p_id uuid, p_decider uuid, p_approve boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a public.admin_approvals := (select x from public.admin_approvals x where x.id = p_id for update);
  p jsonb;
  v_result jsonb;
begin
  if a.id is null then raise exception 'APPROVAL_NOT_FOUND'; end if;
  if a.status <> 'PENDING' then raise exception 'APPROVAL_DONE'; end if;
  p := a.payload;
  if p_decider is not null then
    if p_decider = a.requested_by then raise exception 'SAME_ADMIN'; end if;
    perform private.forbid_self(p_decider, p->>'target_type', (p->>'target_id')::uuid);
  end if;
  if a.created_at < now() - interval '7 days' then
    update public.admin_approvals set status = 'EXPIRED', decided_at = now() where id = a.id;
    raise exception 'APPROVAL_EXPIRED';
  end if;
  if p_approve then
    v_result := case a.action
      when 'GRANT_XU' then private.exec_grant_xu(a.requested_by, coalesce(p_decider, a.requested_by), p->>'target_type', (p->>'target_id')::uuid,
                                                 (p->>'amount')::numeric, p->>'coin_kind', p->>'reason', p->>'key')
      when 'GRANT_PASS' then jsonb_build_object('pass_id', private.exec_grant_pass(a.requested_by, coalesce(p_decider, a.requested_by), p->>'target_type',
                                                 (p->>'target_id')::uuid, (p->>'quantity')::int, (p->>'max_slots')::int, nullif(p->>'expires_at', '')::timestamptz, p->>'note'))
      when 'GRANT_PLAN' then private.exec_grant_plan(a.requested_by, coalesce(p_decider, a.requested_by), p->>'target_type', (p->>'target_id')::uuid,
                                                 p->>'plan', (p->>'months')::int, p->>'reason')
    end;
  end if;
  update public.admin_approvals set status = case when p_approve then 'APPROVED' else 'REJECTED' end, decided_by = p_decider, decided_at = now(),
         note = nullif(trim(coalesce(p_note, '')), ''), result = v_result where id = a.id;
  insert into public.admin_audit_log (actor_id, action, target, new_value, reason)
  values (p_decider, case when p_approve then 'APPROVE' else 'REJECT' end, a.action, jsonb_build_object('approval_id', a.id, 'result', v_result), a.summary);
  perform private.notify(a.requested_by, null, 'ADMIN_APPROVAL', case when p_approve then 'Đã duyệt: ' else 'Bị từ chối: ' end || a.summary,
    nullif(trim(coalesce(p_note, '')), ''), '/admin', p_decider, false);
  return jsonb_build_object('status', case when p_approve then 'APPROVED' else 'REJECTED' end, 'result', v_result);
end $$;

create or replace function public.admin_decide_approval(p_id uuid, p_approve boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return private.decide_approval(p_id, private.require_admin(), p_approve, p_note);
end $$;

-- Chủ hệ thống (chỉ ai vào được SQL Editor) duyệt khi chưa có admin thứ hai: select private.approve_as_owner('<id>');
create or replace function private.approve_as_owner(p_id uuid, p_note text default 'Chủ hệ thống duyệt trong SQL Editor') returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return private.decide_approval(p_id, null, true, p_note);
end $$;

create or replace function public.admin_list_approvals(p_status text default 'PENDING') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'action', t.action, 'summary', t.summary, 'payload', t.payload, 'status', t.status,
            'requested_by', t.requested_by, 'requester', private.display_name(t.requested_by), 'decider', case when t.decided_by is not null then private.display_name(t.decided_by) end,
            'decided_at', t.decided_at, 'note', t.note, 'created_at', t.created_at, 'mine', t.requested_by = auth.uid()) order by t.rn), '[]'::jsonb)
            from (select x.*, row_number() over (order by x.created_at desc) as rn from public.admin_approvals x
                   where p_status = 'ALL' or x.status = p_status) t where t.rn <= 100);
end $$;

-- Xác nhận đơn: không xác nhận đơn của chính mình / CLB mình
create or replace function public.admin_confirm_order(p_order_id uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_admin(); o public.orders := (select x from public.orders x where x.id = p_order_id for update);
begin
  if o.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.status = 'PAID' then return private.order_json(o); end if;
  if o.status <> 'PENDING' then raise exception 'ORDER_NOT_PENDING'; end if;
  if o.buyer_id = v_uid then raise exception 'SELF_ACTION_FORBIDDEN'; end if;
  perform private.forbid_self(v_uid, o.owner_type, o.owner_id);
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

-- Bật / tắt Pro tay: không cho CLB mình là thành viên
create or replace function public.admin_set_club_plan(p_club_id uuid, p_plan text, p_until timestamptz, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  c public.clubs := (select x from public.clubs x where x.id = p_club_id);
begin
  if c.id is null then raise exception 'CLUB_NOT_FOUND'; end if;
  if upper(coalesce(p_plan, '')) not in ('FREE', 'PRO') then raise exception 'INVALID_PLAN'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  perform private.forbid_self(v_uid, 'CLUB', c.id);
  update public.clubs set plan = upper(p_plan), pro_until = case when upper(p_plan) = 'PRO' then p_until end where id = c.id;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'SET_CLUB_PLAN', c.id::text, jsonb_build_object('plan', upper(p_plan), 'until', p_until, 'reason', trim(p_reason), 'old_plan', c.plan));
  perform private.notify_club(c.id, true, 'CLUB_PRO',
    case when upper(p_plan) = 'PRO' then c.name || ' đã lên gói CLB Pro' else c.name || ' trở về gói miễn phí' end,
    case when upper(p_plan) = 'PRO' then 'Mở khóa: không giới hạn quản trị viên, link mời riêng, báo cáo chuyên cần.'
         else 'Các tính năng Pro tạm khóa. Dữ liệu vẫn được giữ nguyên.' end,
    '/clubs/' || c.id || '/settings', v_uid);
  return jsonb_build_object('plan', upper(p_plan), 'pro_until', case when upper(p_plan) = 'PRO' then p_until end);
end $$;

-- Quyền tổ chức giải: không tự cấp cho mình / CLB mình
create or replace function public.admin_set_race_organizer(p_owner_type text, p_owner_id uuid, p_allow boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_admin();
begin
  if upper(p_owner_type) not in ('USER', 'CLUB') then raise exception 'INVALID_OWNER'; end if;
  if p_allow then perform private.forbid_self(v_uid, p_owner_type, p_owner_id); end if;
  if p_allow then
    insert into public.race_organizer_grants (owner_type, owner_id, note, granted_by) values (upper(p_owner_type), p_owner_id, p_note, v_uid)
    on conflict (owner_type, owner_id) do update set note = excluded.note, granted_by = excluded.granted_by, created_at = now();
    if upper(p_owner_type) = 'CLUB' then
      perform private.notify_club(p_owner_id, true, 'CLUB_PRO', 'CLB được cấp quyền tổ chức giải chạy ảo', null, '/races/new', v_uid);
    else
      perform private.notify(p_owner_id, null, 'VIP', 'Bạn được cấp quyền tổ chức giải chạy ảo', null, '/races/new', v_uid, true);
    end if;
  else
    delete from public.race_organizer_grants where owner_type = upper(p_owner_type) and owner_id = p_owner_id;
  end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'RACE_ORGANIZER', p_owner_id::text, jsonb_build_object('type', upper(p_owner_type), 'allow', p_allow, 'note', p_note));
end $$;

-- ---------------------------------------------------------------------
-- B5. Nhật ký quản trị và sổ cái: chỉ được thêm, không sửa / xóa
-- ---------------------------------------------------------------------
create or replace function private.append_only() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'ledger_transactions' and tg_op = 'UPDATE'
     and to_jsonb(old)->>'approved_by' is null and (to_jsonb(new) - 'approved_by') = (to_jsonb(old) - 'approved_by') then
    return new;                                   -- ghi người duyệt ngay sau khi tạo giao dịch
  end if;
  raise exception 'APPEND_ONLY: % không được sửa hoặc xóa', tg_table_name;
end $$;
drop trigger if exists trg_append_only on public.admin_audit_log;
create trigger trg_append_only before update or delete on public.admin_audit_log for each row execute function private.append_only();
drop trigger if exists trg_append_only on public.ledger_entries;
create trigger trg_append_only before update or delete on public.ledger_entries for each row execute function private.append_only();
drop trigger if exists trg_append_only on public.ledger_transactions;
create trigger trg_append_only before update or delete on public.ledger_transactions for each row execute function private.append_only();

-- ---------------------------------------------------------------------
-- C1. Thưởng từ quỹ CLB: tối đa 50% số dư quỹ mỗi lần treo (chặn trước khi trừ quỹ)
-- ---------------------------------------------------------------------
create or replace function private.challenge_reward_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.reward_source = 'CREATOR' and coalesce(new.reward_xu, 0) > 0 then raise exception 'REWARD_NOT_ALLOWED'; end if;
  if new.reward_source = 'CLUB' and coalesce(new.reward_xu, 0) > 0 and new.target_club_id is not null
     and new.reward_xu > private.balance(new.target_club_id) * 0.5 then
    raise exception 'REWARD_TOO_LARGE';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- C2. Chốt thử thách: không cộng XP (XP chỉ từ km); thưởng quỹ CLB cần ≥ 3 người có kết quả, không thì hoàn quỹ
-- ---------------------------------------------------------------------
create or replace function private.settle_challenge(p_challenge_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id for update);
  v_pool numeric;
  v_users uuid[] := '{}';
  v_weights numeric[] := '{}';
  v_sumw numeric;
  v_amount numeric;
  v_paid numeric := 0;
  v_winners uuid[] := '{}';
  v_top numeric;
  v_names text;
  v_active integer;
  i integer;
  r record;
begin
  if c.id is null or c.status <> 'ACTIVE' or now() < c.end_date then return false; end if;

  update public.challenge_participants p set final_rank = x.rk
    from (select id, (rank() over (order by current_progress desc, completed_at asc nulls last))::int as rk
            from public.challenge_participants where challenge_id = c.id and status <> 'LEFT') x
   where p.id = x.id;

  if c.format = 'TEAM' then
    v_top := (select max(t.score) from private.challenge_team_scores(c.id) t);
    if coalesce(v_top, 0) > 0 then
      v_users := (select array_agg(p.profile_id) from public.challenge_participants p
                   where p.challenge_id = c.id and p.status <> 'LEFT'
                     and p.team_id in (select t.team_id from private.challenge_team_scores(c.id) t where t.score = v_top));
      v_weights := array_fill(1::numeric, array[coalesce(cardinality(v_users), 0)]);
      v_winners := v_users;
    end if;
  elsif c.format = 'SOLO_GOAL' then
    v_users := (select array_agg(profile_id) from public.challenge_participants where challenge_id = c.id and status <> 'LEFT' and completed_at is not null);
    v_weights := array_fill(1::numeric, array[coalesce(cardinality(v_users), 0)]);
  elsif c.format = 'COLLECTIVE' then
    if (select coalesce(sum(current_progress), 0) from public.challenge_participants where challenge_id = c.id and status <> 'LEFT') >= c.target_value then
      v_users := (select array_agg(profile_id) from public.challenge_participants where challenge_id = c.id and status <> 'LEFT' and current_progress > 0);
      v_weights := array_fill(1::numeric, array[coalesce(cardinality(v_users), 0)]);
    end if;
  elsif c.reward_split = 'TOP3' then
    v_users := (select array_agg(profile_id order by final_rank) from public.challenge_participants
                 where challenge_id = c.id and status <> 'LEFT' and final_rank <= 3 and current_progress > 0);
    v_weights := (select array_agg(case final_rank when 1 then 50 when 2 then 30 else 20 end::numeric order by final_rank) from public.challenge_participants
                   where challenge_id = c.id and status <> 'LEFT' and final_rank <= 3 and current_progress > 0);
    v_winners := (select array_agg(profile_id) from public.challenge_participants
                   where challenge_id = c.id and status <> 'LEFT' and final_rank = 1 and current_progress > 0);
  else
    v_users := (select array_agg(profile_id) from public.challenge_participants
                 where challenge_id = c.id and status <> 'LEFT' and final_rank = 1 and current_progress > 0);
    v_weights := array_fill(1::numeric, array[coalesce(cardinality(v_users), 0)]);
    v_winners := v_users;
  end if;
  v_users := coalesce(v_users, '{}'); v_weights := coalesce(v_weights, '{}'); v_winners := coalesce(v_winners, '{}');

  v_pool := case when c.reward_source <> 'NONE' then coalesce(c.reward_xu, 0) else 0 end;
  v_active := (select count(*) from public.challenge_participants where challenge_id = c.id and status <> 'LEFT' and current_progress > 0);
  if v_pool > 0 then
    if cardinality(v_users) = 0 or (c.reward_source = 'CLUB' and v_active < 3) then
      perform private.challenge_refund_escrow(c);
    else
      v_sumw := (select sum(w) from unnest(v_weights) w);
      for i in reverse cardinality(v_users) .. 1 loop
        v_amount := case when i = 1 then v_pool - v_paid else floor(v_pool * v_weights[i] / v_sumw * 10) / 10 end;
        if v_amount <= 0 then continue; end if;
        perform private.ledger_post('CHALLENGE_PRIZE', 'challenge_prize:' || c.id || ':' || v_users[i], 'Thưởng thử thách: ' || c.title, v_users[i],
          jsonb_build_array(jsonb_build_object('account_id', v_users[i], 'coin_kind', 'BONUS', 'amount', v_amount),
                            jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -v_amount)), c.id);
        update public.challenge_participants set reward_xu = reward_xu + v_amount where challenge_id = c.id and profile_id = v_users[i];
        v_paid := v_paid + v_amount;
      end loop;
    end if;
  end if;

  update public.challenges set status = 'FINISHED', settled_at = now() where id = c.id;

  for r in select profile_id, final_rank, reward_xu, completed_at from public.challenge_participants where challenge_id = c.id and status <> 'LEFT' loop
    perform private.notify(r.profile_id, c.target_club_id, 'CHALLENGE_RESULT', 'Kết quả: ' || c.title,
      case when r.profile_id = any(v_winners) then 'Chúc mừng! Bạn về nhất'
           when r.completed_at is not null then 'Bạn đã hoàn thành mục tiêu'
           else 'Bạn xếp hạng ' || r.final_rank end
      || case when r.reward_xu > 0 then ' · +' || r.reward_xu || ' Xu' else '' end,
      '/challenges/' || c.id, null, true);
  end loop;

  if c.target_club_id is not null then
    v_names := (select string_agg(private.display_name(u), ', ') from unnest(v_winners[1:5]) u);
    insert into public.club_posts (club_id, author_id, kind, title, body, meta)
    values (c.target_club_id, null, 'CHALLENGE', 'Kết quả: ' || c.title,
            case when v_names is not null then 'Chúc mừng ' || v_names || '!' else 'Thử thách đã kết thúc.' end
            || case when v_pool > 0 and v_paid = 0 then ' Thưởng đã hoàn lại quỹ CLB (cần ít nhất 3 người có kết quả).' else '' end,
            jsonb_build_object('challenge_id', c.id, 'result', true, 'format', c.format, 'reward_xu', v_paid));
  end if;
  return true;
end $$;

-- ---------------------------------------------------------------------
-- Quyền
-- ---------------------------------------------------------------------
revoke all on function private.gov_num(text, numeric), private.forbid_self(uuid, text, uuid), private.target_name(text, uuid),
  private.request_approval(uuid, text, jsonb, text, text), private.exec_grant_xu(uuid, uuid, text, uuid, numeric, text, text, text),
  private.exec_grant_pass(uuid, uuid, text, uuid, integer, integer, timestamptz, text), private.exec_grant_plan(uuid, uuid, text, uuid, text, integer, text),
  private.decide_approval(uuid, uuid, boolean, text), private.approve_as_owner(uuid, text), private.append_only() from public, anon, authenticated;
revoke all on function public.admin_decide_approval(uuid, boolean, text), public.admin_list_approvals(text) from public, anon;
grant execute on function public.admin_decide_approval(uuid, boolean, text), public.admin_list_approvals(text) to authenticated;
revoke execute on function public.admin_grant_xu(text, uuid, numeric, text, text, text), public.admin_grant_challenge_pass(text, uuid, integer, integer, timestamptz, text),
  public.admin_grant_plan(text, uuid, text, integer, text), public.admin_confirm_order(uuid, text), public.admin_set_race_organizer(text, uuid, boolean, text) from anon;

notify pgrst, 'reload schema';
