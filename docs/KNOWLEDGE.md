# RaceHub Knowledge — Trung tâm kiến thức & tin tức chạy bộ

> Migration `20261001006200_knowledge.sql` · code `features/knowledge` · route `/learn`, `/learn/[slug]`, `/learn/studio`

Mục tiêu: cho runner **lý do mở app cả những ngày không chạy**, rồi dẫn họ từ bài đọc sang hành động trong app (đặt mục tiêu, thử thách, CLB, Chợ Runner…).

## 1. Hai loại nội dung

| | 📚 Kiến thức (`ARTICLE`) | 📰 Tin tức (`NEWS`) |
|---|---|---|
| Mục đích | Runner **học** được điều gì đó | Runner **biết** điều gì đang diễn ra |
| Tuổi thọ | Lâu dài, cập nhật định kỳ | Ngắn, theo thời điểm |
| Ví dụ | Chọn giày, giáo án 10K, gel & nước | Giải chạy mở đăng ký, tính năng mới, hoạt động CLB |

## 2. 8 chuyên mục (`content_categories`)

| Mã | Tên | Duyệt chuyên môn | Nối với Chợ Runner |
|---|---|---|---|
| BEGINNER | Bắt đầu chạy bộ | tuỳ bài | — |
| TRAINING | Giáo án & luyện tập | **bắt buộc** | HLV |
| NUTRITION | Dinh dưỡng & phục hồi | **bắt buộc** | Dịch vụ |
| INJURY | Phòng tránh chấn thương | **bắt buộc** | Dịch vụ |
| GEAR | Thiết bị & trang phục | — | Cửa hàng |
| RACES | Giải chạy & sự kiện | — | — |
| STORIES | Câu chuyện Runner | — | — |
| APP | Hướng dẫn RaceHub | — | — |

## 3. Giao diện người đọc

- **Trang chủ** (không thêm tab mới): thẻ *RaceHub Knowledge*. Thẻ gồm:
  - Lối vào 4 chuyên mục: Dành cho người mới, Giáo án, Dinh dưỡng, Thiết bị.
  - Tiến độ chuỗi *Bắt đầu chạy bộ*.
  - *Đọc tiếp* (bài đang đọc dở).
  - Bài viết nổi bật và tin mới.
- **`/learn`**:
  - Ba tab: Kiến thức, Tin tức, Đã lưu.
  - Lọc theo chuyên mục; tìm không cần gõ dấu, theo tiêu đề, tóm tắt và tag.
  - Bộ lọc được giữ trên URL, nên chia sẻ link vẫn mở đúng chỗ.
- **`/learn/[slug]`**:
  - Đầu bài: tiêu đề, ảnh bìa, tác giả (có dấu xác minh), ngày đăng / cập nhật, thời gian đọc.
  - **Mục lục** hiện khi bài có từ 3 tiêu đề trở lên.
  - Nội dung có thể chứa ảnh, video YouTube (qua youtube-nocookie) và bảng.
  - Cuối bài: nguồn tham khảo, tag, chuỗi bài.
  - Lưu bài, chia sẻ, thanh tiến độ đọc, **đánh dấu đã đọc tự động**.
  - Nút "Hữu ích?" kèm góp ý.
  - Hộp tác giả, có link sang hồ sơ HLV trong Chợ Runner.
  - Bài liên quan (cùng tag / chuyên mục).
  - **Tiếp tục hành trình của bạn**: tối đa 3 nút hành động (bảng dưới).
  - Bài sức khoẻ đã duyệt hiện "đã được … duyệt chuyên môn" và câu nhắc: nội dung chỉ để tham khảo, không thay cho chẩn đoán cá nhân.

### Hành động cuối bài (CTA)

| Loại | Mở ra |
|---|---|
| GOAL | Trang chủ → sheet mục tiêu tuần (`/feed?goal=1`) |
| CHALLENGES / CHALLENGE | Danh sách / một thử thách |
| RACES / RACE | Giải chạy ảo |
| MARKET (COACH/SHOP/SERVICE) / PARTNER | Chợ Runner đúng nhóm / hồ sơ HLV, cửa hàng |
| CLUBS / CLUB | Tìm / mở CLB |
| NEARBY | Quanh đây |
| CHARACTER | Tủ đồ nhân vật |
| ONBOARDING | Tiếp tục hướng dẫn người mới |
| WALLET | Ví Xu |
| ARTICLE / LINK | Bài khác / đường dẫn nội bộ (không cho link ra ngoài) |

Bài nào không đặt CTA sẽ dùng gợi ý mặc định theo chuyên mục. Mỗi lượt bấm được đếm để tính **tỉ lệ chuyển sang tính năng**.

## 4. CMS (Quản trị → Cộng đồng → **Nội dung**, hoặc `/learn/studio`)

- Trình soạn bài:
  - Soạn bằng Markdown có thanh công cụ và **xem trước**. Không nhận HTML thô, link nguy hiểm bị bỏ.
  - Ảnh bìa và ảnh trong bài được tải lên kho `content-media`.
  - Có tag, nguồn tham khảo, CTA, tác giả, chuỗi bài, đánh dấu bài nổi bật.
  - Tin tức có thêm link và tên trang bài gốc.
- Vòng đời bài: **DRAFT → REVIEW → SCHEDULED → PUBLISHED → ARCHIVED**.
  - Hẹn giờ: bài tự hiện khi tới giờ đăng, không cần cron.
  - Bài đã từng đăng chỉ **lưu trữ** được, không xoá (giữ link và thống kê).
- **Duyệt chuyên môn**:
  - Bắt buộc với TRAINING, NUTRITION, INJURY; có thể bật thêm cho từng bài.
  - Chưa duyệt thì không đăng được.
  - Người sửa không phải chuyên gia mà đổi nội dung → mất duyệt; bài đang đăng tự gỡ về *Chờ duyệt*.
  - Chuyên gia không tự duyệt bài của mình.
- Vai trò (`content_staff`, chỉ admin gán):

  | Vai trò | Quyền |
  |---|---|
  | Admin | Toàn quyền |
  | EDITOR | Duyệt, đăng, hẹn giờ, lưu trữ, quản lý tác giả |
  | WRITER | Viết nháp, gửi duyệt bài của mình |
  | EXPERT | Duyệt chuyên môn, góp ý trả về, viết bài |

  Người viết nhận thông báo khi bài được đăng hoặc bị trả về. Mọi thao tác đổi trạng thái được ghi vào nhật ký quản trị.
- **Tác giả** (`content_authors`):
  - Loại: đội ngũ, biên tập viên, HLV, chuyên gia, runner cộng đồng.
  - Có dấu xác minh; có thể gắn hồ sơ Chợ Runner.
- **Thống kê** (7 / 30 / 90 ngày):
  - Lượt xem, đọc xong, số người đọc, thời gian đọc trung bình, lưu, chia sẻ, bấm hành động.
  - Biểu đồ theo ngày.
  - Top bài kèm tỉ lệ đọc xong và tỉ lệ chuyển sang tính năng.
  - Đọc được góp ý của người đọc ngay trong bài.
- Ô "Việc cần xử lý" của admin có đếm **bài chờ duyệt**.

## 5. Game hoá — vừa phải, không farm được

- **Không cộng Xu / XP khi đọc** (XP chỉ đến từ km chạy hợp lệ).
- *Đọc xong* = cuộn ≥ 90 % **và** thời gian đọc thật ≥ min(60 giây, 30 % thời gian ước tính). Lướt nhanh không tính.
- Lượt xem, chia sẻ, bấm hành động: mỗi người đếm tối đa 1 lần mỗi ngày cho mỗi bài.
- Đọc hết chuỗi **Bắt đầu chạy bộ** → huy hiệu **Runner ham học** (`LEARN_STARTER`, 0 XP / 0 Xu) kèm thông báo.

## 6. Nguồn bài & pháp lý

- Ba nguồn bài: tự sản xuất; bài cộng tác (HLV, chuyên gia, cửa hàng — qua biên tập duyệt); tin tổng hợp từ bên ngoài.
- Tin tổng hợp phải **viết lại bằng lời RaceHub**, dẫn link bài gốc và ghi tên nguồn. Không sao chép nguyên văn hay dùng ảnh khi chưa có quyền.
- Bài sức khoẻ phải ghi nguồn, có ngày cập nhật, và tránh lời khuyên kiểu chẩn đoán cá nhân.

## 7. Bài mẫu có sẵn

- 4 bài **Hướng dẫn RaceHub** đã đăng:
  - XP, Xu và cấp độ.
  - Tham gia thử thách đầu tiên.
  - Nhân vật và tủ đồ.
  - Tin: Quanh đây.
- Chuỗi **Bắt đầu chạy bộ**, 4 bài để ở trạng thái **Chờ duyệt**:
  - Lộ trình 0 → 5 km.
  - Chọn giày chạy bộ đầu tiên.
  - Easy / Tempo / Interval.
  - Nước và gel.

  Các bài này có nội dung về tập luyện / dinh dưỡng, nên **cần chuyên gia đọc lại, chỉnh và duyệt** trước khi đăng. Chuỗi chỉ hiện trên Trang chủ khi đã có bài được đăng.

## 8. Dữ liệu (Supabase)

`content_categories`, `content_articles`, `content_authors`, `content_staff`, `content_series`, `content_tags`, `content_article_tags`, `content_sources`, `content_bookmarks`, `content_read_history`, `content_reviews`, `content_daily_stats`, `content_user_events`.

- Mọi bảng bật RLS và thu hồi quyền trực tiếp; mọi truy cập đi qua RPC `knowledge_*` (người đọc) và `cms_*` (ban nội dung).
- Người đọc chỉ thấy bài đã đăng và đã tới giờ đăng. Ban nội dung xem trước được bài chưa đăng.

## 9. Để sau (V2)

- Người dùng gửi bài từ app (qua hàng duyệt).
- Bình luận dưới bài.
- Gợi ý bài theo mục tiêu và pace của từng người.
- Gợi ý giáo án gắn với kế hoạch tập.
- Bản tin email hằng tuần.
- Trang công khai cho SEO (hiện chỉ người đã đăng nhập mới đọc được).
