-- 017400: Ly cà phê ủng hộ admin.
-- Admin đặt lời nhắn + ảnh QR ngân hàng + thông tin tài khoản (Quản trị → Hệ thống → Ly cà phê). Người dùng bấm biểu tượng ly cà phê
-- trên thanh trên cùng thì thấy đúng ba thứ đó. Chỉ một dòng cấu hình (id = 1). Ảnh QR nằm trong kho 'support-media' (công khai, chỉ admin tải lên).
-- Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

create table if not exists private.support_coffee (
  id integer primary key default 1 check (id = 1),
  enabled boolean not null default true,
  message text,
  qr_url text,
  bank_name text,
  account_number text,
  account_name text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
revoke all on private.support_coffee from public, anon, authenticated;

-- Kho ảnh QR: ai cũng xem được (ảnh công khai), chỉ admin hệ thống tải lên / thay / xoá
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-media', 'support-media', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
drop policy if exists support_media_insert on storage.objects;
create policy support_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'support-media' and public.is_system_admin());
drop policy if exists support_media_update on storage.objects;
create policy support_media_update on storage.objects for update to authenticated
  using (bucket_id = 'support-media' and public.is_system_admin());
drop policy if exists support_media_delete on storage.objects;
create policy support_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'support-media' and public.is_system_admin());

-- Người dùng đã đăng nhập đọc; trả null khi chưa cấu hình hoặc admin tắt
create or replace function public.support_coffee() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('message', c.message, 'qr_url', c.qr_url, 'bank_name', c.bank_name,
                            'account_number', c.account_number, 'account_name', c.account_name, 'updated_at', c.updated_at)
  from private.support_coffee c
  where c.id = 1 and c.enabled
    and (coalesce(c.qr_url, '') <> '' or coalesce(c.account_number, '') <> '' or coalesce(c.message, '') <> '')
$$;

-- Admin đọc cả khi đang tắt (để sửa)
create or replace function public.admin_get_support_coffee() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform private.require_admin();
  v := (select jsonb_build_object('enabled', c.enabled, 'message', c.message, 'qr_url', c.qr_url, 'bank_name', c.bank_name,
                                  'account_number', c.account_number, 'account_name', c.account_name, 'updated_at', c.updated_at)
        from private.support_coffee c where c.id = 1);
  return v;
end $$;

create or replace function public.admin_set_support_coffee(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  v_msg text := nullif(trim(coalesce(p->>'message', '')), '');
  v_qr text := nullif(trim(coalesce(p->>'qr_url', '')), '');
  v_bank text := nullif(trim(coalesce(p->>'bank_name', '')), '');
  v_no text := nullif(trim(coalesce(p->>'account_number', '')), '');
  v_name text := nullif(trim(coalesce(p->>'account_name', '')), '');
  v_on boolean := coalesce((p->>'enabled')::boolean, true);
begin
  if char_length(coalesce(v_msg, '')) > 300 then raise exception 'INVALID_MESSAGE'; end if;
  if char_length(coalesce(v_bank, '')) > 80 or char_length(coalesce(v_name, '')) > 80 then raise exception 'INVALID_BANK'; end if;
  if char_length(coalesce(v_no, '')) > 40 then raise exception 'INVALID_BANK'; end if;
  -- Chỉ nhận ảnh trong kho support-media của chính dự án
  if v_qr is not null and v_qr !~ '/storage/v1/object/public/support-media/[A-Za-z0-9._-]{1,120}$' then raise exception 'INVALID_QR'; end if;
  insert into private.support_coffee (id, enabled, message, qr_url, bank_name, account_number, account_name, updated_by, updated_at)
  values (1, v_on, v_msg, v_qr, v_bank, v_no, v_name, v_uid, now())
  on conflict (id) do update set enabled = excluded.enabled, message = excluded.message, qr_url = excluded.qr_url,
    bank_name = excluded.bank_name, account_number = excluded.account_number, account_name = excluded.account_name,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'SUPPORT_COFFEE', 'support_coffee', jsonb_build_object('enabled', v_on, 'has_qr', v_qr is not null, 'has_account', v_no is not null));
  return public.admin_get_support_coffee();
end $$;

revoke all on function public.support_coffee(), public.admin_get_support_coffee(), public.admin_set_support_coffee(jsonb) from public, anon;
grant execute on function public.support_coffee(), public.admin_get_support_coffee(), public.admin_set_support_coffee(jsonb) to authenticated;
