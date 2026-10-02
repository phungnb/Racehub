-- Trình soạn của ban nội dung (CMS) đăng được Ebook PDF như trang Viết bài của runner (011700).
-- Trước đây cms_save ép content_type về ARTICLE / NEWS và bỏ qua attachment_url:
-- admin không đăng được ebook, và sửa ebook của runner trong CMS làm mất loại Ebook.
-- p thêm: content_type 'EBOOK', attachment_url (https, ≤ 500 ký tự; bắt buộc với Ebook; vắng khóa = giữ tệp cũ).

create or replace function public.cms_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_role text := private.require_content_staff();
  a public.content_articles := (select x from public.content_articles x where x.id = nullif(p->>'id', '')::uuid);
  v_id uuid;
  v_title text := trim(coalesce(p->>'title', ''));
  v_slug text := nullif(private.slugify(coalesce(nullif(p->>'slug', ''), p->>'title')), '');
  v_body text := coalesce(p->>'body', '');
  v_cat text := coalesce(nullif(p->>'category_id', ''), a.category_id);
  v_expert boolean;
  v_editor boolean := v_role in ('ADMIN', 'EDITOR');
  v_type text := case upper(coalesce(p->>'content_type', '')) when 'NEWS' then 'NEWS' when 'EBOOK' then 'EBOOK' else 'ARTICLE' end;
  -- Không gửi khóa attachment_url thì giữ tệp cũ (bản app cũ không biết khóa này)
  v_att text := case when p ? 'attachment_url' then nullif(trim(coalesce(p->>'attachment_url', '')), '') else a.attachment_url end;
begin
  if nullif(p->>'id', '') is not null and a.id is null then raise exception 'ARTICLE_NOT_FOUND'; end if;
  if a.id is not null and not v_editor and (a.created_by is distinct from v_uid or a.status not in ('DRAFT', 'REVIEW')) then
    raise exception 'FORBIDDEN';
  end if;
  if char_length(v_title) < 5 then raise exception 'TITLE_TOO_SHORT'; end if;
  if v_slug is null then raise exception 'INVALID_SLUG'; end if;
  if not exists (select 1 from public.content_categories c where c.id = v_cat) then raise exception 'INVALID_CATEGORY'; end if;
  if exists (select 1 from public.content_articles x where x.slug = v_slug and x.id is distinct from a.id) then raise exception 'SLUG_TAKEN'; end if;
  if nullif(p->>'cover_image_url', '') is not null and p->>'cover_image_url' !~ '^https://' then raise exception 'INVALID_URL'; end if;
  if nullif(p->>'source_url', '') is not null and p->>'source_url' !~ '^https?://' then raise exception 'INVALID_URL'; end if;
  if v_att is not null and (v_att !~ '^https://' or char_length(v_att) > 500) then raise exception 'INVALID_URL'; end if;
  if v_type = 'EBOOK' and v_att is null then raise exception 'EBOOK_PDF_REQUIRED'; end if;
  -- Chuyên mục sức khoẻ / giáo án luôn cần duyệt chuyên môn; chỉ admin tắt được
  v_expert := (select c.needs_expert from public.content_categories c where c.id = v_cat)
              or coalesce((p->>'needs_expert_review')::boolean, a.needs_expert_review, false);
  if v_role = 'ADMIN' and (p ? 'needs_expert_review') then v_expert := (p->>'needs_expert_review')::boolean; end if;

  if a.id is null then
    insert into public.content_articles (slug, title, summary, body, cover_image_url, category_id, author_id, content_type, reading_time_minutes,
      source_url, source_name, is_featured, series_id, series_order, ctas, needs_expert_review, attachment_url, created_by)
    values (v_slug, v_title, nullif(left(trim(coalesce(p->>'summary', '')), 300), ''), v_body, nullif(p->>'cover_image_url', ''), v_cat,
      coalesce(nullif(p->>'author_id', '')::uuid, (select au.id from public.content_authors au where au.user_id = v_uid)),
      v_type, private.reading_minutes(v_body),
      nullif(p->>'source_url', ''), nullif(left(trim(coalesce(p->>'source_name', '')), 80), ''),
      v_editor and coalesce((p->>'is_featured')::boolean, false), nullif(p->>'series_id', ''), nullif(p->>'series_order', '')::int,
      private.clean_ctas(p->'ctas'), v_expert, v_att, v_uid)
    returning id into v_id;
  else
    v_id := a.id;
    update public.content_articles set slug = v_slug, title = v_title, summary = nullif(left(trim(coalesce(p->>'summary', '')), 300), ''),
      body = v_body, cover_image_url = nullif(p->>'cover_image_url', ''), category_id = v_cat,
      author_id = case when p ? 'author_id' then nullif(p->>'author_id', '')::uuid else author_id end,
      content_type = v_type, attachment_url = v_att,
      reading_time_minutes = private.reading_minutes(v_body),
      source_url = nullif(p->>'source_url', ''), source_name = nullif(left(trim(coalesce(p->>'source_name', '')), 80), ''),
      is_featured = case when v_editor then coalesce((p->>'is_featured')::boolean, is_featured) else is_featured end,
      series_id = nullif(p->>'series_id', ''), series_order = nullif(p->>'series_order', '')::int,
      ctas = private.clean_ctas(p->'ctas'), needs_expert_review = v_expert,
      -- nội dung chuyên môn đổi mà người sửa không phải chuyên gia → duyệt lại
      expert_reviewed_at = case when body is distinct from v_body and v_role not in ('ADMIN', 'EXPERT') then null else expert_reviewed_at end,
      expert_reviewed_by = case when body is distinct from v_body and v_role not in ('ADMIN', 'EXPERT') then null else expert_reviewed_by end,
      updated_at = now()
     where id = v_id;
    -- bài đang đăng mất duyệt chuyên môn → gỡ về chờ duyệt
    update public.content_articles set status = 'REVIEW', review_note = 'Nội dung đã đổi — cần duyệt chuyên môn lại'
     where id = v_id and needs_expert_review and expert_reviewed_at is null and status in ('SCHEDULED', 'PUBLISHED');
  end if;

  -- Tag: tạo mới nếu chưa có
  delete from public.content_article_tags where article_id = v_id;
  insert into public.content_tags (slug, name)
  select distinct private.slugify(t), left(trim(t), 40) from jsonb_array_elements_text(coalesce(p->'tags', '[]'::jsonb)) t
   where private.slugify(t) <> '' on conflict (slug) do nothing;
  insert into public.content_article_tags (article_id, tag_id)
  select distinct v_id, ct.id from jsonb_array_elements_text(coalesce(p->'tags', '[]'::jsonb)) t
    join public.content_tags ct on ct.slug = private.slugify(t)
  on conflict do nothing;
  -- Nguồn tham khảo
  delete from public.content_sources where article_id = v_id;
  insert into public.content_sources (article_id, title, url, publisher, sort)
  select v_id, left(trim(s->>'title'), 200), case when s->>'url' ~ '^https?://' then left(s->>'url', 500) end,
         nullif(left(trim(coalesce(s->>'publisher', '')), 80), ''), n::int
    from jsonb_array_elements(coalesce(p->'sources', '[]'::jsonb)) with ordinality x(s, n)
   where char_length(trim(coalesce(s->>'title', ''))) > 0 and n <= 20;
  return v_id;
end $$;
