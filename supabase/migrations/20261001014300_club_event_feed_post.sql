-- Lịch CLB mới tạo → tự lên bảng tin CLB (club_posts.kind = 'NEWS', chuyên mục EVENT, meta.event_id).
-- Trước đây create_club_event chỉ gửi thông báo, không có bài trên bảng tin nên lịch vừa tạo không hiện ở đó.
-- Dùng trigger để không phải sao lại các RPC tạo/sửa/hủy: sửa lịch thì cập nhật bài, hủy lịch thì gỡ bài.

create or replace function private.club_event_post_body(e public.club_events) returns text
language sql immutable set search_path = public as $$
  select to_char(e.starts_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM/YYYY')
      || coalesce(E'\n' || e.location_name, '')
      || coalesce(E'\n' || nullif(trim(e.description), ''), '')
$$;

create or replace function private.club_event_to_post() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'SCHEDULED' then
      insert into public.club_posts (club_id, author_id, kind, title, body, meta)
      values (new.club_id, new.created_by, 'NEWS', 'Lịch chạy: ' || new.title, private.club_event_post_body(new),
              jsonb_build_object('category', 'EVENT', 'event_id', new.id));
    end if;
  elsif new.status = 'CANCELLED' then
    delete from public.club_posts where kind = 'NEWS' and meta->>'event_id' = new.id::text;
  else
    update public.club_posts set title = 'Lịch chạy: ' || new.title, body = private.club_event_post_body(new)
     where kind = 'NEWS' and meta->>'event_id' = new.id::text;
  end if;
  return new;
end $$;

drop trigger if exists club_event_post_trg on public.club_events;
create trigger club_event_post_trg after insert or update of title, description, starts_at, location_name, status
  on public.club_events for each row execute function private.club_event_to_post();

revoke all on function private.club_event_to_post() from public, anon, authenticated;

-- Lịch sắp tới đã tạo trước đây
insert into public.club_posts (club_id, author_id, kind, title, body, meta, created_at)
select e.club_id, e.created_by, 'NEWS', 'Lịch chạy: ' || e.title, private.club_event_post_body(e),
       jsonb_build_object('category', 'EVENT', 'event_id', e.id), e.created_at
  from public.club_events e
 where e.status = 'SCHEDULED' and e.starts_at > now()
   and not exists (select 1 from public.club_posts p where p.kind = 'NEWS' and p.meta->>'event_id' = e.id::text);

notify pgrst, 'reload schema';
