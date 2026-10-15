-- 016600: Tin kiến thức tự quét — bài đầy đủ phải có ĐỦ nội dung; nâng cấp bản tóm tắt cũ lên bài đầy đủ.
-- • Link nguồn đã có sẽ không còn bị bỏ qua nếu bản cũ là tóm tắt (NEWS) tự quét, đang chờ duyệt và chưa ai sửa: quét lại ở chế độ "Bài đầy đủ" sẽ thay nội dung bằng toàn văn.
--   Bài đã được biên tập sửa / đăng thì không bao giờ bị ghi đè.
-- • Giới hạn toàn văn nhận vào tăng lên 50.000 ký tự.
-- Chạy lại nhiều lần vẫn an toàn.
create or replace function public.knowledge_scan_ingest(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_title text := trim(coalesce(p->>'title', ''));
  v_url text := trim(coalesce(p->>'source_url', ''));
  v_cat text := coalesce(nullif(p->>'category_id', ''), 'RACES');
  v_summary text := nullif(left(trim(coalesce(p->>'summary', '')), 300), '');
  v_name text := nullif(left(trim(coalesce(p->>'source_name', '')), 80), '');
  v_full text := nullif(trim(coalesce(p->>'body', '')), '');
  v_body text;
  v_slug text;
  v_id uuid;
begin
  if char_length(v_title) < 5 or char_length(v_title) > 140 then return null; end if;
  if v_url !~ '^https?://[^[:space:]]+$' or char_length(v_url) > 500 then return null; end if;
  if v_summary is null then return null; end if;
  if not exists (select 1 from public.content_categories c where c.id = v_cat) then v_cat := 'RACES'; end if;
  -- Bài đầy đủ chỉ nhận khi đủ dài; không thì lưu dạng tóm tắt
  if v_full is not null and char_length(v_full) between 300 and 50000 then
    v_body := v_full || E'\n\nNguồn: ' || coalesce(v_name, v_url) || ' — ' || v_url;
  else
    v_full := null;
    v_body := v_summary || E'\n\nNguồn: ' || coalesce(v_name, v_url) || ' — ' || v_url;
  end if;
  -- Link nguồn đã có: chỉ NÂNG CẤP bản tóm tắt tự quét (chưa ai sửa / đăng) lên bài đầy đủ; mọi trường hợp khác bỏ qua
  v_id := (select x.id from public.content_articles x where lower(x.source_url) = lower(v_url) limit 1);
  if v_id is not null then
    if v_full is not null and exists (select 1 from public.content_articles x where x.id = v_id and x.content_type = 'NEWS'
                                       and x.status = 'REVIEW' and x.created_by is null) then
      update public.content_articles set body = v_body, summary = v_summary, content_type = 'ARTICLE', reading_time_minutes = private.reading_minutes(v_body),
        review_note = 'Bài AI viết lại từ nguồn: biên tập đọc kỹ, sửa và đối chiếu nguồn trước khi đăng', updated_at = now()
       where id = v_id;
      return v_id;
    end if;
    return null;
  end if;
  v_slug := left(coalesce(nullif(private.slugify(v_title), ''), 'tin'), 80) || '-' || substr(md5(lower(v_url)), 1, 6);
  if exists (select 1 from public.content_articles x where x.slug = v_slug) then return null; end if;
  insert into public.content_articles (slug, title, summary, body, category_id, content_type, status, reading_time_minutes,
    source_url, source_name, needs_expert_review, review_note)
  values (v_slug, v_title, v_summary, v_body, v_cat, case when v_full is null then 'NEWS' else 'ARTICLE' end, 'REVIEW',
    private.reading_minutes(v_body), v_url, v_name,
    coalesce((select c.needs_expert from public.content_categories c where c.id = v_cat), false),
    case when v_full is null then 'Tin tự quét: biên tập kiểm tra nội dung và nguồn trước khi đăng'
         else 'Bài AI viết lại từ nguồn: biên tập đọc kỹ, sửa và đối chiếu nguồn trước khi đăng' end)
  returning id into v_id;
  insert into public.content_tags (slug, name)
  select distinct private.slugify(t), left(trim(t), 40) from jsonb_array_elements_text(coalesce(p->'tags', '[]'::jsonb)) t
   where private.slugify(t) <> '' on conflict (slug) do nothing;
  insert into public.content_article_tags (article_id, tag_id)
  select distinct v_id, ct.id from jsonb_array_elements_text(coalesce(p->'tags', '[]'::jsonb)) t
    join public.content_tags ct on ct.slug = private.slugify(t)
  on conflict do nothing;
  return v_id;
end $$;
revoke all on function public.knowledge_scan_ingest(jsonb) from public, anon, authenticated;
grant execute on function public.knowledge_scan_ingest(jsonb) to service_role;

notify pgrst, 'reload schema';
