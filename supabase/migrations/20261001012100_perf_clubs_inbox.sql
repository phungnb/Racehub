-- Tăng tốc danh sách CLB (tab CLB): đếm tin chưa đọc tối đa 100 (giao diện chỉ hiện "99+"),
-- không phải quét toàn bộ lịch sử chat của CLB chưa từng mở. Kết quả trả về giữ nguyên các cột.
create or replace function public.my_clubs_inbox()
returns table (
  club_id uuid, name text, avatar_url text, accent_color text, role text, member_status text,
  member_count integer, unread_count integer, last_message_body text, last_message_author text,
  last_message_at timestamptz, pinned_title text
)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.avatar_url, c.accent_color, m.role, m.status, c.member_count,
         case when m.status <> 'APPROVED' then 0 else (
           select count(*)::int from (
             select 1 from public.club_messages x
              where x.club_id = c.id and x.deleted_at is null and x.author_id <> (select auth.uid())
                and x.created_at > coalesce((select r.last_read_at from public.club_message_reads r
                                              where r.club_id = c.id and r.user_id = (select auth.uid())), m.joined_at, '-infinity')
              order by x.created_at desc
              limit 100) u)
         end,
         lm.body, private.display_name(lm.author_id), lm.created_at,
         (select coalesce(p.title, left(p.body, 80)) from public.club_posts p
           where p.club_id = c.id and p.is_pinned and p.deleted_at is null
           order by p.created_at desc limit 1)
    from public.club_members m
    join public.clubs c on c.id = m.club_id
    left join lateral (
      select x.body, x.author_id, x.created_at from public.club_messages x
       where x.club_id = c.id and x.deleted_at is null and m.status = 'APPROVED'
       order by x.created_at desc limit 1) lm on true
   where m.user_id = (select auth.uid()) and m.status in ('APPROVED', 'PENDING')
   order by coalesce(lm.created_at, m.joined_at) desc nulls last
$$;
