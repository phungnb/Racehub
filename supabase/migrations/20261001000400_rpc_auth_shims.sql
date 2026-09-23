-- =====================================================================
-- 20261001000400 — Bỏ tham số p_user_id khỏi các RPC cũ
--
-- Vấn đề: một số RPC hiện có nhận p_user_id từ client → client có thể mạo danh.
-- Cách xử lý (không cần biết thân hàm cũ):
--   1. Chuyển hàm cũ sang schema `legacy` (PostgREST KHÔNG expose schema này,
--      nên client không gọi trực tiếp được nữa).
--   2. Tạo hàm mới cùng tên trong `public`, bỏ p_user_id, tự truyền auth.uid().
--      Hàm mới giữ nguyên chế độ SECURITY DEFINER/INVOKER của hàm cũ.
-- Sau khi `supabase db pull`, các hàm này sẽ được viết lại hoàn chỉnh.
--
-- has_permission được xử lý riêng (thêm overload) vì có thể đang được RLS / hàm
-- khác gọi theo tên với 3 tham số.
-- =====================================================================

create schema if not exists legacy;
revoke all on schema legacy from public;
grant usage on schema legacy to authenticated, service_role;

do $$
declare
  fn record;
  v_args_def text;
  v_uid_type text;
  v_call_args text;
  v_result text;
  v_body text;
  v_names text[] := array['equip_item', 'submit_and_process_activity', 'create_challenge_with_ledger'];
  v_found text[] := '{}';
begin
  for fn in
    select p.oid, p.proname, p.prosecdef, p.proretset, p.proargnames, p.proargmodes, p.proargtypes
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any(v_names) and 'p_user_id' = any(p.proargnames)
  loop
    v_found := v_found || fn.proname::text;
    v_args_def := pg_get_function_arguments(fn.oid);
    v_result   := pg_get_function_result(fn.oid);

    -- Kiểu của p_user_id (thường là uuid, có thể là text)
    select format_type(fn.proargtypes[i - 1], null) into v_uid_type
      from generate_subscripts(fn.proargnames, 1) i
     where fn.proargnames[i] = 'p_user_id';

    -- Bỏ "p_user_id <type> [DEFAULT ...]" khỏi danh sách tham số
    v_args_def := regexp_replace(v_args_def, '(^|,\s*)p_user_id\s+[^,]+?(\s+DEFAULT\s+[^,]+)?(?=,|$)', '', 'i');
    v_args_def := regexp_replace(v_args_def, '^\s*,\s*', '');

    -- Gọi hàm cũ bằng named notation: p_user_id => auth.uid(), a => a, ...
    select string_agg(format('%1$I => %1$I', name), ', ')
      into v_call_args
      from unnest(fn.proargnames) with ordinality as a(name, ord)
     where name <> 'p_user_id'
       and (fn.proargmodes is null or fn.proargmodes[ord] in ('i', 'b', 'v'));
    v_call_args := format('p_user_id => private.require_uid()::%s', v_uid_type)
                   || coalesce(', ' || v_call_args, '');

    execute format('alter function public.%I(%s) set schema legacy',
                   fn.proname, oidvectortypes(fn.proargtypes));

    v_body := case
      when fn.proretset or v_result ilike 'TABLE(%' then format('select * from legacy.%I(%s)', fn.proname, v_call_args)
      else format('select legacy.%I(%s)', fn.proname, v_call_args)
    end;

    execute format(
      'create or replace function public.%I(%s) returns %s language sql %s set search_path = public, extensions as %L',
      fn.proname, v_args_def, v_result,
      case when fn.prosecdef then 'security definer' else 'security invoker' end,
      v_body);

    execute format('revoke execute on function public.%I(%s) from public, anon', fn.proname, v_args_def);
    execute format('grant execute on function public.%I(%s) to authenticated', fn.proname, v_args_def);
    -- Hàm cũ: chỉ gọi được qua hàm bọc
    execute format('revoke execute on function legacy.%I(%s) from public, anon',
                   fn.proname, oidvectortypes(fn.proargtypes));
    raise notice 'Đã bọc RPC %(%)', fn.proname, v_args_def;
  end loop;

  if cardinality(v_found) < cardinality(v_names) then
    raise notice 'Không tìm thấy (hoặc đã bọc trước đó): %',
      (select array_agg(x) from unnest(v_names) x where x <> all(v_found));
  end if;
end $$;

-- has_permission(p_club_id, p_permission_code): overload dùng auth.uid()
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'has_permission' and p.pronargs = 3) then
    execute $f$
      create or replace function public.has_permission(p_club_id uuid, p_permission_code text)
      returns boolean language sql stable security invoker set search_path = public, extensions as
      'select public.has_permission(p_user_id => auth.uid(), p_club_id => p_club_id, p_permission_code => p_permission_code)'
    $f$;
    revoke execute on function public.has_permission(uuid, text) from public, anon;
    grant execute on function public.has_permission(uuid, text) to authenticated;
  end if;
end $$;

notify pgrst, 'reload schema';
