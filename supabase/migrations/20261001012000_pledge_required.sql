-- 012000: Thử thách theo mục tiêu (pledge): tham gia BẮT BUỘC kèm mục tiêu.
--   join_challenge_pledge(id, km, code): vào thử thách + đặt mục tiêu trong CÙNG một giao dịch — mục tiêu không hợp lệ / đã khóa
--   thì không vào (không còn người "tham gia nhưng chưa đăng ký mục tiêu").
--   Người đã vào từ trước mà chưa có mục tiêu: app nhắc đăng ký (set_my_pledge vẫn dùng như cũ).
-- Chạy được trong SQL Editor, chạy lại an toàn.

create or replace function public.join_challenge_pledge(p_challenge_id uuid, p_km numeric, p_code text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_join jsonb;
begin
  perform private.require_uid();
  if not exists (select 1 from public.challenges where id = p_challenge_id) then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if not exists (select 1 from public.challenges where id = p_challenge_id and pledge_enabled) then raise exception 'PLEDGE_NOT_SUPPORTED'; end if;
  if p_km is null or p_km <= 0 then raise exception 'PLEDGE_REQUIRED'; end if;
  v_join := public.join_challenge(p_challenge_id, p_code, null);
  perform public.set_my_pledge(p_challenge_id, p_km);
  return coalesce(v_join, '{}'::jsonb) || jsonb_build_object('pledge_km', round(p_km, 1));
end $$;

revoke all on function public.join_challenge_pledge(uuid, numeric, text) from public, anon;
grant execute on function public.join_challenge_pledge(uuid, numeric, text) to authenticated;
