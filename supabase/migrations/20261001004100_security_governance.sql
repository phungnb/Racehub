-- 004100: Rà soát bảo mật + lưu vết không xóa được + sửa lệch kinh tế. Admin (SYSTEM_ADMIN) toàn quyền, không cần người thứ hai duyệt.
-- A. Bảo mật: khóa ghi trực tiếp vào các bảng cũ không còn dùng; bỏ quyền gọi hàm quản trị / CLB của khách chưa đăng nhập;
--    cố định search_path cho 3 hàm SECURITY DEFINER cũ; hàm cấp lượt hằng tháng chỉ cho máy chủ (service_role).
-- B. Lưu vết: nhật ký quản trị và sổ cái không sửa / xóa được (admin vẫn toàn quyền thao tác; chỉ là không xóa được dấu vết).
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
-- B. Nhật ký quản trị và sổ cái: chỉ được thêm, không sửa / xóa (lưu vết, không giới hạn quyền admin)
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
revoke all on function private.append_only() from public, anon, authenticated;

notify pgrst, 'reload schema';
