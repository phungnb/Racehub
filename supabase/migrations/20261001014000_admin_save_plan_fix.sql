-- 014000: Sửa lỗi lưu gói ở trang admin (mã UNK-FSZ, "column reference "e" is ambiguous").
-- admin_save_plan (003800) khai báo biến e jsonb rồi lại đặt bí danh e cho jsonb_array_elements ở phần lượt tạo,
-- nên mọi lần lưu có gửi lượt tạo (credits) đều lỗi. Đổi bí danh; trùng quy mô thì lấy dòng sau cùng thay vì lỗi khóa chính.
-- Chạy riêng được ngay; chạy lại 3500.

create or replace function public.admin_save_plan(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_admin(); v_code text := upper(trim(coalesce(p->>'code', ''))); e jsonb;
begin
  if not exists (select 1 from public.plans x where x.code = v_code) then raise exception 'INVALID_PLAN'; end if;
  update public.plans set name = coalesce(nullif(trim(p->>'name'), ''), name), description = coalesce(p->>'description', description),
         perks = coalesce(p->'perks', perks), active = coalesce((p->>'active')::boolean, active) where code = v_code;
  if p ? 'prices' then
    for e in select value from jsonb_array_elements(p->'prices') loop
      insert into public.plan_prices (plan_code, months, price_vnd, active)
      values (v_code, (e->>'months')::int, (e->>'price_vnd')::int, coalesce((e->>'active')::boolean, true))
      on conflict (plan_code, months) do update set price_vnd = excluded.price_vnd, active = excluded.active;
    end loop;
  end if;
  if p ? 'credits' then
    delete from public.plan_credits where plan_code = v_code;
    for e in select value from jsonb_array_elements(p->'credits') loop
      if coalesce((e->>'per_month')::int, 0) > 0 then
        insert into public.plan_credits (plan_code, capacity, per_month)
        values (v_code, (e->>'capacity')::int, (e->>'per_month')::int)
        on conflict (plan_code, capacity) do update set per_month = excluded.per_month;
      end if;
    end loop;
  end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SAVE_PLAN', v_code, p);
end $$;
