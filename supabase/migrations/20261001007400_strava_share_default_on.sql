-- 007400: Bài Strava hiện cho CLB & bảng xếp hạng NGAY khi runner kết nối Strava — không hỏi riêng nữa.
-- Quyết định sản phẩm (09/2026): bấm "Connect with Strava" (có dòng thông báo ngay dưới nút) được coi là đồng ý chia sẻ
-- quãng đường / thời gian bài chạy trong RaceHub. Runner vẫn TẮT được bất cứ lúc nào ở Cài đặt → Quyền riêng tư
-- (quyền rút lại đồng ý theo Luật Bảo vệ dữ liệu cá nhân) — chỉ lựa chọn TẮT rõ ràng (strava_share = false) mới ẩn bài.
-- Bản đồ tuyến, từng km, nhịp tim bài Strava vẫn chỉ chủ bài xem (006700). Admin vẫn chuyển được chính sách chung
-- (Quản trị → Hệ thống → Strava) sang "chỉ chủ bài" nếu Strava yêu cầu.
-- Áp dụng ngay cho bài cũ: bài Strava của người chưa từng trả lời được chia sẻ lại → trigger tự đưa vào bảng tin CLB,
-- thử thách, giải chạy đang diễn ra.
-- Cần 007000. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT. Chạy lại nhiều lần vẫn an toàn.

create or replace function private.activity_shared(p_user uuid, p_source text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when coalesce(p_source, '') <> 'STRAVA' then true
    when private.strava_share_policy() = 'ALL' then true
    when private.strava_share_policy() = 'OWNER_ONLY' then false
    else coalesce((select s.strava_share from public.profile_settings s where s.user_id = p_user), true) end
$$;

create or replace function public.my_strava_sharing() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := private.require_uid();
begin
  return jsonb_build_object(
    'policy', private.strava_share_policy(),
    'consent', coalesce((select s.strava_share from public.profile_settings s where s.user_id = v_uid), true),
    'connected', exists (select 1 from public.connected_accounts c where c.user_id = v_uid and c.provider = 'STRAVA'),
    'strava_runs', (select count(*) from public.activities a where a.user_id = v_uid and a.source = 'STRAVA'),
    'hidden_runs', (select count(*) from public.activities a where a.user_id = v_uid and a.source = 'STRAVA' and not a.shared));
end $$;

create or replace function public.admin_strava_sharing_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_connected integer := (select count(*) from public.connected_accounts c where c.provider = 'STRAVA');
  v_out integer := (select count(*) from public.profile_settings s where s.strava_share is false
                      and exists (select 1 from public.connected_accounts c where c.user_id = s.user_id and c.provider = 'STRAVA'));
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'policy', private.strava_share_policy(),
    'connected', v_connected,
    'opted_in', v_connected - v_out,
    'opted_out', v_out,
    'hidden_runs', (select count(*) from public.activities a where a.source = 'STRAVA' and not a.shared));
end $$;

revoke all on function private.activity_shared(uuid, text) from public, anon, authenticated;
revoke all on function public.my_strava_sharing(), public.admin_strava_sharing_stats() from public, anon;
grant execute on function public.my_strava_sharing(), public.admin_strava_sharing_stats() to authenticated;

-- Trang hướng dẫn "Chạy & ghi bài" (007300): đổi đoạn giải thích cũ nếu admin chưa sửa đoạn này
update public.help_pages
   set body = replace(replace(body, '## Bài Strava không hiện cho người khác?', '## Bài Strava có hiện cho CLB không?'),
     'Theo quy định API của Strava, bài từ Strava chỉ hiện trên bảng tin / BXH khi **bạn đồng ý chia sẻ** (Cài đặt → Quyền riêng tư). Chưa đồng ý, bài vẫn tính Xu / XP / huy hiệu cho chính bạn.',
     'Khi kết nối Strava, bài chạy của bạn tự hiện trên bảng tin CLB và bảng xếp hạng (chỉ quãng đường, thời gian; bản đồ và nhịp tim chỉ bạn xem). Muốn ẩn: **Cài đặt → Quyền riêng tư → Tắt**. Bài đã ẩn vẫn tính Xu / XP / huy hiệu cho chính bạn.'),
       updated_at = now()
 where slug = 'chay-va-ghi-bai' and body like '%khi **bạn đồng ý chia sẻ**%';

-- Chia sẻ lại bài Strava của người chưa từng chọn TẮT → trigger phía sau đưa vào CLB / thử thách / giải chạy
select private.strava_reshare(null);

notify pgrst, 'reload schema';
