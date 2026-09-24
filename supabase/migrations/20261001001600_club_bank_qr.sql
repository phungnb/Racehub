-- =====================================================================
-- 001600 — Ảnh mã QR nhận tiền do ban quản trị CLB tự tải lên
-- (QR của app ngân hàng / ví MoMo / ZaloPay). Có ảnh thì thành viên thấy ảnh này;
-- không có thì app tự tạo mã VietQR từ số tài khoản như cũ.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT.
-- =====================================================================

alter table public.clubs add column if not exists bank_qr_url text;

create or replace function public.set_club_bank_qr(p_club_id uuid, p_url text) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_staff(p_club_id);
begin
  -- Chỉ nhận ảnh nằm trong thư mục của chính CLB trên bucket club-media
  if p_url is not null and (char_length(p_url) > 500
      or position('/storage/v1/object/public/club-media/' || p_club_id::text || '/' in p_url) = 0
      or p_url !~ '^https://') then
    raise exception 'INVALID_QR';
  end if;
  update public.clubs set bank_qr_url = p_url where id = p_club_id;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'CLUB_SET_BANK_QR', 'club:' || p_club_id, jsonb_build_object('url', p_url));
end $$;

create or replace function public.club_finance(p_club_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_member(p_club_id);
begin
  return (select jsonb_build_object(
    'can_manage', public.club_is_staff(p_club_id),
    'bank', case when c.bank_bin is null then null
                 else jsonb_build_object('bin', c.bank_bin, 'account_no', c.bank_account_no, 'account_name', c.bank_account_name) end,
    'bank_qr_url', c.bank_qr_url,
    'balance', (select coalesce(sum(case when e.kind = 'EXPENSE' then -e.amount_vnd else e.amount_vnd end), 0)
                  from public.club_cash_entries e where e.club_id = p_club_id and e.voided_at is null),
    'income_30d', (select coalesce(sum(e.amount_vnd), 0) from public.club_cash_entries e
                    where e.club_id = p_club_id and e.voided_at is null and e.kind <> 'EXPENSE' and e.created_at > now() - interval '30 days'),
    'expense_30d', (select coalesce(sum(e.amount_vnd), 0) from public.club_cash_entries e
                     where e.club_id = p_club_id and e.voided_at is null and e.kind = 'EXPENSE' and e.created_at > now() - interval '30 days'),
    'dues', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id, 'title', d.title, 'amount_vnd', d.amount_vnd, 'due_date', d.due_date, 'note', d.note,
        'closed', d.closed_at is not null, 'created_at', d.created_at, 'reminded_at', d.reminded_at,
        'total', (select count(*) from public.club_due_payments p where p.due_id = d.id and p.status <> 'EXEMPT'),
        'confirmed', (select count(*) from public.club_due_payments p where p.due_id = d.id and p.status = 'CONFIRMED'),
        'claimed', (select count(*) from public.club_due_payments p where p.due_id = d.id and p.status = 'CLAIMED'),
        'my_status', (select p.status from public.club_due_payments p where p.due_id = d.id and p.user_id = v_uid))
        order by (d.closed_at is not null), d.created_at desc), '[]'::jsonb)
      from public.club_dues d where d.club_id = p_club_id),
    'entries', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', q.id, 'kind', q.kind, 'amount_vnd', q.amount_vnd, 'title', q.title, 'note', q.note, 'receipt_url', q.receipt_url,
        'user_name', (select display_name from public.profiles where id = q.user_id),
        'created_by_name', (select display_name from public.profiles where id = q.created_by),
        'created_at', q.created_at, 'voided_at', q.voided_at, 'void_reason', q.void_reason)
        order by q.created_at desc), '[]'::jsonb)
      from (select e.*, row_number() over (order by e.created_at desc) as rn
              from public.club_cash_entries e where e.club_id = p_club_id) q
     where q.rn <= 200))
    from public.clubs c where c.id = p_club_id);
end $$;

revoke all on function public.set_club_bank_qr(uuid, text) from public, anon;
grant execute on function public.set_club_bank_qr(uuid, text) to authenticated;
