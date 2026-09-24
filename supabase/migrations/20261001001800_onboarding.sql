-- =====================================================================
-- 001800 — Onboarding người mới (ONB-01)
-- profiles.onboarded_at: null = chưa đi qua màn chào mừng. Người dùng hiện có được coi là đã xong.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT.
-- =====================================================================

alter table public.profiles add column if not exists onboarded_at timestamptz;

-- Chỉ điền cho tài khoản có sẵn TRƯỚC khi cột này tồn tại (chạy lại migration không ảnh hưởng người mới)
create or replace function private.backfill_onboarded() returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if exists (select 1 from private.app_settings where key = 'onboarding_backfilled') then return 0; end if;
  update public.profiles set onboarded_at = coalesce(created_at, now()) where onboarded_at is null;
  get diagnostics v_n = row_count;
  insert into private.app_settings (key, value) values ('onboarding_backfilled', now()::text);
  return v_n;
end $$;
select private.backfill_onboarded();

create or replace function public.complete_onboarding() returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); v_at timestamptz;
begin
  update public.profiles set onboarded_at = coalesce(onboarded_at, now()) where id = v_uid;
  v_at := (select onboarded_at from public.profiles where id = v_uid);
  return v_at;
end $$;

revoke all on function public.complete_onboarding() from public, anon;
grant execute on function public.complete_onboarding() to authenticated;
revoke all on function private.backfill_onboarded() from public, anon, authenticated;

notify pgrst, 'reload schema';
