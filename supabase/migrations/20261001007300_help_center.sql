-- 007300: Trung tâm Hướng dẫn & Chính sách (menu ☰) + thông tin pháp nhân.
-- • public.help_pages: trang hướng dẫn chơi (GUIDE), chính sách / quy định (POLICY), hỗ trợ (SUPPORT) — nội dung Markdown,
--   có phiên bản + ngày hiệu lực; admin soạn / sửa / ẩn ở Quản trị → Cộng đồng → Hướng dẫn & chính sách, không cần deploy.
--   Đọc được KHI CHƯA ĐĂNG NHẬP (người dùng phải xem được chính sách trước khi đồng ý đăng ký).
-- • public.site_info: tên công ty, MST, địa chỉ, email / điện thoại hỗ trợ, người phụ trách dữ liệu cá nhân, tuổi tối thiểu —
--   hiện ở chân menu và thay vào chỗ {{company_name}}, {{support_email}}… trong nội dung trang (chưa nhập → "đang cập nhật").
-- • Nội dung mẫu chỉ được thêm khi chưa có trang cùng slug → chạy lại KHÔNG ghi đè bản admin đã sửa.
--   Trang đánh dấu needs_review = cần luật sư / admin rà trước khi coi là bản chính thức.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT. Chạy lại nhiều lần vẫn an toàn.

create table if not exists public.help_pages (
  slug text primary key check (slug ~ '^[a-z0-9-]{2,60}$'),
  section text not null check (section in ('GUIDE', 'POLICY', 'SUPPORT')),
  title text not null check (char_length(title) between 2 and 120),
  icon text check (icon is null or char_length(icon) <= 8),
  summary text check (summary is null or char_length(summary) <= 200),
  body text not null default '' check (char_length(body) <= 60000),
  version text not null default '1.0' check (char_length(version) <= 20),
  effective_at date,
  sort integer not null default 100,
  is_published boolean not null default true,
  needs_review boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
alter table public.help_pages enable row level security;
revoke all on public.help_pages from anon, authenticated;

create table if not exists public.site_info (
  id boolean primary key default true check (id),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
alter table public.site_info enable row level security;
revoke all on public.site_info from anon, authenticated;
insert into public.site_info (id) values (true) on conflict (id) do nothing;

-- Các khoá thông tin pháp nhân được phép (giữ đồng bộ với features/help/model/help.ts)
create or replace function private.site_info_keys() returns text[]
language sql immutable as $$
  select array['company_name', 'tax_code', 'address', 'support_email', 'support_phone', 'dpo_contact', 'min_age', 'report_email', 'business_license']
$$;

-- ---------------------------------------------------------------------
-- 1. Đọc (khách + người dùng)
-- ---------------------------------------------------------------------
create or replace function public.help_menu() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'pages', coalesce((select jsonb_agg(jsonb_build_object('slug', p.slug, 'section', p.section, 'title', p.title, 'icon', p.icon,
                                                           'summary', p.summary) order by p.section, p.sort, p.title)
                       from public.help_pages p where p.is_published), '[]'::jsonb),
    'site', coalesce((select s.data from public.site_info s where s.id), '{}'::jsonb))
$$;

create or replace function public.help_page(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  p public.help_pages := (select x from public.help_pages x where x.slug = lower(trim(coalesce(p_slug, ''))));
begin
  if p.slug is null or (not p.is_published and not public.is_system_admin()) then raise exception 'PAGE_NOT_FOUND'; end if;
  return jsonb_build_object('slug', p.slug, 'section', p.section, 'title', p.title, 'icon', p.icon, 'summary', p.summary,
    'body', p.body, 'version', p.version, 'effective_at', p.effective_at, 'updated_at', p.updated_at,
    'is_published', p.is_published, 'needs_review', p.needs_review,
    'site', coalesce((select s.data from public.site_info s where s.id), '{}'::jsonb));
end $$;

-- ---------------------------------------------------------------------
-- 2. Quản trị
-- ---------------------------------------------------------------------
create or replace function public.admin_help_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'pages', coalesce((select jsonb_agg(to_jsonb(p) - 'updated_by'
                         || jsonb_build_object('updated_by_name', private.display_name(p.updated_by)) order by p.section, p.sort, p.title)
                       from public.help_pages p), '[]'::jsonb),
    'site', coalesce((select s.data from public.site_info s where s.id), '{}'::jsonb));
end $$;

create or replace function public.admin_help_save(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  v_slug text := lower(trim(coalesce(p->>'slug', '')));
  v_old public.help_pages := (select x from public.help_pages x where x.slug = v_slug);
begin
  if v_slug !~ '^[a-z0-9-]{2,60}$' then raise exception 'INVALID_SLUG'; end if;
  if coalesce(p->>'section', '') not in ('GUIDE', 'POLICY', 'SUPPORT') then raise exception 'INVALID_SECTION'; end if;
  if char_length(trim(coalesce(p->>'title', ''))) not between 2 and 120 then raise exception 'INVALID_TITLE'; end if;
  insert into public.help_pages (slug, section, title, icon, summary, body, version, effective_at, sort, is_published, needs_review, updated_at, updated_by)
  values (v_slug, p->>'section', trim(p->>'title'), nullif(trim(coalesce(p->>'icon', '')), ''), nullif(trim(coalesce(p->>'summary', '')), ''),
          coalesce(p->>'body', ''), coalesce(nullif(trim(coalesce(p->>'version', '')), ''), '1.0'), nullif(p->>'effective_at', '')::date,
          coalesce((p->>'sort')::integer, 100), coalesce((p->>'is_published')::boolean, true), coalesce((p->>'needs_review')::boolean, false),
          now(), v_uid)
  on conflict (slug) do update set section = excluded.section, title = excluded.title, icon = excluded.icon, summary = excluded.summary,
    body = excluded.body, version = excluded.version, effective_at = excluded.effective_at, sort = excluded.sort,
    is_published = excluded.is_published, needs_review = excluded.needs_review, updated_at = now(), updated_by = v_uid;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'HELP_PAGE_SAVE', v_slug, jsonb_build_object('title', trim(p->>'title'), 'version', p->>'version',
          'published', coalesce((p->>'is_published')::boolean, true), 'new', v_old.slug is null,
          'old_version', v_old.version, 'body_changed', v_old.body is distinct from coalesce(p->>'body', '')));
  return v_slug;
end $$;

create or replace function public.admin_help_delete(p_slug text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  v_old public.help_pages := (select x from public.help_pages x where x.slug = p_slug);
begin
  if v_old.slug is null then raise exception 'PAGE_NOT_FOUND'; end if;
  delete from public.help_pages where slug = p_slug;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'HELP_PAGE_DELETE', p_slug, jsonb_build_object('title', v_old.title, 'version', v_old.version, 'body', left(v_old.body, 20000)));
end $$;

create or replace function public.admin_site_info_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_admin();
  v_data jsonb := (select coalesce(jsonb_object_agg(k, left(trim(p->>k), 300)), '{}'::jsonb)
                     from unnest(private.site_info_keys()) k
                    where p ? k and trim(coalesce(p->>k, '')) <> '');
begin
  update public.site_info set data = v_data, updated_at = now(), updated_by = v_uid where id;
  insert into public.admin_audit_log (actor_id, action, target, new_value) values (v_uid, 'SITE_INFO_SAVE', 'site_info', v_data);
  return v_data;
end $$;

revoke all on function public.help_menu(), public.help_page(text), public.admin_help_list(), public.admin_help_save(jsonb),
  public.admin_help_delete(text), public.admin_site_info_save(jsonb) from public;
grant execute on function public.help_menu(), public.help_page(text) to anon, authenticated;
grant execute on function public.admin_help_list(), public.admin_help_save(jsonb), public.admin_help_delete(text),
  public.admin_site_info_save(jsonb) to authenticated;
revoke all on function private.site_info_keys() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Nội dung mẫu (chỉ thêm khi chưa có — không ghi đè bản admin đã sửa)
-- ---------------------------------------------------------------------
insert into public.help_pages (slug, section, title, icon, summary, sort, needs_review, effective_at, body) values

('bat-dau', 'GUIDE', 'Bắt đầu trong 3 phút', '🚀', 'Chạy → XP → Level → Thử thách → CLB', 10, false, date '2026-10-01', $md$
RaceHub biến mỗi km bạn chạy thành một cuộc chơi.

## Vòng chơi

🏃 **Chạy** → ⭐ **XP** → ⬆️ **Level** → 🎯 **Thử thách** → 🏅 **Huy hiệu** → 👥 **CLB**

## 4 việc đầu tiên

1. **Hoàn thiện hồ sơ** — tên hiển thị, ảnh đại diện.
2. **Chọn nhân vật** — runner của bạn sẽ lên đồ theo hành trình.
3. **Kết nối nguồn chạy** — chạy bằng app RaceHub hoặc kết nối Strava.
4. **Chạy bài đầu tiên** — bấm nút **Chạy** ở giữa thanh dưới.

Sau đó: tham gia một [thử thách](/challenges) và tìm [CLB](/clubs) gần bạn.

> Mọi thứ trong RaceHub đều bắt đầu từ km thật. Không có cách mua XP.
$md$),

('chay-va-ghi-bai', 'GUIDE', 'Chạy & ghi bài', '🏃', 'GPS trong app, Strava, vì sao bài bị từ chối', 20, false, date '2026-10-01', $md$
## Hai cách ghi bài

- **Chạy bằng app RaceHub:** bấm **Chạy**, chờ biểu tượng GPS chuyển xanh rồi bắt đầu. Để màn hình sáng hoặc cho phép app chạy nền.
- **Kết nối Strava:** bài chạy trên đồng hồ / Strava tự về RaceHub sau vài phút.

## Bài hợp lệ

Bài được tính khi đúng là **chạy bộ / đi bộ** với tốc độ hợp lý. Hệ thống tự phát hiện:

- tốc độ quá nhanh (đi xe), GPS nhảy, mất tín hiệu dài rồi nối thẳng;
- bài trùng giờ với bài khác.

Bài nghi ngờ sẽ **chờ duyệt**, không bị xoá. Xem chi tiết tại [Công bằng & chống gian lận](/help/cong-bang-chong-gian-lan).

## Mẹo GPS

- Android: tắt **tối ưu pin** cho RaceHub.
- Đợi GPS ổn định 10–20 giây trước khi bấm bắt đầu.
- Chạy nơi thoáng, tránh hầm và toà nhà cao.

## Bài Strava không hiện cho người khác?

Theo quy định API của Strava, bài từ Strava chỉ hiện trên bảng tin / BXH khi **bạn đồng ý chia sẻ** (Cài đặt → Quyền riêng tư). Chưa đồng ý, bài vẫn tính Xu / XP / huy hiệu cho chính bạn.
$md$),

('xp-level', 'GUIDE', 'XP & Level', '⭐', 'XP chỉ đến từ km chạy thật', 30, false, date '2026-10-01', $md$
## XP đến từ đâu?

🏃 **1 km hợp lệ** → ⭐ **XP**

XP **chỉ** đến từ km bạn chạy. Không mua được, không nhận từ nhiệm vụ hay quà tặng.

## Level

Có **8 cấp độ** từ *Tân Binh* đến *Đỉnh Cao RaceHub*. XP càng nhiều, level càng cao; một số cấp có thưởng Xu một lần.

## Nghỉ lâu có mất level?

Không. Level là thành tích trọn đời — nghỉ dài ngày chỉ đổi trạng thái **phong độ** (Đang lên / Ổn định / Tạm nghỉ…). Quay lại chạy sau thời gian dài còn có thưởng *Chào mừng trở lại*.
$md$),

('xu-vi', 'GUIDE', 'Xu & Ví', '🪙', 'Xu là đơn vị tiện ích, không quy đổi thành tiền', 40, false, date '2026-10-01', $md$
## Xu là gì?

**Xu** là đơn vị tiện ích trong RaceHub. Xu **không quy đổi thành tiền mặt**, không chuyển cho người khác.

## Nhận Xu

- Chạy bộ: Xu tính theo tổng km trong ngày, có trần mỗi ngày.
- Điểm danh ngày có bài chạy hợp lệ, chuỗi tuần chạy đều.
- Nhiệm vụ, giới thiệu bạn bè (khi bạn mới chạy đủ km).
- Nạp Xu hoặc gói VIP.

## Dùng Xu

- Tạo thử thách (phí theo số người tối đa).
- Mua đồ cho nhân vật, tặng quà.

Số liệu hiện hành (trần ngày, phí…) xem ngay trong **Ví**. Quy định đầy đủ: [Quy định Xu, quà tặng & vật phẩm ảo](/help/quy-dinh-xu-qua).
$md$),

('qua-tang', 'GUIDE', 'Quà tặng & Điểm tỏa sáng', '🎁', 'Quà để cổ vũ và sưu tầm — không phải tiền', 50, false, date '2026-10-01', $md$
## Tặng quà

Bạn dùng Xu để tặng quà cổ vũ runner khác. **Xu của bạn được dùng hết** (không chuyển sang người nhận).

## Nhận quà

Người nhận có **quà trên tường quà** và **Điểm tỏa sáng** (tổng giá trị quà đã nhận).

- Quà **không phải tiền**, không đổi ra Xu hay tiền mặt.
- Quà **không tặng lại / bán lại** được.
- Điểm tỏa sáng dùng để hiển thị, mở một số vật phẩm trang trí.
$md$),

('thu-thach', 'GUIDE', 'Thử thách & Giải chạy ảo', '🎯', 'Chạy cùng nhau, cạnh tranh, hoàn thành', 60, false, date '2026-10-01', $md$
## Các loại

- **Thử thách cá nhân / nhóm bạn:** tự tạo, mời bạn bè.
- **Thử thách CLB:** ban quản trị CLB tạo cho thành viên.
- **Giải chạy ảo:** có BIB, chứng nhận, vinh danh.

## Tham gia

Mở thử thách → đọc **thể lệ** → **Tham gia**. Bài chạy hợp lệ trong thời gian thử thách tự được tính.

## Tạo thử thách

Phí tạo tính theo **số người tối đa** (nhóm nhỏ miễn phí). Gói VIP / CLB Pro có lượt tạo miễn phí.
$md$),

('clb', 'GUIDE', 'Câu lạc bộ', '👥', 'Chạy một mình, tiến bộ cùng cộng đồng', 70, false, date '2026-10-01', $md$
## Trong CLB có gì?

- Bảng tin & chat, lịch chạy nhóm có **điểm danh QR**.
- Thử thách CLB, bảng xếp hạng, CLB đấu CLB.
- Quỹ CLB minh bạch (RaceHub **không giữ tiền** — quỹ chỉ ghi sổ).

## Tham gia / tạo CLB

Vào tab **CLB** → tìm CLB → **Tham gia**, hoặc **Tạo CLB** của bạn.
$md$),

('nhan-vat', 'GUIDE', 'Nhân vật & Tủ đồ', '👤', 'Xây runner của riêng bạn', 80, false, date '2026-10-01', $md$
Bạn không chỉ chạy — bạn **xây runner của mình**.

- Chọn dáng nhân vật, phối màu áo, quần, tất, giày.
- Mở khoá đồ theo level, sự kiện, huy hiệu; mua đồ bằng Xu.
- Thiết kế đồng phục CLB (logo, chữ, số áo).

Đồ nhân vật chỉ để **trang trí**, không làm tăng thành tích.
$md$),

('vip-pro', 'GUIDE', 'VIP & CLB Pro', '👑', 'Gói trả phí cho runner và CLB', 90, false, date '2026-10-01', $md$
## VIP (cá nhân)

Phân tích bài chạy nâng cao, lượt tạo thử thách, quà / đồ trang trí riêng. VIP **không** tăng km, XP hay thứ hạng.

## CLB Pro

Không giới hạn quản trị viên, link mời riêng, báo cáo chuyên cần, lượt tạo thử thách CLB.

Thanh toán & hoàn tiền: xem [Thanh toán & hoàn tiền](/help/thanh-toan-hoan-tien).
$md$),

('hoi-dap', 'GUIDE', 'Câu hỏi thường gặp', '❓', 'Những thắc mắc phổ biến nhất', 100, false, date '2026-10-01', $md$
### Bài chạy của tôi chưa về?
Bài Strava thường về sau 1–5 phút. Ở Trang chủ bấm **Đồng bộ Strava** để lấy ngay. Vẫn chưa có → kiểm tra kết nối Strava trong trang Tôi.

### Vì sao bài bị "chờ duyệt"?
Hệ thống thấy dấu hiệu bất thường (tốc độ, GPS). Admin sẽ xem và duyệt; bạn không cần làm gì.

### Xu có đổi ra tiền được không?
Không. Xu chỉ dùng trong RaceHub.

### Tôi xoá tài khoản thế nào?
Menu ☰ → **Xoá tài khoản**, hoặc Cài đặt → Xoá tài khoản.

### Tôi cần hỗ trợ thêm?
Xem [Liên hệ hỗ trợ](/help/lien-he).
$md$),

('quy-tac-cong-dong', 'POLICY', 'Quy tắc cộng đồng', '🤝', 'Tôn trọng, trung thực, an toàn', 10, true, date '2026-10-01', $md$
RaceHub là cộng đồng chạy bộ. Khi dùng bảng tin, chat CLB, bình luận, ảnh, tên CLB / thử thách, bạn đồng ý:

## Không được

- Xúc phạm, quấy rối, phân biệt đối xử, đe doạ.
- Nội dung khiêu dâm, bạo lực, cờ bạc, chất cấm, đồ uống có cồn hướng tới trẻ vị thành niên.
- Thông tin sai sự thật, lừa đảo, mạo danh người / tổ chức khác.
- Quảng cáo, bán hàng trái phép; kêu gọi chuyển tiền ngoài app.
- Nội dung vi phạm pháp luật Việt Nam, vi phạm bản quyền.
- Đăng thông tin cá nhân của người khác khi chưa được đồng ý.

## Xử lý vi phạm

Người dùng bấm **Báo cáo** trên runner / tin Chợ BIB, hoặc báo qua [Báo cáo vi phạm & khiếu nại](/help/bao-cao-vi-pham). Chúng tôi xem xét và có thể: gỡ nội dung, cảnh cáo, tạm khoá hoặc khoá vĩnh viễn tài khoản. Yêu cầu gỡ bỏ của cơ quan nhà nước có thẩm quyền được xử lý theo thời hạn luật định.

Khiếu nại quyết định: [Báo cáo vi phạm & khiếu nại](/help/bao-cao-vi-pham).
$md$),

('quy-dinh-xu-qua', 'POLICY', 'Quy định Xu, quà tặng & vật phẩm ảo', '🪙', 'Xu, quà, vật phẩm chỉ dùng trong RaceHub', 20, true, date '2026-10-01', $md$
## 1. Xu

- Xu là **đơn vị tiện ích** chỉ dùng trong RaceHub; **không quy đổi** thành tiền, thẻ cào, thẻ quà tặng hay tài sản có giá trị ngoài RaceHub.
- Xu **không chuyển** giữa người dùng; không mua bán Xu giữa người dùng.
- Xu nhận miễn phí có thể có giới hạn theo ngày / tuần. Mọi biến động Xu được ghi sổ để đối soát.

## 2. Quà tặng

- Tặng quà dùng Xu của người tặng; người nhận **không nhận Xu**, chỉ nhận quà hiển thị và Điểm tỏa sáng.
- Quà **không tặng lại, bán lại** hay quy đổi.

## 3. Vật phẩm nhân vật

- Vật phẩm chỉ dùng trong RaceHub, **không mua bán giữa người dùng**.
- Vật phẩm ngừng bán: người đã sở hữu vẫn giữ, hoặc được hoàn Xu theo thông báo.

## 4. Không có

- Không quay thưởng / hộp quà ngẫu nhiên trả phí.
- Không thưởng bằng tiền hay hiện vật gắn với Xu.

## 5. Vi phạm

Tài khoản gian lận Xu (bài chạy giả, lợi dụng lỗi) có thể bị thu hồi Xu / vật phẩm và khoá tài khoản.
$md$),

('cong-bang-chong-gian-lan', 'POLICY', 'Công bằng & chống gian lận', '⚖️', 'Mọi km phải là km thật', 30, false, date '2026-10-01', $md$
## Nguyên tắc

Bảng xếp hạng, thử thách và phần thưởng chỉ có ý nghĩa khi mọi km là **km chạy / đi bộ thật**.

## Hệ thống tự kiểm tra

- Tốc độ và pace ngoài ngưỡng chạy bộ (đi xe, xe máy).
- GPS nhảy, mất tín hiệu dài rồi nối thẳng.
- Bài trùng thời gian, bài nhập tay bất thường.

Bài nghi ngờ **chờ admin duyệt**; bài bị từ chối không tính km / Xu / XP.

## Không được

- Nhờ người khác chạy hộ, dùng phương tiện, giả lập GPS.
- Tạo nhiều tài khoản để nhận thưởng.

Vi phạm có thể bị: huỷ kết quả, thu hồi Xu / huy hiệu, loại khỏi thử thách, khoá tài khoản.
$md$),

('quy-che-cho-bib-doi-tac', 'POLICY', 'Quy chế Chợ BIB & Đối tác', '🎫', 'RaceHub chỉ kết nối, không giữ tiền', 40, true, date '2026-10-01', $md$
> Bản nháp — cần luật sư rà (có thể phải đăng ký sàn thương mại điện tử với Bộ Công Thương).

## Vai trò của RaceHub

RaceHub là nơi **kết nối** runner với nhau (Chợ BIB) và với HLV / cửa hàng / dịch vụ đã xác minh (Đối tác). RaceHub **không bán hàng, không nhận hay giữ tiền** của các bên.

## Chợ BIB

- Chỉ đăng BIB được phép chuyển nhượng theo điều lệ của giải. Người đăng tự chịu trách nhiệm.
- Giao dịch, thanh toán do hai bên tự thoả thuận.

## Đối tác

- Đối tác được admin xác minh trước khi hiện.
- Thông tin sản phẩm / dịch vụ do đối tác cung cấp và chịu trách nhiệm.

## Tranh chấp

Báo cho chúng tôi tại [Báo cáo vi phạm & khiếu nại](/help/bao-cao-vi-pham). Chúng tôi hỗ trợ cung cấp thông tin, gỡ tin vi phạm, khoá tài khoản lừa đảo.

Chủ sở hữu: {{company_name}} · MST {{tax_code}} · {{address}}.
$md$),

('thanh-toan-hoan-tien', 'POLICY', 'Thanh toán & hoàn tiền', '💳', 'Nạp Xu, VIP, CLB Pro', 50, true, date '2026-10-01', $md$
> Bản nháp — admin / luật sư bổ sung.

## Thanh toán

- Thanh toán bằng chuyển khoản VietQR tới tài khoản của {{company_name}}. RaceHub không lưu thông tin thẻ / tài khoản ngân hàng của bạn.
- Đơn được kích hoạt sau khi xác nhận nhận tiền.
- Gói **không tự gia hạn**.

## Hoàn tiền

- Chuyển khoản nhưng đơn chưa được kích hoạt: liên hệ hỗ trợ để kiểm tra và hoàn tiền.
- Gói đã kích hoạt / Xu đã dùng: không hoàn, trừ khi lỗi từ phía RaceHub hoặc theo quy định pháp luật.

Liên hệ: {{support_email}} · {{support_phone}}.
$md$),

('suc-khoe-an-toan', 'POLICY', 'Sức khoẻ & an toàn khi chạy', '❤️', 'Chạy vừa sức, an toàn trên đường', 60, false, date '2026-10-01', $md$
- RaceHub **không phải** thiết bị hay lời khuyên y tế. Hỏi bác sĩ trước khi bắt đầu tập nếu bạn có bệnh tim mạch, huyết áp, đang mang thai hoặc đang điều trị.
- Dừng ngay khi đau ngực, choáng, khó thở.
- Thử thách **không bắt buộc** chạy quá sức; hãy tăng km từ từ.
- Chạy nơi an toàn, chú ý giao thông; buổi tối mặc đồ phản quang.
- Không nhìn điện thoại khi chạy trên đường.
$md$),

('lien-he', 'SUPPORT', 'Liên hệ hỗ trợ', '💬', 'Báo lỗi, hỏi đáp, góp ý', 10, false, null, $md$
- Email: {{support_email}}
- Điện thoại: {{support_phone}}

Khi báo lỗi, hãy gửi kèm: ảnh chụp màn hình, thời gian xảy ra, tên thiết bị. Không gửi mật khẩu hay mã OTP cho bất kỳ ai — RaceHub không bao giờ hỏi.

{{company_name}} · MST {{tax_code}} · {{address}}
$md$),

('bao-cao-vi-pham', 'SUPPORT', 'Báo cáo vi phạm & khiếu nại', '🚩', 'Nội dung xấu, lừa đảo, khiếu nại quyết định', 20, false, null, $md$
## Báo cáo trong app

Bấm **Báo cáo** trên hồ sơ runner (Quanh đây) hoặc tin Chợ BIB. Người bị báo cáo không biết ai báo cáo.

Bài viết / tin nhắn trong CLB: báo ban quản trị CLB (họ có quyền gỡ), hoặc gửi cho chúng tôi theo cách dưới đây.

## Báo cáo qua email

Gửi tới {{report_email}} (hoặc {{support_email}}): đường link / ảnh chụp nội dung, lý do, thời gian.

## Khiếu nại quyết định

Nếu nội dung / tài khoản của bạn bị gỡ hoặc khoá mà bạn cho là nhầm, gửi khiếu nại kèm tên tài khoản. Chúng tôi phản hồi trong thời gian sớm nhất.
$md$),

('du-lieu-cua-toi', 'SUPPORT', 'Dữ liệu của tôi', '🔐', 'Đồng ý, tải về, xoá dữ liệu', 30, false, null, $md$
Theo Luật Bảo vệ dữ liệu cá nhân, bạn có quyền biết, đồng ý, rút lại đồng ý, xem, sửa, yêu cầu xoá dữ liệu của mình.

## Tự làm trong app

- **Chia sẻ bài Strava** cho CLB / BXH: Cài đặt → Quyền riêng tư (bật / tắt bất cứ lúc nào).
- **Quanh đây** (vị trí gần đúng): tắt trong màn Quanh đây → dữ liệu vị trí bị xoá ngay.
- **Thông báo đẩy:** Cài đặt → Thông báo.
- **Ngắt Strava:** trang Tôi → Strava.
- **Xoá tài khoản:** menu ☰ → Xoá tài khoản.

Từ chối các đồng ý tuỳ chọn **không** ảnh hưởng việc dùng các tính năng còn lại.

## Yêu cầu khác (tải về dữ liệu, sửa, khiếu nại)

Liên hệ người phụ trách dữ liệu cá nhân: {{dpo_contact}} (hoặc {{support_email}}).

Chi tiết: [Chính sách quyền riêng tư](/privacy).
$md$)
on conflict (slug) do nothing;

notify pgrst, 'reload schema';
