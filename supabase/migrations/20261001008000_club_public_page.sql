-- 008000: Trang công khai của CLB Pro — racehub.vn/c/<link-riêng> (học từ Tucana: "nhà" của CLB trên web).
-- Người chưa đăng nhập cũng xem được: tên, logo, màu, giới thiệu, số thành viên, năm thành lập, số buổi chạy nhóm /
-- thử thách đã tổ chức, nút Tham gia. KHÔNG có dữ liệu bài chạy / tên thành viên (quyền riêng tư + điều khoản Strava).
-- Chỉ CLB Pro còn hạn có link riêng (như resolve_club_slug của 002800).
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT. Chạy lại nhiều lần vẫn an toàn.

create or replace function public.club_public_page(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', c.id, 'slug', c.slug, 'name', c.name, 'description', c.description, 'avatar_url', c.avatar_url,
    'accent_color', c.accent_color, 'member_count', c.member_count, 'join_policy', c.join_policy, 'founded_at', c.created_at,
    'events_held', (select count(*) from public.club_events e where e.club_id = c.id and e.starts_at < now()),
    'events_upcoming', (select count(*) from public.club_events e where e.club_id = c.id and e.starts_at >= now()),
    'challenges_held', (select count(*) from public.challenges ch where ch.target_club_id = c.id and ch.status <> 'CANCELLED'))
    from public.clubs c
   where c.slug = lower(trim(coalesce(p_slug, ''))) and c.plan = 'PRO' and (c.pro_until is null or c.pro_until > now())
$$;

revoke all on function public.club_public_page(text) from public;
grant execute on function public.club_public_page(text) to anon, authenticated;

notify pgrst, 'reload schema';
