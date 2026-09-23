# Thiết kế API

## 1. Bốn loại "API" trong RaceHub

| Loại | Công nghệ | Dùng cho | Ví dụ |
|---|---|---|---|
| **Query** (đọc) | `supabase.from(view/table).select()`, RLS bảo vệ | Danh sách, chi tiết, BXH | `challenge_list_v`, `feed_items` |
| **Command** (ghi có nghiệp vụ) | Postgres RPC `supabase.rpc('…')` | Mọi thao tác thay đổi tài sản hoặc trạng thái | `join_challenge`, `send_cheer` |
| **Integration** (REST) | Next.js Route Handler `/api/*` | OAuth, webhook, thanh toán, xuất file, cron trigger | `POST /api/webhooks/strava` |
| **Realtime** | Supabase Realtime | BXH live, cheer, bàn giao tiếp sức, chat | `challenge:{id}`, `live:{session}` |

Vì sao command dùng RPC mà không dùng REST của Next.js: logic nằm cạnh dữ liệu, chạy trong **một transaction**, được RLS và `auth.uid()` bảo vệ, không tốn thêm một lượt mạng qua server Node. REST chỉ dùng khi cần secret, gọi dịch vụ ngoài, hoặc trả file (ADR-003).

## 2. Quy ước chung

**Đặt tên.** RPC: `động_từ_danh_từ` (`create_challenge`, `list_feed`). View đọc: `<tên>_v`. Tham số: tiền tố `p_`.

**Xác thực.** Mọi RPC lấy người gọi từ `auth.uid()`. **Không có tham số `p_user_id`** cho hành động của chính mình. Hàm admin kiểm tra `is_system_admin()` hoặc `has_club_permission(club, code)`.

**Idempotency.** Mọi command làm thay đổi Xu đều nhận `p_idempotency_key text`. Client sinh `crypto.randomUUID()` **khi mở form** (không phải khi bấm nút), nên người dùng bấm hai lần hoặc mạng gửi lại thì server cũng chỉ ghi một lần.

**Phân trang.** Dùng keyset, không dùng offset: `p_before timestamptz, p_limit int` (tối đa 50). Kết quả trả về `next_cursor`.

**Định dạng trả về.** RPC trả `jsonb` có kiểu rõ ràng. Type TypeScript được sinh bằng `supabase gen types typescript --linked > shared/types/database.ts`. Không viết type tay.

**Lỗi.** `raise exception 'MÃ_LỖI'` (tiếng Anh, UPPER_SNAKE). Client ánh xạ mã sang thông báo tiếng Việt trong một từ điển duy nhất (`shared/lib/errors.ts`). Xem §5.

**Phiên bản.** Khi đổi chữ ký một RPC không tương thích ngược, tạo `tên_v2` và giữ bản cũ ít nhất 1 phiên bản app. Điều này quan trọng khi có app native, vì người dùng không cập nhật ngay.

## 3. Danh mục API theo module

Ký hiệu: **Q** = query/view, **C** = command RPC, **R** = REST route, 🔒 = cần đăng nhập, 🛡 = cần quyền admin/CLB, 💰 = có idempotency key.

### 3.1 Identity & Onboarding (MH 1–4, 24, 28)

| API | Loại | Input | Output / Ghi chú |
|---|---|---|---|
| `supabase.auth.signInWithOtp / signInWithOAuth` | Auth | email/phone, provider google/apple/facebook | FR1–FR2. Profile + ví tự tạo bằng trigger |
| `me_v` | Q 🔒 | – | profile + `balance` + `level_name` + `next_level_xp` + `stats` + `connections` |
| `update_profile` | C 🔒 | `display_name, handle, avatar_url, gender, birth_date, province_code, bio, goal_km_month, goal_days_week` | Chỉ các cột an toàn |
| `complete_onboarding_step` | C 🔒 | `p_step` | NFR1: theo dõi funnel 3 bước |
| `update_settings` | C 🔒 | `privacy, units, language, notif_prefs` | MH 28 |
| `register_push_token` | C 🔒 | `token, platform` | FCM/APNs |
| `GET /api/connect/strava` | R 🔒 | – | Tạo nonce trong `oauth_states` rồi redirect sang Strava |
| `GET /api/connect/strava/callback` | R | `code, state` | Kiểm tra nonce **và** phiên hiện tại khớp `user_id` → lưu `provider_connections` → backfill 30 ngày |
| `disconnect_provider` | C 🔒 | `p_provider` | Thu hồi token (gọi Strava deauthorize ở server) |
| `get_athlete_profile` | Q | `p_user_id` hoặc `p_handle` | MH 24 / hồ sơ người khác, tôn trọng quyền riêng tư |
| `search` | Q 🔒 | `p_query, p_types[] (runner/club/challenge/hashtag)` | MH 8, dùng `pg_trgm` |

### 3.2 Activity & Verification (MH 15–18, 27)

| API | Loại | Input | Output / Ghi chú |
|---|---|---|---|
| `POST /api/webhooks/strava` | R | Strava event | Xác thực `subscription_id` → ghi `activity_ingest_jobs` → 200 trong < 2 giây |
| `GET /api/webhooks/strava` | R | `hub.challenge, hub.verify_token` | Xác nhận đăng ký webhook |
| `submit_activity` | C 🔒 💰 | `p_client_id uuid, p_started_at, p_elapsed_s, p_moving_s, p_distance_m, p_points jsonb (≤ 20k điểm), p_device` | Dành cho GPS trong app. Server **tự tính lại** quãng đường/pace từ `p_points`, không tin số client gửi. Trả `{activity_id, status, verify_flags}` |
| `activity_result_v` | Q 🔒 | `activity_id` | MH 16–17: trạng thái xác thực, XP/Xu nhận, hạng thay đổi trong từng thử thách |
| `list_activities` | Q | `p_user_id, p_before, p_limit` | MH 27 Training Log |
| `get_activity_route` | Q | `p_activity_id` | Polyline đã **cắt 200 m đầu/cuối** theo quyền riêng tư |
| `report_activity` | C 🔒 | `p_activity_id, p_reason, p_note` | FR18 |
| `review_activity` | C 🛡 | `p_activity_id, p_decision, p_note` | Admin hệ thống hoặc admin CLB (với thử thách CLB). Ghi `activity_reviews` và kích hoạt chấm lại |
| `appeal_activity` | C 🔒 | `p_activity_id, p_explanation, p_attachment_url` | Nút "Gửi giải trình" ở MH 16 |
| `get_personal_analytics` | Q 🔒 | `p_range (4w/12w/1y)` | FR44: km theo tuần, xu hướng pace, so với cùng kỳ |

### 3.3 Challenge (MH 10–14)

| API | Loại | Input | Output / Ghi chú |
|---|---|---|---|
| `list_challenges` | Q | `p_tab (suggested/duel/group/event/club/mine), p_filters {distance, pace, reward, fee}, p_cursor` | FR9–FR10. Thử thách `SECRET` chỉ trả về tiêu đề + `is_locked` |
| `get_challenge` | Q | `p_id, p_pin?` | MH 11. `SECRET` mà chưa mở khóa thì trả `{is_locked:true}`, không có `rules/description` |
| `get_challenge_leaderboard` | Q | `p_id, p_team_id?, p_around_me bool` | MH 12. Người đang `pending_review` được đánh dấu để hiển thị xám |
| `quote_challenge` | Q 🔒 | payload giống create | Tính trước phí tạo (theo fee tier), phí sàn, số thực nhận, số dư còn lại. Bước 4 wizard / MH 14 |
| `create_challenge` | C 🔒 💰 | `p_title, p_description, p_cover_url, p_format, p_objective, p_rules jsonb, p_scope, p_club_id?, p_funding, p_stake_xu, p_sponsor_pool_xu, p_prize_split, p_start_at, p_end_at, p_join_deadline, p_min_level, p_max_participants, p_pin?, p_teams? [{name, captain_id}], p_invitees?[]` | Validate rules theo format/objective. Trạng thái `DRAFT` |
| `publish_challenge` | C 🔒 💰 | `p_id` | Tạo tài khoản escrow, **khóa cọc / tài trợ của chủ kèo**, thu phí tạo. Trạng thái `OPEN` (hoặc `PENDING_REVIEW` nếu cần admin duyệt, FR38) |
| `join_challenge` | C 🔒 💰 | `p_id, p_team_id?, p_pin?` | Kiểm tra level, số dư, slot, PIN, thành viên CLB → khóa cọc |
| `respond_invite` | C 🔒 💰 | `p_id, p_accept bool` | Lời mời 1-1 / nhóm riêng tư |
| `set_ready` | C 🔒 | `p_id` | DUEL "Ready Room". Khi cả hai sẵn sàng thì `LIVE` |
| `withdraw_challenge` | C 🔒 💰 | `p_id` | Chỉ trước khi `LIVE`. Hoàn cọc |
| `cancel_challenge` | C 🔒 🛡 💰 | `p_id, p_reason` | Chủ kèo (trước khi có người join) hoặc admin. Hoàn toàn bộ |
| `assign_team` / `set_relay_order` | C 🔒 🛡 | `p_id, p_user_id, p_team_id` / `p_team_id, p_order uuid[]` | Đội trưởng (luật "Chỉ định đội trưởng") |
| `start_relay_leg` / `finish_relay_leg` / `emergency_handover` | C 🔒 | `p_leg_id` | Server kiểm tra `unlocked_at`, chặng trước đã xong, khoảng cách giữa điểm kết thúc và điểm bắt đầu ≤ 1 km |
| `settle_challenge` | C (nội bộ) | `p_id` | Chỉ cron/admin gọi. Idempotent |

### 3.4 Economy, Shop, Avatar (MH 19, 25, 26)

| API | Loại | Input | Output / Ghi chú |
|---|---|---|---|
| `my_wallet` | Q 🔒 | – | Số dư |
| `list_wallet_entries` | Q 🔒 | `p_cursor, p_type?` | MH 25: lịch sử giao dịch có mô tả dễ đọc |
| `list_missions` | Q 🔒 | – | Nhiệm vụ ngày/tuần + tiến độ |
| `claim_mission` | C 🔒 💰 | `p_mission_id` | Hoặc tự nhận nếu có cấu hình `auto_claim` |
| `daily_checkin` | C 🔒 | – | +2 Xu, idempotent theo ngày (giờ VN) |
| `list_shop_items` | Q | `p_category, p_rarity, p_cursor` | FR23–24: có cờ `owned`, `locked_by_level` |
| `purchase_item` | C 🔒 💰 | `p_item_id, p_quantity` | FR25: kiểm tra số dư → trừ Xu → thêm vào tủ đồ, trong **một transaction** |
| `get_inventory` | Q 🔒 | – | MH 26: đồ sở hữu + slot đang mặc + `usable` (bị khóa khi hạ cấp) |
| `update_avatar_profile` | C 🔒 | `gender, skin_tone, hair_style, hair_color, body_type` | FR26 |
| `equip_item` / `unequip_slot` | C 🔒 | `p_user_item_id` / `p_slot` | Kiểm tra sở hữu + level |
| `use_functional_item` | C 🔒 | `p_user_item_id` | Bùa XP: ghi `active_effects` có hạn dùng |
| `POST /api/payments/create` | R 🔒 | `purpose, amount_vnd` | GĐ 4: tạo `payments`, trả URL cổng thanh toán |
| `POST /api/webhooks/payments/{provider}` | R | IPN | Kiểm tra chữ ký → `payments.status=PAID` → ledger `TOPUP` (idempotent theo `provider_ref`) |

### 3.5 Social: Feed, Cheer, Notification, Chat (MH 5–9)

| API | Loại | Input | Output / Ghi chú |
|---|---|---|---|
| `list_feed` | Q 🔒 | `p_tab (for_you/friends/club), p_club_id?, p_cursor` | FR28–29: xếp hạng theo độ liên quan (ADR-008). Mỗi item kèm `viewer_liked`, `viewer_cheered` |
| `list_live_now` | Q 🔒 | – | Dải Story: bạn bè / CLB đang `LIVE` |
| `create_post` | C 🔒 | `p_body, p_media[], p_activity_id?, p_visibility` | Bài đăng thủ công |
| `toggle_like` | C 🔒 | `p_feed_item_id` | |
| `add_comment` / `delete_comment` | C 🔒 | `p_feed_item_id, p_body` | +1 Xu nhiệm vụ "tương tác" (giới hạn/ngày) |
| `send_cheer` | C 🔒 💰 | `p_receiver_id, p_item_id, p_feed_item_id? \| p_live_session_id?, p_message` | FR32–33: trừ Xu người gửi, cộng XP cho cả hai, broadcast hiệu ứng |
| `list_cheers` | Q | `p_activity_id \| p_feed_item_id` | MH 6: danh sách người đã tặng quà |
| `request_friend` / `respond_friend` / `remove_friend` | C 🔒 | `p_user_id` / `p_accept` | FR30. +50 XP khi kết bạn (có giới hạn chống farm) |
| `suggest_friends` | Q 🔒 | `p_source (contacts_hash[]/nearby/mutual)` | Danh bạ gửi dạng **hash** số điện thoại, không gửi số thô |
| `list_notifications` / `mark_notifications_read` | Q/C 🔒 | `p_category, p_cursor` / `p_ids[] \| all` | MH 7 |
| `start_live_session` / `end_live_session` | C 🔒 | `p_challenge_id?, p_visibility, p_share_location` | Bật chế độ "Đang hoạt động" |
| `append_live_points` | C 🔒 | `p_session_id, p_points[]` | Mỗi 60 giây, để hậu kiểm |
| `list_conversations` / `list_messages` / `send_message` | Q/C 🔒 | … | MH 9. Chat thử thách tự tạo khi `LIVE` |

### 3.6 Club (MH 21–22)

Giữ các RPC đã có trong `features/club/api.ts` (`create_club`, `join_club`, `join_club_by_code`, `set_member_status`, `set_member_role`, `remove_member`, `transfer_ownership`, `contribute_treasury`, `update_club`, `update_club_policy`, `rotate_invite_code`, `delete_club`, `leave_club`) và bổ sung:

| API | Loại | Input | Output / Ghi chú |
|---|---|---|---|
| `create_club` (sửa) | C 🔒 💰 | + `p_type, p_avatar_url` | Kiểm tra Level ≥ 3, khóa **500 Xu ký quỹ** vào `CLUB:DEPOSIT` |
| `get_club_leaderboard` | Q | `p_club_id, p_type (distance/activities/xp/cheers_received), p_period (week/month/all)` | Tương đương `GET /api/clubs/:id/leaderboard?type=` trong tài liệu |
| `list_club_treasury` | Q 🔒 | `p_club_id, p_cursor` | MH 21: lịch sử quỹ (từ ledger) |
| `withdraw_treasury` | C 🛡 💰 | `p_club_id, p_amount, p_purpose, p_challenge_id?` | Chỉ OWNER/VICE_OWNER. Ghi audit |
| `get_club_health` | Q 🛡 | `p_club_id` | Điểm hoạt động, hạng CLB, cảnh báo giải thể |
| `report_club` | C 🔒 | `p_club_id, p_reason` | |
| `has_permission` (sửa) | Q 🔒 | `p_club_id, p_permission_code` | **Bỏ `p_user_id`**, dùng `auth.uid()` |

### 3.7 Leaderboard (MH 9)

| API | Loại | Input | Output / Ghi chú |
|---|---|---|---|
| `get_leaderboard` | Q | `p_scope (global/friends/region/club), p_metric (distance/xp/xu), p_period (week/month/all), p_region?, p_club_id?` | Top 100 + vị trí của viewer (`around_me`) |
| `get_leaderboard_history` | Q | `p_board_key, p_period_start` | Snapshot các kỳ trước |

### 3.8 Admin & Organizer (Web Dashboard, M5)

| API | Loại | Ghi chú |
|---|---|---|
| `admin_overview_v` | Q 🛡 | FR40: DAU/WAU, số thử thách đang chạy, Xu phát hành/tiêu hủy, doanh thu |
| `admin_list_users` / `admin_set_ban` / `admin_adjust_trust` | Q/C 🛡 | FR37 |
| `admin_review_queue` | Q 🛡 | Bài chạy `UNDER_REVIEW` + report + thử thách `PENDING_REVIEW` (FR38) |
| `admin_publish_config` | C 🛡 | FR39: tạo phiên bản `config_versions` mới rồi publish. Có audit |
| `admin_upsert_item` | C 🛡 | Quản lý Shop |
| `admin_adjust_balance` | C 🛡 💰 | Transaction `ADMIN_ADJUST`, bắt buộc có lý do |
| `GET /api/organizer/events/{id}/export.csv` | R 🛡 | FR35: xuất danh sách/kết quả |
| `POST /api/organizer/events/{id}/broadcast` | R 🛡 | FR36: push cho người tham gia (qua hàng đợi) |

## 4. Ví dụ hợp đồng: `create_challenge` cho Đối kháng 1-1

Request (client):

```ts
await supabase.rpc('create_challenge', {
  p_idempotency_key: formKey,           // sinh khi mở wizard
  p_title: 'Ai nhanh hơn?',
  p_format: 'DUEL',
  p_objective: 'AVG_PACE',
  p_rules: { window_minutes: 60, accept_within_h: 2, min_distance_m: 5000, pace_range_s: [180, 900] },
  p_scope: 'INVITE',
  p_invitees: ['<uuid Minh_Pro>'],
  p_funding: 'ENTRY_STAKE',
  p_stake_xu: 500,
  p_prize_split: 'WINNER_TAKES_ALL',
  p_start_at: '2026-10-01T22:00:00Z',
  p_end_at:   '2026-10-02T22:00:00Z',
  p_extra_rewards_text: 'Bên thua mời cafe',
})
```

Response:

```json
{ "challenge_id": "…", "status": "DRAFT",
  "quote": { "stake_xu": 500, "creation_fee_xu": 20, "platform_fee_bps": 500,
             "payout_if_win_xu": 950, "balance_after_xu": 480 } }
```

Zod schema phía client (`features/challenge/model/rules.ts`) cho cặp này:

```ts
export const duelAvgPaceRules = z.object({
  window_minutes: z.number().int().min(10).max(24 * 60),
  accept_within_h: z.number().int().min(1).max(72),
  min_distance_m: z.number().int().min(1000),
  pace_range_s: z.tuple([z.number().int().min(150), z.number().int().max(1200)])
    .refine(([a, b]) => a < b, 'Pace tối thiểu phải nhỏ hơn pace tối đa'),
})
```

## 5. Mã lỗi

| Mã | Thông báo hiển thị |
|---|---|
| `AUTH_REQUIRED` | Bạn cần đăng nhập để tiếp tục. |
| `FORBIDDEN` | Bạn không có quyền thực hiện thao tác này. |
| `INSUFFICIENT_BALANCE` | Số dư Xu không đủ. → hiện nút **Nạp thêm Xu** (MH 14) |
| `LEDGER_UNBALANCED`, `LEDGER_IMMUTABLE` | (Lỗi hệ thống, báo Sentry) |
| `CHALLENGE_NOT_FOUND` / `CHALLENGE_NOT_OPEN` / `JOIN_DEADLINE_PASSED` | Thử thách không tồn tại / đã đóng đăng ký. |
| `CHALLENGE_FULL` / `TEAM_FULL` | Thử thách / đội đã đủ người. |
| `ALREADY_JOINED` | Bạn đã tham gia thử thách này. |
| `INVALID_PIN` | Mã PIN không đúng. |
| `LEVEL_TOO_LOW` | Cần đạt cấp {n} để tham gia. |
| `CLUB_MEMBERS_ONLY` | Thử thách chỉ dành cho thành viên CLB. |
| `INVALID_RULES:<field>` | Thiết lập không hợp lệ: {field}. |
| `RELAY_LEG_LOCKED` | Chưa đến lượt bạn. Chờ đồng đội bàn giao. |
| `ITEM_NOT_OWNED` / `ITEM_LEVEL_LOCKED` | Bạn chưa sở hữu vật phẩm / cần đạt cấp {n}. |
| `CLUB_CREATE_LEVEL` | Cần đạt Level 3 để tạo CLB. |
| `RATE_LIMITED` | Bạn thao tác quá nhanh, thử lại sau ít phút. |
| `ACTIVITY_DUPLICATE` | Bài chạy này đã được ghi nhận. |

## 6. Realtime channels

| Channel | Kiểu | Payload | Người nghe |
|---|---|---|---|
| `challenge:{id}` | `postgres_changes` trên `challenge_participants` (filter `challenge_id`) | hàng đã cập nhật | MH 12, BXH mini ở MH 15 |
| `live:{session_id}` | Broadcast (không ghi DB) | `{lat,lng,dist_m,pace_s,t}` mỗi 5–10 giây; `{type:'cheer', from, item}` | Bạn bè đang xem, runner |
| `live:{session_id}` | Presence | danh sách người đang xem | Runner ("12 người đang cổ vũ") |
| `relay:{team_id}` | Broadcast | `{type:'HANDOVER', to_leg}` | Thành viên đội |
| `hunt:{challenge_id}` | Broadcast | vị trí/tiến độ con mồi, cảnh báo bị vượt | Thợ săn + con mồi |
| `user:{uid}` | Broadcast (private channel) | thông báo mới, số dư thay đổi | Chính user (badge chuông, số Xu trên header) |
| `conversation:{id}` | `postgres_changes` trên `messages` | tin nhắn mới | Thành viên |

Mọi channel riêng tư dùng **Realtime Authorization** (RLS trên `realtime.messages`) để chỉ người có quyền mới subscribe được.
