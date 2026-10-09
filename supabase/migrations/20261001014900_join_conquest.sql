-- 014900: Thử thách chinh phục: tham gia BẮT BUỘC có hạng mục (như thử thách theo mục tiêu, 012000).
--   join_challenge_conquest(id, items, code): vào thử thách + đăng ký hạng mục trong CÙNG một giao dịch.
--   - Nhiều hạng mục: phải chọn ít nhất 1, không chọn thì không vào (CONQUEST_REQUIRED).
--   - Chỉ 1 hạng mục và không cần đặt mục tiêu riêng (FIXED / ANY): tự đăng ký hạng mục đó, items để trống.
--   - Chế độ SELF: luôn phải nhập mục tiêu của mình, kể cả khi chỉ có 1 hạng mục.
--   Dọn dữ liệu cũ: người đã tham gia nhưng chưa có hạng mục, ở thử thách chỉ có 1 hạng mục (FIXED / ANY) → tự đăng ký.
-- Chạy được trong SQL Editor, chạy lại an toàn.

create or replace function public.join_challenge_conquest(p_challenge_id uuid, p_items jsonb default null, p_code text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.challenges;
  v_items jsonb := case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end;
  v_cats uuid[];
  v_join jsonb;
begin
  perform private.require_uid();
  c := (select x from public.challenges x where x.id = p_challenge_id);
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if c.objective not in ('BEST_TIME', 'BEST_PACE') then raise exception 'CONQUEST_NOT_SUPPORTED'; end if;
  if jsonb_array_length(v_items) = 0 then
    v_cats := array(select id from public.challenge_categories where challenge_id = c.id);
    if coalesce(array_length(v_cats, 1), 0) = 1 and c.conquest_mode in ('FIXED', 'ANY') then
      v_items := jsonb_build_array(jsonb_build_object('category_id', v_cats[1]));
    else
      raise exception 'CONQUEST_REQUIRED';
    end if;
  end if;
  v_join := public.join_challenge(p_challenge_id, p_code, null);
  perform public.set_my_conquest(p_challenge_id, v_items);   -- sai hạng mục / mục tiêu → cả giao dịch hoàn tác, không vào
  return coalesce(v_join, '{}'::jsonb) || jsonb_build_object('categories', jsonb_array_length(v_items));
end $$;

revoke all on function public.join_challenge_conquest(uuid, jsonb, text) from public, anon;
grant execute on function public.join_challenge_conquest(uuid, jsonb, text) to authenticated;

-- Dọn dữ liệu cũ: thử thách chỉ có 1 hạng mục, không cần mục tiêu riêng → người đã tham gia mà chưa chọn được gán hạng mục đó
do $$
declare
  r record;
begin
  for r in
    select p.id as pid, p.profile_id, p.challenge_id, cat.id as cat_id
      from public.challenges c
      join public.challenge_categories cat on cat.challenge_id = c.id
      join public.challenge_participants p on p.challenge_id = c.id and p.status <> 'LEFT'
     where c.objective in ('BEST_TIME', 'BEST_PACE') and c.conquest_mode in ('FIXED', 'ANY')
       and (select count(*) from public.challenge_categories x where x.challenge_id = c.id) = 1
       and not exists (select 1 from public.challenge_category_entries e where e.participant_id = p.id)
  loop
    insert into public.challenge_category_entries (participant_id, category_id, challenge_id, user_id)
    values (r.pid, r.cat_id, r.challenge_id, r.profile_id) on conflict do nothing;
    perform private.challenge_recompute_participant(r.pid);
  end loop;
end $$;

notify pgrst, 'reload schema';
