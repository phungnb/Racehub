-- 016700: Kiến thức — admin / biên tập được XOÁ cả bài đã đăng hoặc đã lưu trữ (trước đây chỉ lưu trữ).
-- Người viết thường vẫn chỉ xoá được nháp của mình, chưa từng đăng. Mỗi lần xoá ghi nhật ký CONTENT_DELETE.
-- Chạy lại nhiều lần vẫn an toàn.
create or replace function public.cms_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_role text := private.require_content_staff();
  a public.content_articles := (select x from public.content_articles x where x.id = p_id);
begin
  if a.id is null then raise exception 'ARTICLE_NOT_FOUND'; end if;
  if v_role not in ('ADMIN', 'EDITOR') then
    if a.created_by is distinct from v_uid then raise exception 'FORBIDDEN'; end if;
    if a.published_at is not null and a.published_at <= now() then raise exception 'ARCHIVE_INSTEAD'; end if;
  end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'CONTENT_DELETE', 'article:' || a.id, jsonb_build_object('title', a.title, 'from', a.status));
  delete from public.content_articles where id = a.id;
end $$;
revoke all on function public.cms_delete(uuid) from public, anon;
grant execute on function public.cms_delete(uuid) to authenticated;

notify pgrst, 'reload schema';
