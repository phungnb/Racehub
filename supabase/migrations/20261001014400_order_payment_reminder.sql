-- Admin nhắc người mua hoàn tất thanh toán đơn đang chờ: gửi thông báo trong app (không tự động hàng loạt).
alter table public.orders add column if not exists reminded_at timestamptz;

create or replace function public.admin_remind_order(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  o public.orders := (select x from public.orders x where x.id = p_order_id for update);
  v_plan text; v_what text; v_body text;
begin
  if o.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.status <> 'PENDING' or o.expires_at <= now() then raise exception 'ORDER_NOT_PENDING'; end if;
  if o.reminded_at is not null and o.reminded_at > now() - interval '6 hours' then raise exception 'ORDER_REMIND_TOO_SOON'; end if;
  if o.kind = 'PLAN' then
    v_plan := coalesce((select name from public.plans where code = o.plan_code), 'gói');
    v_what := 'kích hoạt ' || v_plan || coalesce(' ' || o.months || ' tháng', '');
  else
    v_what := 'nhận ' || (o.xu + o.bonus_xu) || ' Xu';
  end if;
  v_body := 'Hãy liên hệ với RaceHub và hoàn thành thủ tục thanh toán để ' || v_what
         || '. Chuyển khoản đúng nội dung ' || o.code || ' hoặc nhắn admin qua mục Liên hệ trong trang Gói.';
  perform private.notify(o.buyer_id, null, 'ORDER_REMINDER', 'Đơn ' || o.code || ' đang chờ thanh toán', v_body, '/goi', v_uid, true);
  update public.orders set reminded_at = now() where id = o.id;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'REMIND_ORDER', o.code, jsonb_build_object('kind', o.kind, 'amount_vnd', o.amount_vnd));
  return private.order_json((select x from public.orders x where x.id = o.id));
end $$;

revoke all on function public.admin_remind_order(uuid) from public, anon;
grant execute on function public.admin_remind_order(uuid) to authenticated;
notify pgrst, 'reload schema';
