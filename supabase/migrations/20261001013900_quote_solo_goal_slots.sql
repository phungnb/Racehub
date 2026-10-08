-- Báo giá thử thách Chinh phục cá nhân nhiều người (vd chinh phục cự ly mừng sự kiện): tính theo số chỗ thật.
--   Trước: quote_challenge luôn coi SOLO_GOAL là 1 chỗ nên báo "miễn phí / đủ hạn mức gói CLB", nhưng khi tạo
--   (create_challenge_v2) phí và hạn mức gói CLB (Free ≤ 50 người, Pro ≤ 1.000) tính theo số chỗ thật → báo giá sai,
--   bấm tạo mới bị từ chối INSUFFICIENT_TREASURY. "Cá nhân tôi" vẫn tính 1 chỗ vì app gửi p_max_slots = 1.
create or replace function public.quote_challenge(p_max_slots integer, p_format text default 'RANKED', p_club_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_slots integer := case when p_format = 'DUEL' then 2 else greatest(coalesce(p_max_slots, 1), 1) end;
  v_fee integer := private.challenge_creation_fee(p_format = 'TEAM', v_slots, now(), now() + interval '1 day');
  v_payer uuid := case when p_club_id is not null and public.club_is_staff(p_club_id) then p_club_id else v_uid end;
  v_quota jsonb := case when v_payer <> v_uid then private.club_challenge_quota_json(v_payer, v_slots) end;
  v_list_fee integer := v_fee;
  v_pass public.challenge_passes;
begin
  if v_fee > 0 and coalesce((v_quota->>'eligible')::boolean, false) then v_fee := 0; end if;
  perform private.issue_credits(case when v_payer = v_uid then 'USER' else 'CLUB' end, v_payer);
  v_pass := (select t.x from (select x, row_number() over (order by x.expires_at nulls last, x.max_slots, x.created_at) as rn
                                from public.challenge_passes x
                               where x.owner_id = v_payer and x.remaining > 0 and x.max_slots >= v_slots
                                 and (x.expires_at is null or x.expires_at > now())) t where t.rn = 1);
  return jsonb_build_object(
    'fee', v_fee, 'list_fee', v_list_fee, 'tier', private.capacity_tier(v_slots), 'custom', private.capacity_tier(v_slots)->>'xu' is null,
    'payer', case when v_payer = v_uid then 'USER' else 'CLUB' end,
    'payer_balance', private.balance(v_payer), 'wallet_balance', private.balance(v_uid),
    'pass', case when v_pass.id is null or v_fee = 0 then null
                 else jsonb_build_object('id', v_pass.id, 'remaining', v_pass.remaining, 'max_slots', v_pass.max_slots,
                                         'expires_at', v_pass.expires_at, 'note', v_pass.note) end,
    'plan', private.plan_badge(v_payer, v_payer <> v_uid),
    'club_quota', v_quota,
    'best_pass_slots', coalesce((select max(x.max_slots) from public.challenge_passes x
                                  where x.owner_id = v_payer and x.remaining > 0 and (x.expires_at is null or x.expires_at > now())), 0),
    'xu_vnd', (private.economy_config()->>'xuVnd')::numeric,
    'policy', private.economy_config());
end $$;
