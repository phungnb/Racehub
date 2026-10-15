-- 017000: Xoá nguồn quét KHÔNG làm mất giải đã đưa vào bảng tổng hợp.
-- Trước: xoá nguồn → xoá hết giải đã tìm từ nguồn (kể cả giải đã duyệt). Nay: giải APPROVED được giữ lại (source_id về null);
-- chỉ các giải chưa duyệt / bị lọc / đã bỏ của nguồn đó mới bị xoá theo.
-- Chạy lại nhiều lần vẫn an toàn.
alter table public.race_candidates drop constraint if exists race_candidates_source_id_fkey;
alter table public.race_candidates add constraint race_candidates_source_id_fkey
  foreign key (source_id) references public.race_sources(id) on delete set null;

create or replace function private.race_source_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.race_candidates where source_id = old.id and status <> 'APPROVED';
  return old;
end $$;
drop trigger if exists trg_race_source_cleanup on public.race_sources;
create trigger trg_race_source_cleanup before delete on public.race_sources
  for each row execute function private.race_source_cleanup();

notify pgrst, 'reload schema';
