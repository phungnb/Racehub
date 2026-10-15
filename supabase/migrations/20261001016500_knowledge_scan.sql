-- 016500: Quét & gợi ý TIN KIẾM THỨC cho mục Kiến thức runner (dùng chung bảng nguồn quét của tab Race).
-- • race_sources.target: 'RACE' (giải chạy, như cũ) | 'KNOWLEDGE' (tin / bài kiến thức); category_id = chuyên mục mặc định khi AI không chắc.
-- • knowledge_scan_ingest (CHỈ service_role): tạo bài (NEWS tóm tắt, hoặc ARTICLE nếu nguồn chọn 'Bài đầy đủ') ở trạng thái REVIEW (chờ biên tập), kèm link + tên nguồn gốc.
--   Không bao giờ đăng thẳng. Chuyên mục sức khoẻ / giáo án vẫn bắt buộc duyệt chuyên môn như mọi bài khác (needs_expert_review).
--   Trùng link nguồn với bài đã có thì bỏ qua.
-- Chạy lại nhiều lần vẫn an toàn.
alter table public.race_sources add column if not exists target text not null default 'RACE';
alter table public.race_sources drop constraint if exists race_sources_target_ck;
alter table public.race_sources add constraint race_sources_target_ck check (target in ('RACE', 'KNOWLEDGE'));
-- scan_mode: 'SUMMARY' = tóm tắt ngắn + link nguồn; 'FULL' = AI viết lại thành bài đầy đủ (vẫn vào hàng chờ, biên tập sửa rồi mới đăng)
alter table public.race_sources add column if not exists scan_mode text not null default 'SUMMARY';
alter table public.race_sources drop constraint if exists race_sources_scan_mode_ck;
alter table public.race_sources add constraint race_sources_scan_mode_ck check (scan_mode in ('SUMMARY', 'FULL'));
alter table public.race_sources add column if not exists category_id text references public.content_categories(id) on delete set null;

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
  if exists (select 1 from public.content_articles x where lower(x.source_url) = lower(v_url)) then return null; end if;
  -- Bài đầy đủ chỉ nhận khi đủ dài; không thì lưu dạng tóm tắt
  if v_full is not null and char_length(v_full) between 300 and 30000 then
    v_body := v_full || E'\n\nNguồn: ' || coalesce(v_name, v_url) || ' — ' || v_url;
  else
    v_full := null;
    v_body := v_summary || E'\n\nNguồn: ' || coalesce(v_name, v_url) || ' — ' || v_url;
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
