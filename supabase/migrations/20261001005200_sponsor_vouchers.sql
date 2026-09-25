-- 005200: Voucher tài trợ trên thử thách / nhiệm vụ (bước đầu của Market — RaceHub KHÔNG giữ tiền).
-- • Nhà tài trợ (shop, HLV, dịch vụ) đưa voucher; runner hoàn thành thử thách / đạt Top N / hoàn thành nhiệm vụ → nhận mã.
-- • Hai kiểu mã: POOL (danh sách mã riêng, mỗi người một mã, hết kho thì dừng) · SHARED (một mã chung cho mọi người đạt điều kiện).
-- • Ai tạo: admin (mọi thử thách / nhiệm vụ) hoặc Ban tổ chức thử thách đó (chỉ cho thử thách của mình).
-- • Voucher KHÔNG phải XP, không phải Xu. Người nhận xem ở Tôi → Voucher, tự đánh dấu đã dùng.
-- • Mã chỉ người nhận xem được; BTC / admin xem số lượng phát, còn lại.
-- Cần 004600. Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

create table if not exists public.voucher_campaigns (
  id uuid primary key default gen_random_uuid(),
  sponsor_name text not null check (char_length(sponsor_name) between 2 and 60),
  sponsor_logo text check (sponsor_logo is null or (sponsor_logo ~ '^https://' and char_length(sponsor_logo) <= 500)),
  title text not null check (char_length(title) between 3 and 80),
  terms text check (terms is null or char_length(terms) <= 500),
  redeem_url text check (redeem_url is null or (redeem_url ~ '^https://' and char_length(redeem_url) <= 500)),
  target_type text not null check (target_type in ('CHALLENGE', 'QUEST')),
  target_id uuid not null,
  condition text not null default 'COMPLETE' check (condition in ('COMPLETE', 'TOP_N')),
  top_n integer check (top_n is null or top_n between 1 and 100),
  code_mode text not null default 'POOL' check (code_mode in ('POOL', 'SHARED')),
  shared_code text check (shared_code is null or char_length(shared_code) between 3 and 40),
  valid_until timestamptz,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists voucher_campaigns_target_idx on public.voucher_campaigns (target_type, target_id) where is_active;
create table if not exists public.voucher_codes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.voucher_campaigns(id) on delete cascade,
  code text not null check (char_length(code) between 3 and 40),
  claimed_by uuid references public.profiles(id) on delete set null,
  claimed_at timestamptz,
  unique (campaign_id, code)
);
create index if not exists voucher_codes_free_idx on public.voucher_codes (campaign_id) where claimed_by is null;
create table if not exists public.voucher_grants (
  campaign_id uuid not null references public.voucher_campaigns(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  code text not null,
  issued_at timestamptz not null default now(),
  used_at timestamptz,
  primary key (campaign_id, user_id)
);
create index if not exists voucher_grants_user_idx on public.voucher_grants (user_id, issued_at desc);
alter table public.voucher_campaigns enable row level security;
alter table public.voucher_codes enable row level security;
alter table public.voucher_grants enable row level security;

-- ---------------------------------------------------------------------
-- 1. Phát voucher
-- ---------------------------------------------------------------------
create or replace function private.issue_voucher(c public.voucher_campaigns, p_user uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_code text; v_id uuid;
begin
  if not c.is_active or (c.valid_until is not null and c.valid_until <= now()) then return false; end if;
  if exists (select 1 from public.voucher_grants g where g.campaign_id = c.id and g.user_id = p_user) then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('voucher:' || c.id, 0));
  if c.code_mode = 'SHARED' then
    v_code := c.shared_code;
  else
    v_id := (select x.id from (select v.id, row_number() over (order by v.code) as rn from public.voucher_codes v
                                where v.campaign_id = c.id and v.claimed_by is null) x where x.rn = 1);
    if v_id is null then return false; end if;                          -- hết kho mã
    update public.voucher_codes set claimed_by = p_user, claimed_at = now() where id = v_id returning code into v_code;
  end if;
  if v_code is null then return false; end if;
  insert into public.voucher_grants (campaign_id, user_id, code) values (c.id, p_user, v_code) on conflict do nothing;
  perform private.notify(p_user, null, 'VOUCHER', 'Bạn nhận voucher từ ' || c.sponsor_name || ' 🎟️', c.title, '/me/vouchers', null, true);
  return true;
end $$;

create or replace function private.voucher_on_challenge() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.voucher_campaigns;
begin
  begin
    if new.completed_at is not null and old.completed_at is null and new.status <> 'LEFT' then
      for c in select * from public.voucher_campaigns v where v.target_type = 'CHALLENGE' and v.target_id = new.challenge_id
                 and v.condition = 'COMPLETE' and v.is_active loop
        perform private.issue_voucher(c, new.profile_id);
      end loop;
    end if;
    if new.final_rank is not null and old.final_rank is distinct from new.final_rank and new.status <> 'LEFT' then
      for c in select * from public.voucher_campaigns v where v.target_type = 'CHALLENGE' and v.target_id = new.challenge_id
                 and v.condition = 'TOP_N' and v.is_active and new.final_rank <= v.top_n loop
        perform private.issue_voucher(c, new.profile_id);
      end loop;
    end if;
  exception when others then
    raise warning 'voucher_on_challenge % lỗi: % %', new.id, sqlstate, sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists trg_zz_voucher_challenge on public.challenge_participants;
create trigger trg_zz_voucher_challenge after update of completed_at, final_rank on public.challenge_participants
  for each row execute function private.voucher_on_challenge();

create or replace function private.voucher_on_quest() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.voucher_campaigns;
begin
  begin
    if new.completed_at is not null and (tg_op = 'INSERT' or old.completed_at is null) then
      for c in select * from public.voucher_campaigns v where v.target_type = 'QUEST' and v.target_id = new.quest_id and v.is_active loop
        perform private.issue_voucher(c, new.user_id);
      end loop;
    end if;
  exception when others then
    raise warning 'voucher_on_quest lỗi: % %', sqlstate, sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists trg_zz_voucher_quest on public.user_quest_progress;
create trigger trg_zz_voucher_quest after insert or update of completed_at on public.user_quest_progress
  for each row execute function private.voucher_on_quest();

-- ---------------------------------------------------------------------
-- 2. Quyền quản lý chiến dịch: admin, hoặc BTC thử thách (chỉ thử thách của mình)
-- ---------------------------------------------------------------------
create or replace function private.voucher_can_manage(p_type text, p_target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_system_admin()
      or (p_type = 'CHALLENGE' and exists (select 1 from public.challenges c where c.id = p_target and private.challenge_is_manager(c)))
$$;

create or replace function private.voucher_json(v public.voucher_campaigns, p_manage boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', v.id, 'sponsor_name', v.sponsor_name, 'sponsor_logo', v.sponsor_logo, 'title', v.title, 'terms', v.terms,
    'redeem_url', v.redeem_url, 'target_type', v.target_type, 'target_id', v.target_id, 'condition', v.condition, 'top_n', v.top_n,
    'code_mode', v.code_mode, 'valid_until', v.valid_until, 'is_active', v.is_active,
    'issued', (select count(*) from public.voucher_grants g where g.campaign_id = v.id),
    'remaining', case when v.code_mode = 'POOL' then (select count(*) from public.voucher_codes c where c.campaign_id = v.id and c.claimed_by is null) end,
    'mine', (select jsonb_build_object('code', g.code, 'issued_at', g.issued_at, 'used_at', g.used_at)
               from public.voucher_grants g where g.campaign_id = v.id and g.user_id = auth.uid()))
    || case when p_manage then jsonb_build_object('shared_code', v.shared_code,
         'total', case when v.code_mode = 'POOL' then (select count(*) from public.voucher_codes c where c.campaign_id = v.id) end) else '{}'::jsonb end
$$;

create or replace function public.save_voucher_campaign(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_type text := upper(coalesce(p->>'target_type', ''));
  v_target uuid := nullif(p->>'target_id', '')::uuid;
  v_old public.voucher_campaigns := (select x from public.voucher_campaigns x where x.id = v_id);
  r public.voucher_campaigns;
begin
  if v_old.id is not null then v_type := v_old.target_type; v_target := v_old.target_id; end if;
  if v_type not in ('CHALLENGE', 'QUEST') or v_target is null then raise exception 'INVALID_VOUCHER'; end if;
  if not private.voucher_can_manage(v_type, v_target) then raise exception 'FORBIDDEN'; end if;
  if v_type = 'CHALLENGE' and not exists (select 1 from public.challenges c where c.id = v_target) then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if v_type = 'QUEST' and not exists (select 1 from public.quests q where q.id = v_target) then raise exception 'QUEST_NOT_FOUND'; end if;
  if coalesce(p->>'condition', 'COMPLETE') = 'TOP_N' and (v_type <> 'CHALLENGE' or coalesce((p->>'top_n')::int, 0) not between 1 and 100) then
    raise exception 'INVALID_VOUCHER';
  end if;
  if coalesce(p->>'code_mode', 'POOL') = 'SHARED' and char_length(trim(coalesce(p->>'shared_code', ''))) < 3 then raise exception 'INVALID_VOUCHER_CODE'; end if;
  if nullif(p->>'redeem_url', '') is not null and (p->>'redeem_url') !~ '^https://' then raise exception 'INVALID_URL'; end if;
  if nullif(p->>'sponsor_logo', '') is not null and (p->>'sponsor_logo') !~ '^https://' then raise exception 'INVALID_URL'; end if;

  insert into public.voucher_campaigns as t (id, sponsor_name, sponsor_logo, title, terms, redeem_url, target_type, target_id, condition, top_n,
    code_mode, shared_code, valid_until, is_active, created_by)
  values (coalesce(v_id, gen_random_uuid()), trim(p->>'sponsor_name'), nullif(trim(coalesce(p->>'sponsor_logo', '')), ''), trim(p->>'title'),
    nullif(trim(coalesce(p->>'terms', '')), ''), nullif(trim(coalesce(p->>'redeem_url', '')), ''), v_type, v_target,
    coalesce(p->>'condition', 'COMPLETE'), case when p->>'condition' = 'TOP_N' then (p->>'top_n')::int end,
    coalesce(p->>'code_mode', 'POOL'), case when p->>'code_mode' = 'SHARED' then upper(trim(p->>'shared_code')) end,
    nullif(p->>'valid_until', '')::timestamptz, coalesce((p->>'is_active')::boolean, true), v_uid)
  on conflict (id) do update set sponsor_name = excluded.sponsor_name, sponsor_logo = excluded.sponsor_logo, title = excluded.title,
    terms = excluded.terms, redeem_url = excluded.redeem_url, condition = excluded.condition, top_n = excluded.top_n,
    code_mode = excluded.code_mode, shared_code = excluded.shared_code, valid_until = excluded.valid_until, is_active = excluded.is_active
  returning * into r;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SAVE_VOUCHER', 'voucher:' || r.id, p - 'shared_code');
  return private.voucher_json(r, true);
end $$;

-- Dán danh sách mã (mỗi dòng một mã); bỏ trùng; tối đa 5.000 mã / lần
create or replace function public.add_voucher_codes(p_campaign_id uuid, p_codes text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.voucher_campaigns := (select x from public.voucher_campaigns x where x.id = p_campaign_id);
  v_n integer;
begin
  if c.id is null then raise exception 'INVALID_VOUCHER'; end if;
  if not private.voucher_can_manage(c.target_type, c.target_id) then raise exception 'FORBIDDEN'; end if;
  if c.code_mode <> 'POOL' then raise exception 'INVALID_VOUCHER'; end if;
  if cardinality(p_codes) > 5000 then raise exception 'TOO_MANY_CODES'; end if;
  insert into public.voucher_codes (campaign_id, code)
  select c.id, x.code from (select distinct upper(trim(u)) as code from unnest(p_codes) u) x
   where char_length(x.code) between 3 and 40
  on conflict (campaign_id, code) do nothing;
  get diagnostics v_n = row_count;
  -- Người đã đạt điều kiện trước khi có mã: phát bù (thử thách đã hoàn thành / Top N; nhiệm vụ đã hoàn thành trong kỳ còn hiệu lực)
  if c.target_type = 'CHALLENGE' then
    perform private.issue_voucher(c, p.profile_id) from public.challenge_participants p
     where p.challenge_id = c.target_id and p.status <> 'LEFT'
       and ((c.condition = 'COMPLETE' and p.completed_at is not null) or (c.condition = 'TOP_N' and p.final_rank <= c.top_n));
  end if;
  return jsonb_build_object('added', v_n) || private.voucher_json(c, true);
end $$;

create or replace function public.list_voucher_campaigns(p_target_type text, p_target_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_manage boolean := auth.uid() is not null and private.voucher_can_manage(upper(p_target_type), p_target_id);
begin
  if upper(p_target_type) = 'CHALLENGE' and not public.challenge_visible(p_target_id) then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  return (select coalesce(jsonb_agg(private.voucher_json(v, v_manage) order by v.created_at), '[]'::jsonb)
            from public.voucher_campaigns v
           where v.target_type = upper(p_target_type) and v.target_id = p_target_id and (v.is_active or v_manage));
end $$;

create or replace function public.admin_list_voucher_campaigns() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(private.voucher_json(v, true) || jsonb_build_object('target_name',
            case v.target_type when 'CHALLENGE' then (select c.title from public.challenges c where c.id = v.target_id)
                               else (select q.title from public.quests q where q.id = v.target_id) end) order by v.created_at desc), '[]'::jsonb)
            from public.voucher_campaigns v);
end $$;

create or replace function public.my_vouchers() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('campaign_id', v.id, 'sponsor_name', v.sponsor_name, 'sponsor_logo', v.sponsor_logo,
      'title', v.title, 'terms', v.terms, 'redeem_url', v.redeem_url, 'valid_until', v.valid_until, 'code', g.code,
      'issued_at', g.issued_at, 'used_at', g.used_at, 'target_type', v.target_type, 'target_id', v.target_id,
      'target_name', case v.target_type when 'CHALLENGE' then (select c.title from public.challenges c where c.id = v.target_id)
                                        else (select q.title from public.quests q where q.id = v.target_id) end)
      order by (g.used_at is not null), g.issued_at desc), '[]'::jsonb)
    from public.voucher_grants g join public.voucher_campaigns v on v.id = g.campaign_id
   where g.user_id = auth.uid()
$$;

create or replace function public.mark_voucher_used(p_campaign_id uuid, p_used boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  update public.voucher_grants set used_at = case when p_used then now() end where campaign_id = p_campaign_id and user_id = v_uid;
  if not found then raise exception 'VOUCHER_NOT_FOUND'; end if;
end $$;

revoke all on function private.issue_voucher(public.voucher_campaigns, uuid), private.voucher_on_challenge(), private.voucher_on_quest(),
  private.voucher_can_manage(text, uuid), private.voucher_json(public.voucher_campaigns, boolean) from public, anon, authenticated;
revoke all on function public.save_voucher_campaign(jsonb), public.add_voucher_codes(uuid, text[]), public.list_voucher_campaigns(text, uuid),
  public.admin_list_voucher_campaigns(), public.my_vouchers(), public.mark_voucher_used(uuid, boolean) from public, anon;
grant execute on function public.save_voucher_campaign(jsonb), public.add_voucher_codes(uuid, text[]), public.list_voucher_campaigns(text, uuid),
  public.admin_list_voucher_campaigns(), public.my_vouchers(), public.mark_voucher_used(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
