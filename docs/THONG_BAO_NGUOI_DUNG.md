# Toàn bộ câu chữ gửi đến người dùng

Tạo tự động bằng `python3 scripts/list-messages.py` — **không sửa tay**. Muốn đổi câu nào: gửi số mục (vd **A12**) hoặc chép câu cũ → câu mới.

`{…}` là phần tự điền (tên người, số km, số Xu…). Một số câu ghép theo điều kiện nên hiện dạng `{case when …}`.

Tổng: 113 thông báo · 7 lời báo bài chạy · 10 câu giọng HLV · 559 câu báo lỗi · 234 thông báo nhanh (toast).

## A. Thông báo (chuông + thông báo đẩy)

| # | Loại | Tiêu đề | Nội dung | Phát sinh ở |
|---|---|---|---|---|
| A1 | ADMIN_PASS | Bạn nhận {p_quantity} vé tạo thử thách miễn phí | Mỗi vé dùng cho thử thách tối đa {p_max_slots} người | `admin_grant_challenge_pass` |
| A2 | ADMIN_PASS | {v_name} nhận {p_quantity} vé tạo thử thách miễn phí | Mỗi vé dùng cho thử thách tối đa {p_max_slots} người | `admin_grant_challenge_pass` |
| A3 | ADMIN_XU | Hoàn {trim_scale(r.price_xu)} Xu | {r.name} ngừng bán khi nhân vật đổi sang kiểu mới. Xu đã về ví của bạn. | `refund_retired_items` |
| A4 | ADMIN_XU | {case when v_amount > 0 then 'Quỹ '}{v_name} được RaceHub tặng {v_amount}{' Xu' else 'Quỹ '}{v_name} được điều chỉnh {v_amount}{' Xu' end} | {v_reason} | `admin_grant_xu` |
| A5 | ADMIN_XU | {case when v_amount > 0 then 'RaceHub tặn}{v_amount}{' Xu' else 'Ví của bạn được điều chỉnh '}{v_amount}{' Xu' end} | {v_reason} | `admin_grant_xu` |
| A6 | ADMIN_XU | Đã nạp {(o.xu + o.bonus_xu)} Xu | Đơn {o.code} đã được xác nhận. | `admin_confirm_order` |
| A7 | BADGE | Huy hiệu mới: {(q.reward_badge->>'title')} | Hoàn thành nhiệm vụ {q.title} | `quest_extras` |
| A8 | BADGE | Huy hiệu mới: {a.title} | {a.description} | `evaluate_achievements` |
| A9 | BADGE | Huy hiệu mới: {coalesce((select title from public.achie} | Bạn đã đọc hết chuỗi "{(select title from public.content_series}". | `knowledge_progress` |
| A10 | CHALLENGE_BOOST | Ngày vàng ×{trim(to_char(p_multiplier, 'FM9.9'))} ngày {to_char(p_day, 'DD/MM')}: {c.title} | {v_title} — km chạy trong ngày được nhân ×{trim(to_char(p_multiplier, 'FM9.9'))}. | `set_challenge_boost_day` |
| A11 | CHALLENGE_CANCELLED | RaceHub đã hủy thử thách: {c.title} | {trim(p_reason)} | `admin_cancel_challenge` |
| A12 | CHALLENGE_CANCELLED | Thử thách đã bị hủy: {c.title} | {p_reason} | `cancel_challenge` |
| A13 | CHALLENGE_JOINED | {display_name(v_uid)}{case when c.format = 'DUEL' then ' đã nh}{c.title} | — | `join_challenge` |
| A14 | CHALLENGE_JOINED | Đã chia đội: {c.title} | Bạn ở đội {m.name}. Mục tiêu đã khóa — chạy thôi! | `assign_pledge_teams` |
| A15 | CHALLENGE_NEW | Thử thách mới trong {coalesce(v_club_name, 'CLB')}: {v_title} | {case when v_reward > 0 then 'Giải thưởng}{v_reward}{' Xu. Vào tham gia ngay!' else 'Vào tham} | `create_challenge_v2` |
| A16 | CHALLENGE_RECUR_FAILED | Chưa tạo được kỳ mới: {left(c.title, 80)} | {case when sqlerrm like '%INSUFFICIENT%' }{left(sqlerrm, 120) end} | `spawn_next_occurrence` |
| A17 | CHALLENGE_RESULT | Kết quả: {c.title} | {case when r.profile_id = any(v_winners) }{r.final_rank end}{case when r.reward_xu > 0 then ' · +'}{r.reward_xu}{' Xu' else '' end} | `settle_challenge` |
| A18 | CHALLENGE_RULES | BTC cập nhật thể lệ: {c.title} | Xem lại phần Luật chơi để nắm thể lệ mới. | `set_challenge_rules` |
| A19 | CHAT_MENTION | {display_name(new.author_id)} nhắc đến bạn trong {coalesce(v_club, 'CLB')} | {left(new.body, 140)} | `after_club_message` |
| A20 | CLUB_ALBUM | Album chưa được duyệt | {a.title}{coalesce(': '}{nullif(trim(p_note), ''), '')} | `review_club_album` |
| A21 | CLUB_ALBUM | Album của bạn đã được duyệt | {a.title} | `review_club_album` |
| A22 | CLUB_ALBUM | Album ảnh mới: {v_title} | Xem ảnh trong tab Ảnh của CLB | `save_club_album` |
| A23 | CLUB_ALBUM | Link ảnh chờ duyệt | {display_name(v_uid)} gửi album "{v_title}" | `save_club_album` |
| A24 | CLUB_ANNOUNCEMENT | {coalesce(v_title, 'Thông báo mới từ CLB'} | {left(v_body, 140)} | `create_club_post` |
| A25 | CLUB_APPROVED | Bạn đã được duyệt vào {v_club.name} | Vào CLB để chào mọi người nhé! | `club_member_events` |
| A26 | CLUB_BATTLE | CLB nhận lời đấu với {v_a} | Mọi km hợp lệ trong thời gian thi đấu đều tính cho CLB. Chạy thôi! | `respond_club_battle` |
| A27 | CLUB_BATTLE | Trận đấu với {v_o} đã được chấp nhận | Mọi km hợp lệ trong thời gian thi đấu đều tính cho CLB. Chạy thôi! | `respond_club_battle` |
| A28 | CLUB_BATTLE | {case when v_win = b.challenger_id then '}{v_on}{'! 🏆' when v_win is null then 'Hòa với '}{v_on else 'CLB thua '}{v_on end} | {v_msg} | `settle_due_club_battles` |
| A29 | CLUB_BATTLE | {case when v_win = b.opponent_id then 'CL}{v_an}{'! 🏆' when v_win is null then 'Hòa với '}{v_an else 'CLB thua '}{v_an end} | {v_msg} | `settle_due_club_battles` |
| A30 | CLUB_BATTLE | {v_name} thách đấu CLB của bạn | {coalesce(nullif(trim(p_message), ''), 'V} | `create_club_battle` |
| A31 | CLUB_BATTLE | {v_o} đã từ chối lời thách đấu | — | `respond_club_battle` |
| A32 | CLUB_BOOST_DAY | Ngày vàng ×{trim(to_char(p_multiplier, 'FM9.9'))} ở {v_name}: {to_char(p_day, 'DD/MM')} | {v_title} — km chạy trong ngày được nhân ×{trim(to_char(p_multiplier, 'FM9.9'))} trên BXH và thử thách của CLB. | `set_club_boost_day` |
| A33 | CLUB_CUP | Thách đấu "{u.title}" đã hủy | — | `cancel_club_cup` |
| A34 | CLUB_CUP | Thách đấu CLB chờ duyệt: {v_title} | {v_name} vừa tạo. Vào Quản trị → Thách đấu để duyệt. | `create_club_cup` |
| A35 | CLUB_CUP | {case when p_approve then 'Thách đấu "'}{u.title}{'" đã được duyệt' else 'Thách đấu "'}{u.title}{'" chưa được duyệt' end} | {case when p_approve then 'Ban quản trị c} | `review_club_cup` |
| A36 | CLUB_CUP | {v_club} tham gia thách đấu "{u.title}" | Mọi km hợp lệ từ {to_char(u.start_at at time zone 'Asia/Ho} đều tính cho CLB. Chạy thôi! | `join_club_cup` |
| A37 | CLUB_CUP | {v_club} đã đăng ký "{u.title}" | — | `join_club_cup` |
| A38 | CLUB_CUP | {v_msg} | {case when u.metric = 'TOTAL_KM' then 'Tổ}{(r->>'km')}{' km' else (r->>'avg_km')}{' km trung bình / thành viên' end} · {(r->>'runners')} người chạy | `settle_due_club_cups` |
| A39 | CLUB_DUE | Nhắc đóng phí: {d.title} | {to_char(d.amount_vnd, 'FM999G999G999')}đ{coalesce(' · hạn '}{to_char(d.due_date, 'DD/MM'), '')} | `remind_due` |
| A40 | CLUB_DUE | Thu phí: {trim(p_title)} | {to_char(p_amount, 'FM999G999G999')}đ{coalesce(' · hạn '}{to_char(p_due_date, 'DD/MM'), '')} | `create_club_due` |
| A41 | CLUB_DUE | {display_name(v_uid)} báo đã đóng phí | {d.title} · {to_char(d.amount_vnd, 'FM999G999G999')}đ — kiểm tra tài khoản và xác nhận | `claim_due_paid` |
| A42 | CLUB_DUE | Đã xác nhận đóng phí | {d.title} | `set_due_payment` |
| A43 | CLUB_EVENT | Sắp tới: {e.title} | {to_char(e.starts_at at time zone 'Asia/H}{coalesce(' · '}{e.location_name, '')} | `remind_events` |
| A44 | CLUB_EVENT | Sự kiện mới: {f.title} | {to_char(f.starts_at at time zone 'Asia/H}{coalesce(' · '}{f.location_name, '')} | `create_club_event` |
| A45 | CLUB_EVENT | Đã hủy: {e.title} | {trim(p_reason)} | `cancel_club_event` |
| A46 | CLUB_EVENT | Đổi lịch: {f.title} | {to_char(f.starts_at at time zone 'Asia/H}{coalesce(' · '}{f.location_name, '')} | `update_club_event` |
| A47 | CLUB_EXCHANGE | Giao lưu với {v_from}: {x.title} | {x.location_name} — đăng ký tham gia ở tab Lịch | `respond_club_exchange` |
| A48 | CLUB_EXCHANGE | {v_from} mời CLB giao lưu: {x.title} | {to_char(x.starts_at at time zone 'Asia/H} · {x.location_name}. Mở thư mời để nhận lời. | `send_club_exchange` |
| A49 | CLUB_EXCHANGE | {v_to} chưa nhận lời giao lưu | {coalesce(x.response_note, x.title)} | `respond_club_exchange` |
| A50 | CLUB_EXCHANGE | {v_to} đã nhận lời giao lưu! | {x.title} · {x.location_name} | `respond_club_exchange` |
| A51 | CLUB_EXCHANGE | Đã huỷ giao lưu: {x.title} | {v_reason} | `cancel_club_exchange` |
| A52 | CLUB_JOIN_REQUEST | {display_name(new.user_id)} xin gia nhập {v_club.name} | — | `club_member_events` |
| A53 | CLUB_NEWS | {v_title} | {left(coalesce(nullif(v_body, ''), 'Tin m} | `news_categories` |
| A54 | CLUB_POLL | {display_name(v_uid)} tạo bình chọn | {trim(p_question)} | `create_club_poll` |
| A55 | CLUB_PRO | CLB đã lên gói CLB Pro | Hiệu lực tới {to_char(v_row.ends_at at time zone 'Asia}. | `grant_subscription` |
| A56 | CLUB_PRO | CLB được cấp quyền tổ chức giải chạy | — | `admin_set_race_organizer` |
| A57 | CLUB_PRO | {case when upper(p_plan) = 'PRO' then c.n}{' đã lên gói CLB Pro' else c.name}{' trở về gói miễn phí' end} | {case when upper(p_plan) = 'PRO' then 'Mở} | `admin_set_club_plan` |
| A58 | CLUB_ROLE | Bạn là Chủ nhiệm mới | Chủ nhiệm cũ đã rời CLB và trao quyền cho bạn. | `leave_club` |
| A59 | CLUB_ROLE | Bạn là Chủ nhiệm mới của {v_club} | Quyền Chủ nhiệm CLB đã được trao cho bạn. | `transfer_club_ownership` |
| A60 | CLUB_RUN_REVIEW | {display_name(new.user_id)} có bài chạy cần duyệt | {round(coalesce(new.distance_m, 0) / 1000} km · {coalesce(new.validation_reason, '')} | `activity_pending_notify` |
| A61 | CLUB_SHOP | Cửa hàng CLB: {trim(p->>'title')} | Mở đặt hàng{case when nullif(p->>'order_deadline', '}{to_char((p->>'order_deadline')::timestam}. Xem và đặt ngay trong CLB. | `save_club_product` |
| A62 | CLUB_SHOP | {case v_to when 'PAID' then 'CLB đã nhận }{o.code when 'DELIVERED' then 'Đơn '}{o.code}{' đã giao' else 'Đơn '}{o.code}{' đã bị huỷ' end} | {coalesce(nullif(trim(coalesce(p_note, ''} | `set_club_order_status` |
| A63 | CLUB_UNIFORM | CLB có đồng phục mới: {r.name} | Vào Tủ đồ, bấm "Mặc cả bộ" để mặc đồng phục CLB. | `admin_review_uniform_request` |
| A64 | CLUB_UNIFORM | Đồng phục "{r.name}" cần chỉnh sửa | {r.review_note} | `admin_review_uniform_request` |
| A65 | COMMENT_LIKE | {display_name(v_uid)} đã thích bình luận của bạn | {left(c.body, 140)} | `toggle_post_comment_like` |
| A66 | COMMENT_LIKE | {display_name(v_uid)} đã thích bình luận của bạn | {left(cm.body, 120)} | `toggle_org_comment_like` |
| A67 | COMMENT_REPLY | {display_name(v_uid)} đã trả lời bình luận của bạn | {left(v_body, 140)} | `add_post_comment` |
| A68 | COMMENT_REPLY | {display_name(v_uid)} đã trả lời bình luận của bạn | {left(trim(p_body), 120)} | `add_org_post_comment` |
| A69 | CONTENT | Bài viết cần chỉnh sửa | "{a.title}": {coalesce(p_note, 'Xem ghi chú biên tập')} | `cms_set_status` |
| A70 | CONTENT | Bài viết đã được đăng | {a.title} | `cms_set_status` |
| A71 | CONTENT | Chuyên gia góp ý bài viết | "{a.title}": {left(trim(p_note), 200)} | `cms_expert_review` |
| A72 | DM | {display_name(v_uid)} nhắn tin cho bạn | {left(v_body, 140)} | `send_direct_message` |
| A73 | ENTERPRISE_LEAD | Yêu cầu báo giá Doanh nghiệp: {left(trim(p->>'org_name'), 80)} | {left(trim(p->>'contact_name'), 80)} · {v_phone} | `request_enterprise_quote` |
| A74 | FOLLOW | {display_name(v_uid)} đã theo dõi bạn | {case when private.is_following(p_user, v} | `follow_runner` |
| A75 | GIFT | {v_name} tặng bạn {case when v_qty > 1 then v_qty}{' × ' else '' end}{g.emoji} {g.name} | {coalesce(v_msg, g.description)} | `send_gift` |
| A76 | HONOR | BTC đã chọn ảnh vinh danh cho bạn | Thử thách "{c.title}". Bạn có thể đổi ảnh khác hoặc ẩn mình khỏi ảnh công khai. | `set_honor_pref` |
| A77 | HONOR | Bạn được vinh danh 🏆 | Bạn có tên trong bảng vinh danh "{c.title}". Tải ảnh vinh danh để chia sẻ! | `publish_challenge_honor` |
| A78 | LEAGUE | {case v_outcome when 'PROMOTED' then 'Bạn}{league_name(v_new_tier)}{'!' when 'DEMOTED' then 'Bạn xuống hạng }{league_name(v_new_tier) else 'Bạn giữ hạ}{league_name(v_new_tier) end} | Tuần trước bạn xếp thứ {m.final_rank}/{n} | `settle_league_week` |
| A79 | LEVEL_UP | Chúc mừng! Bạn lên cấp {p_level} | {level_name(p_level)}{case when v_xu > 0 then ' · +'}{trim_scale(v_xu)}{' Xu' else '' end} | `level_up_event` |
| A80 | LUCKY_DRAW_WIN | Chúc mừng! Bạn trúng {w.prize} | {d.title} | `draw_absent` |
| A81 | MARKET | {case v_act when 'APPROVE' then 'Hồ sơ "'}{r.name}{'" đã được xác minh ✓' when 'REJECT' the}{r.name}{'" cần bổ sung' else 'Hồ sơ "'}{r.name}{'" đã bị ẩn' end} | {coalesce(p_note, 'Hồ sơ của bạn đã hiện } | `admin_review_partner` |
| A82 | MARKET | {case when p_hide then 'Tin BIB đã bị ẩn'} | {b.race_name}{coalesce(': '}{nullif(trim(p_reason), ''), '')} | `admin_hide_bib` |
| A83 | ORG_APPROVED | Bạn đã vào {coalesce(v_org, 'tổ chức')} | Xem chiến dịch đang diễn ra. | `set_org_member` |
| A84 | ORG_APPROVED | Bạn đã được thêm vào {(select o.name from public.organizations} | Xem chiến dịch đang diễn ra. | `org_import_members` |
| A85 | ORG_CAMPAIGN | {coalesce(v_org, 'Tổ chức')}: {v_title} | Chiến dịch mới — bài chạy hợp lệ của bạn được tính tự động. | `save_org_campaign` |
| A86 | ORG_CAMPAIGN_DQ | Kết quả chiến dịch “{c.title}” không được công nhận | {left(trim(p_note), 300)} | `review_campaign_result` |
| A87 | ORG_CLUB_INVITE | {o.name} mời CLB tham gia tổ chức | {case when o.include_club_pro then 'Tham } | `org_invite_club` |
| A88 | ORG_CLUB_JOINED | {(select c.name from public.clubs c where} đã vào tổ chức | Thành viên CLB được tính vào chiến dịch của tổ chức. | `respond_org_invite` |
| A89 | ORG_CREATED | Mời bạn dùng thử RaceHub Doanh nghiệp | Bạn là quản trị viên của tổ chức dùng thử "{v_name}" trong {v_days} ngày. | `admin_create_demo_org` |
| A90 | ORG_CREATED | Tổ chức {left(v_name, 80)} đã sẵn sàng | Bạn là quản trị viên. Mời thành viên bằng mã {v_code} và tạo chiến dịch đầu tiên. | `admin_create_org` |
| A91 | ORG_JOIN_REQUEST | {display_name(v_uid)} xin vào {o.name} | Duyệt ở mục Thành viên của tổ chức. | `join_org` |
| A92 | ORG_POST_COMMENT | {display_name(v_uid)} bình luận bài của bạn | {left(trim(p_body), 120)} | `add_org_post_comment` |
| A93 | POST_CHEER | {display_name(v_uid)}{case when p.kind = 'AUTO_RUN' then ' đã } | — | `toggle_post_reaction` |
| A94 | POST_COMMENT | {display_name(v_uid)} đã bình luận bài của bạn | {left(v_body, 140)} | `add_post_comment` |
| A95 | PROMO | {pr.title} | {coalesce(nullif(trim(coalesce(pr.message}{array_to_string(v_parts, ', '))} | `give_promo_reward` |
| A96 | RACE_CANCELLED | Giải {r.title} đã hủy | {coalesce(nullif(trim(p_reason), ''), 'Ba} | `cancel_virtual_race` |
| A97 | RACE_FINISHED | Hoàn thành {r.title} | Cự ly {g.distance_km} km · BIB {g.bib}. Xem thứ hạng và nhận giấy chứng nhận. | `race_evaluate` |
| A98 | REFERRAL | Bạn nhận {trim_scale((cfg->>'inviterXu')::numeric)} Xu giới thiệu | {display_name(p_user)} đã hoàn thành bài chạy đầu tiên. | `referral_on_run` |
| A99 | RUNNER_CONNECT | {first_name(v_uid)} muốn kết nối chạy cùng bạn | {coalesce(v_msg, 'Xem lời mời trong Quanh} | `send_connection` |
| A100 | RUNNER_CONNECTED | {first_name(v_uid)} đã chấp nhận kết nối | Rủ nhau một buổi chạy nhé! | `respond_connection` |
| A101 | RUNNER_INVITE | {first_name(v_uid)} rủ bạn chạy: {e.title} | {coalesce(v_note, to_char(e.starts_at at }{coalesce(' · '}{e.location_name, ''))} | `invite_to_run` |
| A102 | RUNNER_INVITE | {first_name(v_uid)} rủ bạn vào CLB {(select name from public.clubs where id } | {v_note} | `invite_to_run` |
| A103 | RUN_REVIEW | Bài chạy đang chờ xác minh | {coalesce(new.validation_reason, 'Bài chạ} | `activity_pending_notify` |
| A104 | RUN_REVIEW | {case when p_status = 'APPROVED' then 'Bà} | {round(coalesce(a.distance_m, 0) / 1000.0} km — {case when p_status = 'APPROVED' then 'đã} | `review_activity` |
| A105 | RUN_SYNCED | {v_title} | {v_body} | `run_synced_notify` |
| A106 | SHINE | Bạn đã đạt Tỏa sáng {v_names[private.shine_tier(v_new) + 1]} ✨ | Ảnh đại diện của bạn có khung mới. Cảm ơn cộng đồng đã tiếp sức! | `shine_on_gift` |
| A107 | SYSTEM | {case when v_role = 'SYSTEM_ADMIN' then '} | {coalesce(p_reason, '')} | `admin_set_user_role` |
| A108 | THANKS | {display_name(v_uid)} cảm ơn bạn đã tiếp sức 💛 | Món quà của bạn đã tiếp thêm năng lượng cho buổi chạy. | `send_thanks` |
| A109 | VIP | Bạn đã là {v_name} | Hiệu lực tới {to_char(v_row.ends_at at time zone 'Asia}. Lượt tạo thử thách tháng này đã được cấp. | `grant_subscription` |
| A110 | VIP | Bạn được cấp quyền tổ chức giải chạy | — | `admin_set_race_organizer` |
| A111 | VOUCHER | Bạn nhận voucher từ {c.sponsor_name} 🎟️ | {c.title} | `issue_voucher` |
| A112 | p_kind | {p_title} | {p_body} | `notify_club` |
| A113 | p_kind text | {p_title text} | {p_body text} | `notify` |

## B. Lời báo trạng thái bài chạy

| # | Khi nào | Câu hiện cho người chạy |
|---|---|---|
| B1 | Bài có tốc độ như đi xe / chạy nhanh bất thường | Tốc độ có đoạn bất thường. |
| B2 | Mất GPS phần lớn bài / nối thẳng quá nhanh | Mất tín hiệu GPS một đoạn. |
| B3 | Không có điểm GPS | Thiếu dữ liệu GPS. |
| B4 | Chọn "Chỉ tính phần có GPS" | Chỉ tính phần có GPS. |
| B5 | Phần có GPS dưới 200 m | Quãng đường có GPS dưới 200 m. |
| B6 | Trùng giờ với bài khác cùng tài khoản | Trùng giờ với bài chạy khác. |
| B7 | Bài dưới 200 m | Quá ngắn (< 200 m), không đủ điều kiện ghi nhận. |

## C. Giọng huấn luyện viên (đọc to khi chạy)

| # | Câu đọc |
|---|---|
| C1 | Hoàn thành {km} ki lô mét. Pace {phút} phút {giây} giây. Thời gian chạy {phút} phút. |
| C2 | Bắt đầu chạy |
| C3 | Tự tạm dừng |
| C4 | Tiếp tục chạy |
| C5 | Bạn đã đứng yên {số phút} phút. Nếu đã chạy xong, hãy bấm Kết thúc. |
| C6 | Đã tạm dừng bài chạy vì bạn đứng yên {số phút} phút. |
| C7 | Tạm dừng |
| C8 | Tiếp tục |
| C9 | Kết thúc bài chạy |
| C10 | Chạy tiếp |

## D. Câu báo lỗi


**features/admin/api/adminApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D1 | `CORE` | Cơ bản |
| D2 | `PROMO_OVERLAP` | Vật phẩm này đang có chương trình khác trong cùng thời gian. Mỗi vật phẩm chỉ một chương trình. |
| D3 | `INVALID_DISCOUNT` | Mức giảm từ 5% đến 90%. Muốn tặng miễn phí hãy dùng loại "Miễn phí". |
| D4 | `FLASH_TOO_LONG` | Flash sale cần giờ kết thúc, tối đa 72 giờ. |
| D5 | `FREE_NEEDS_LIMIT` | Quà miễn phí phải giới hạn số lượt mỗi người (chống farm). |
| D6 | `TRIAL_AVATAR_ONLY` | Dùng thử chỉ áp cho đồ nhân vật. |
| D7 | `INVALID_BUNDLE` | Gói cần 2–12 món đồ nhân vật đang bán và giá gói. |
| D8 | `INVALID_PROMO_TITLE` | Nhập tên chương trình. |
| D9 | `INVALID_PROMO` | Chương trình không hợp lệ. |
| D10 | `FORBIDDEN` | Chỉ quản trị viên hệ thống mới làm được việc này. |
| D11 | `REASON_REQUIRED` | Hãy ghi lý do (ít nhất 5 ký tự) để lưu nhật ký. |
| D12 | `INVALID_AMOUNT` | Số lượng không hợp lệ. |
| D13 | `INVALID_COIN_KIND` | Loại Xu không hợp lệ. |
| D14 | `INSUFFICIENT_BALANCE` | Số dư không đủ để trừ — không cho phép âm. |
| D15 | `NEGATIVE_BALANCE` | Số dư không đủ để trừ — không cho phép âm. |
| D16 | `USER_NOT_FOUND` | Không tìm thấy người dùng. |
| D17 | `CLUB_NOT_FOUND` | Không tìm thấy CLB. |
| D18 | `INVALID_MAX_SLOTS` | Số người tối đa của vé phải từ 1 đến 10.000. |
| D19 | `INVALID_TIME_RANGE` | Khoảng thời gian không hợp lệ (kết thúc sau bắt đầu, sự kiện cần đủ 2 mốc, tối đa 1 năm). |
| D20 | `INVALID_TITLE` | Tên cần từ 2 ký tự. |
| D21 | `PASS_NOT_FOUND` | Không tìm thấy vé. |
| D22 | `INVALID_CONFIG` | Cấu hình không hợp lệ — kiểm tra lại các mốc và đơn giá. |
| D23 | `INVALID_CODE` | Mã không hợp lệ: vật phẩm dùng chữ thường, số, dấu _ (3–48 ký tự); món Tỏa sáng dùng chữ in hoa, số, dấu _ (2–32 ký tự). |
| D24 | `INVALID_NAME` | Tên vật phẩm cần 2–60 ký tự. |
| D25 | `INVALID_DESCRIPTION` | Mô tả tối đa 160 ký tự. |
| D26 | `INVALID_SLOT` | Ô trang phục không hợp lệ. |
| D27 | `INVALID_RARITY` | Độ hiếm không hợp lệ. |
| D28 | `INVALID_PRICE` | Giá phải từ 0 đến 100.000 Xu. |
| D29 | `INVALID_LEVEL` | Cấp mở khóa phải từ 1 đến 8. |
| D30 | `INVALID_STATUS` | Trạng thái không hợp lệ. |
| D31 | `COLLECTION_NOT_FOUND` | Không tìm thấy bộ sưu tập. |
| D32 | `BADGE_NOT_FOUND` | Không tìm thấy huy hiệu với mã này. |
| D33 | `CHALLENGE_NOT_FOUND` | Không tìm thấy thử thách. |
| D34 | `PRINT_TOP_ONLY` | Chỉ áo mới có vùng in. |
| D35 | `INVALID_PRINT` | Nội dung in chưa hợp lệ (logo PNG/WebP/JPG, màu chữ dạng #rrggbb). |
| D36 | `ITEM_HAS_OWNERS` | Đã có người sở hữu: không đưa về Nháp / Chờ duyệt được. Dùng Ngừng bán. |
| D37 | `INVALID_SUPPLY` | Số lượng giới hạn phải từ 1 trở lên. |
| D38 | `REQUEST_NOT_FOUND` | Không tìm thấy yêu cầu. |
| D39 | `REQUEST_CLOSED` | Yêu cầu đã được xử lý. |
| D40 | `INVALID_ACTION` | Thao tác không hợp lệ. |
| D41 | `INVALID_PATTERN` | Họa tiết không hợp lệ cho món này. |
| D42 | `PATTERN_TINT_ONLY` | Họa tiết chỉ dùng cho món đổi màu (không dùng cho lớp ảnh). |
| D43 | `INVALID_KIT` | Mã bộ không hợp lệ. |
| D44 | `INVALID_PARTS` | Bộ đồng phục chỉ gồm áo, quần, tất, giày. |
| D45 | `TINT_SLOT_ONLY` | Vật phẩm đổi màu chỉ dành cho áo, quần, tất, giày. |
| D46 | `INVALID_COLOR` | Mã màu không hợp lệ. |
| D47 | `LAYER_REQUIRED` | Cần ít nhất một ảnh lớp (Nam hoặc Nữ). |
| D48 | `INVALID_LAYER` | Đường dẫn ảnh lớp không hợp lệ (phải là PNG). |
| D49 | `SLOT_LOCKED` | Đã có người sở hữu món này, không đổi sang ô khác được. Hãy tạo mã mới. |
| D50 | `ITEM_REQUIRED` | Không ngừng bán được bản nguyên bản (bộ mặc định của mọi người). |
| D51 | `ITEM_NOT_FOUND` | Không tìm thấy vật phẩm. |
| D52 | `INVALID_REWARD` | Phần thưởng không hợp lệ: cần ít nhất Xu, lượt tạo hoặc gói VIP (gói tặng phải là VIP1–3). |
| D53 | `SEGMENT_TOO_LARGE` | Nhóm quá lớn (trên 50.000 người) — chia nhỏ theo điều kiện khác. |
| D54 | `INVALID_SALE` | Đợt giảm giá cần % giảm hoặc % tặng thêm. |
| D55 | `INVALID_PERIOD` | Kỳ nhiệm vụ không hợp lệ. |
| D56 | `INVALID_METRIC` | Chỉ số không hợp với kỳ (km / ngày chạy trong tuần chỉ cho nhiệm vụ tuần; km cộng đồng cho tuần / tháng / sự kiện; điểm danh chỉ hằng ngày). |
| D57 | `INVALID_TARGET` | Mục tiêu phải lớn hơn 0. |
| D58 | `TOO_MANY_ACTIVE` | Đã đủ số nhiệm vụ đang bật cho loại này. Tắt bớt một nhiệm vụ hoặc nâng giới hạn ở thẻ Giới hạn. |
| D59 | `INVALID_TIERS` | Bậc không hợp lệ: mục tiêu phải tăng dần, tối đa 5 bậc (km cộng đồng không dùng bậc). |
| D60 | `INVALID_PARAMS` | Tham số không hợp lệ (km tối thiểu 0–100, giờ chạy sớm 1–23). |
| D61 | `INVALID_CATEGORY` | Nhóm nhiệm vụ không hợp lệ. |
| D62 | `INVALID_BADGE` | Tên huy hiệu cần 2–60 ký tự. |
| D63 | `INVALID_PASSES` | Lượt tạo không hợp lệ (1–10 lượt, quy mô 2–1.000 người). |
| D64 | `INVALID_LIMIT` | Giới hạn không hợp lệ. |
| D65 | `INVALID_KIND` | Loại món không hợp lệ. |
| D66 | `ORDER_NOT_FOUND` | Không tìm thấy đơn hàng. |
| D67 | `ORDER_NOT_PENDING` | Đơn đã được xử lý hoặc đã hủy. |
| D68 | `SELF_CONFIRM_FORBIDDEN` | Đây là đơn của chính bạn — cần một admin khác xác nhận sau khi kiểm tra tiền đã về. |
| D69 | `INVALID_PLAN` | Gói không hợp lệ cho loại tài khoản này (VIP cho cá nhân, CLB Pro cho CLB). |
| D70 | `INVALID_MONTHS` | Kỳ hạn chỉ 1, 3, 6 hoặc 12 tháng. |
| D71 | `INVALID_BANK` | Tài khoản nhận tiền không hợp lệ: mã BIN 6 số, số tài khoản 4–30 ký tự, tên chủ tài khoản ≥ 3 ký tự. |
| D72 | `INVALID_OWNER` | Loại tài khoản không hợp lệ. |

**features/admin/api/consoleApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D73 | `CANNOT_TARGET_SELF` | Không thao tác lên chính tài khoản của bạn. |
| D74 | `CANNOT_BAN_ADMIN` | Không khóa được quản trị viên — gỡ quyền admin trước. |
| D75 | `USER_BANNED` | Tài khoản đang bị khóa — mở khóa trước khi cấp quyền. |
| D76 | `REASON_REQUIRED` | Hãy ghi lý do (ít nhất 3 ký tự) để lưu nhật ký. |
| D77 | `CHALLENGE_CLOSED` | Thử thách đã kết thúc hoặc đã hủy. |
| D78 | `USER_NOT_FOUND` | Không tìm thấy người dùng. |
| D79 | `USER_BAN` | Khóa tài khoản |
| D80 | `ADMIN_GRANT_XU` | Cộng / trừ Xu |
| D81 | `PARTNER_APPROVE` | Xác minh đối tác |
| D82 | `CLUB_TRANSFER_OWNER` | Trao quyền chủ nhiệm |
| D83 | `CONFIRM_ORDER` | Xác nhận đơn hàng |
| D84 | `PUBLISH_CONFIG` | Đổi chính sách kinh tế |
| D85 | `SAVE_PLAN` | Sửa gói & giá |
| D86 | `SAVE_ITEM_PROMO` | Khuyến mãi vật phẩm |
| D87 | `SAVE_GIFT` | Sửa quà tặng |
| D88 | `SYSTEM_NOTICE` | Bật thông báo hệ thống |

**features/billing/api/billingApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D89 | `TOO_MANY_PENDING_ORDERS` | Bạn đang có 5 đơn chờ thanh toán. Hoàn tất hoặc hủy bớt rồi tạo đơn mới. |
| D90 | `INVALID_PLAN` | Gói không còn bán. |
| D91 | `INVALID_MONTHS` | Kỳ hạn này không còn bán. |
| D92 | `INVALID_PACKAGE` | Gói Xu không còn bán. |
| D93 | `CLUB_STAFF_REQUIRED` | Chỉ ban quản trị CLB mới mua gói cho CLB. |
| D94 | `ORDER_NOT_FOUND` | Không tìm thấy đơn hàng. |
| D95 | `ORDER_NOT_PENDING` | Đơn đã được xử lý. |
| D96 | `NOT_A_MEMBER` | Bạn không thuộc CLB này. |
| D97 | `FORBIDDEN` | Bạn không có quyền làm việc này. |

**features/challenge/api/challengeApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D98 | `VIP_REQUIRED` | Nhân bản thử thách cũ dành cho VIP2 trở lên. |
| D99 | `INVALID_CONQUEST` | Hạng mục chưa hợp lệ: mỗi hạng mục cần tên, cự ly 0,4–250 km và mục tiêu hợp lý (pace 2:00–25:00/km). |
| D100 | `CONQUEST_LOCKED` | Đã có người đăng ký hạng mục — không đổi luật chinh phục được nữa. |
| D101 | `CONQUEST_TARGET_LOCKED` | Thử thách đã bắt đầu: bạn chỉ thêm được hạng mục mới, không bỏ hay đổi mục tiêu đã đăng ký. |
| D102 | `CONQUEST_NOT_SUPPORTED` | Thử thách này không có hạng mục chinh phục. |
| D103 | `REGISTRATION_CLOSED` | Đã hết hạn đăng ký thử thách này. |
| D104 | `INVALID_DEADLINE` | Hạn đăng ký phải từ bây giờ đến trước khi kết thúc (thử thách đội: trước giờ xuất phát). |
| D105 | `BOOST_DAY_TOO_LATE` | Ngày vàng phải là ngày sắp tới, nằm trong thời gian thử thách. |
| D106 | `BOOST_DAYS_LIMIT` | Mỗi thử thách tối đa 10 ngày vàng. |
| D107 | `BOOST_NOT_SUPPORTED` | Ngày vàng chỉ áp dụng cho thử thách tính theo km. |
| D108 | `INVALID_MULTIPLIER` | Hệ số chỉ được ×1,5, ×2 hoặc ×3. |
| D109 | `REWARD_TOO_LARGE` | Mỗi thử thách chỉ treo thưởng tối đa 50% số dư quỹ CLB. |
| D110 | `REWARD_NOT_ALLOWED` | Chỉ thử thách CLB mới treo thưởng được (trích quỹ CLB). Thử thách cá nhân không treo thưởng Xu. |
| D111 | `PLEDGES_MISSING` | Còn thành viên chưa đăng ký mục tiêu. Nhắc họ, hoặc chia đội luôn (người chưa đăng ký tính 0 km). |
| D112 | `PLEDGE_LOCKED` | Mục tiêu đã khóa (đã xuất phát hoặc đã chia đội). |
| D113 | `PLEDGE_RULES_LOCKED` | Đã có người đăng ký mục tiêu và thử thách đã bắt đầu — không đổi luật được nữa. |
| D114 | `INVALID_PLEDGE` | Mục tiêu không nằm trong các mục tiêu cho phép. |
| D115 | `INVALID_PLEDGE_OPTIONS` | Các mục tiêu không hợp lệ. |
| D116 | `INVALID_PLEDGE_CAP` | % vượt mục tiêu không hợp lệ. |
| D117 | `INVALID_TEAM_SIZE` | Mỗi đội từ 2 đến 50 người. |
| D118 | `PLEDGE_NOT_SUPPORTED` | Thử thách này không dùng mục tiêu tự đăng ký. |
| D119 | `NOT_ENOUGH_MEMBERS` | Chưa đủ người để chia đội. |
| D120 | `CHALLENGE_NOT_FOUND` | Không tìm thấy thử thách, hoặc bạn cần mã mời để xem. |
| D121 | `CHALLENGE_CLOSED` | Thử thách đã kết thúc hoặc đã bị hủy. |
| D122 | `TOO_MANY_RULES` | Tối đa 5 mục thể lệ tự đặt. |
| D123 | `CHALLENGE_FULL` | Thử thách đã đủ người. |
| D124 | `ALREADY_JOINED` | Bạn đã tham gia thử thách này. |
| D125 | `NOT_JOINED` | Bạn chưa tham gia thử thách này. |
| D126 | `INVALID_INVITE` | Thử thách riêng tư — cần đúng mã mời. |
| D127 | `CLUB_MEMBERS_ONLY` | Chỉ thành viên CLB tổ chức mới tham gia được. |
| D128 | `TEAM_ROSTER_LOCKED` | Thử thách đội đã bắt đầu, không đổi đội hay vào thêm được. |
| D129 | `TEAM_FULL` | Đội này đã đủ người. Hãy chọn đội khác. |
| D130 | `INVALID_TEAM` | Đội không hợp lệ. |
| D131 | `CANNOT_LEAVE_STARTED` | Thử thách đội và 1-1 không rời được sau khi đã bắt đầu. |
| D132 | `CANNOT_CANCEL_STARTED` | Không hủy được khi thử thách đã bắt đầu và có người tham gia. |
| D133 | `INVALID_TITLE` | Tên thử thách cần từ 3 đến 120 ký tự. |
| D134 | `DESC_TOO_LONG` | Mô tả quá dài. |
| D135 | `INVALID_TIME_RANGE` | Thời gian không hợp lệ (kết thúc phải sau bắt đầu, tối thiểu 1 giờ, tối đa 1 năm). |
| D136 | `TEAM_START_TOO_SOON` | Thử thách đội cần bắt đầu sau ít nhất 10 phút. |
| D137 | `TARGET_REQUIRED` | Hãy đặt mục tiêu cho thử thách. |
| D138 | `INVALID_STREAK` | Chuỗi ngày cần cự ly tối thiểu mỗi ngày và không dài hơn thời gian thử thách. |
| D139 | `INVALID_TEAMS` | Cần từ 2 đến 8 đội, tên tối đa 40 ký tự. |
| D140 | `INVALID_DISTANCE` | Cự ly không hợp lệ. |
| D141 | `INVALID_PACE` | Khoảng pace không hợp lệ. |
| D142 | `INVALID_MAX_SLOTS` | Số người tối đa không hợp lệ. |
| D143 | `INSUFFICIENT_BALANCE` | Số Xu trong ví không đủ cho phí tạo và tiền treo thưởng. |
| D144 | `INSUFFICIENT_TREASURY` | Quỹ CLB không đủ cho phí tạo và tiền treo thưởng. |
| D145 | `INVALID_RECURRENCE` | Chu kỳ lặp không hợp lệ. |
| D146 | `RECURRENCE_NOT_SUPPORTED` | Kèo 1-1 không lặp lại được. |
| D147 | `RECURRENCE_TOO_SHORT` | Mỗi kỳ dài hơn chu kỳ lặp — rút ngắn thời gian hoặc chọn chu kỳ dài hơn. |
| D148 | `INVALID_AMOUNT` | Số Xu thưởng không hợp lệ. |
| D149 | `FORBIDDEN` | Bạn không có quyền làm việc này. |
| D150 | `RATE_LIMITED` | Bạn thao tác hơi nhanh, thử lại sau ít phút. |
| D151 | `HONOR_PRO_REQUIRED` | Vinh danh là tính năng của CLB Pro hoặc gói VIP (người tạo thử thách). |
| D152 | `HONOR_REVIEW_PENDING` | Chỉ công bố được sau khi thử thách kết thúc 24 giờ (thời gian duyệt bài / khiếu nại). |
| D153 | `HONOR_NOT_CONFIGURED` | Hãy bật vinh danh và chọn ít nhất một hạng mục. |
| D154 | `HONOR_NOT_AVAILABLE` | Thử thách đã hủy, không vinh danh được. |
| D155 | `INVALID_HONOR_CATEGORIES` | Hạng mục vinh danh không hợp lệ (tối đa 8, mỗi hạng mục 1–10 người). |
| D156 | `INVALID_HONOR_DESIGN` | Thiết kế ảnh vinh danh không hợp lệ. |
| D157 | `INVALID_BIB_DESIGN` | Thiết kế không hợp lệ. |
| D158 | `INVALID_HONOR_IMAGE` | Ảnh phải được tải lên từ trang vinh danh của thử thách này. |
| D159 | `NOT_A_PARTICIPANT` | Người này không tham gia thử thách. |

**features/character/api/characterApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D160 | `INSUFFICIENT_BALANCE` | Số Xu trong ví không đủ. |
| D161 | `LEVEL_TOO_LOW` | Vật phẩm này cần cấp độ cao hơn. |
| D162 | `ALREADY_OWNED` | Bạn đã có vật phẩm này. |
| D163 | `ITEM_NOT_FOUND` | Vật phẩm không còn bán. |
| D164 | `ITEM_NOT_OWNED` | Bạn chưa sở hữu vật phẩm này. |
| D165 | `SLOT_REQUIRED` | Nhân vật cần có áo, quần, tất và giày. |
| D166 | `INVALID_LOOK` | Dáng người không hợp lệ. |
| D167 | `TRIAL_USED` | Bạn đã dùng thử món này rồi. |
| D168 | `PROMO_NOT_AVAILABLE` | Chương trình đã kết thúc hoặc hết lượt. |
| D169 | `PROMO_LIMIT_REACHED` | Bạn đã dùng hết lượt của chương trình này. |
| D170 | `PROMO_NOT_ELIGIBLE` | Chương trình này không áp dụng cho tài khoản của bạn. |
| D171 | `SHINE_ONLY` | Vật phẩm này chỉ đổi bằng Tỏa sáng. |
| D172 | `CLUB_ONLY` | Đồng phục này chỉ dành cho thành viên CLB. |
| D173 | `BADGE_REQUIRED` | Cần có huy hiệu yêu cầu để nhận vật phẩm này. |
| D174 | `CHALLENGE_REQUIRED` | Hoàn thành thử thách để nhận vật phẩm này. |
| D175 | `NOT_YET_AVAILABLE` | Vật phẩm chưa mở bán. |
| D176 | `SALE_ENDED` | Vật phẩm đã hết thời gian bán. |
| D177 | `SOLD_OUT` | Vật phẩm đã hết hàng. |
| D178 | `NOT_FOR_SALE` | Vật phẩm này không bán. |

**features/character/api/uniformApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D179 | `TOO_MANY_REQUESTS` | CLB đang có 3 mẫu chờ duyệt. Chờ admin duyệt hoặc hủy bớt. |
| D180 | `INVALID_PATTERN` | Họa tiết không hợp lệ cho món này. |
| D181 | `INVALID_PARTS` | Bộ đồng phục chỉ gồm áo, quần, tất, giày. |
| D182 | `INVALID_PRINT` | Nội dung in chưa hợp lệ: cần ít nhất logo, chữ hoặc tên runner; logo phải tải lên từ đây. |
| D183 | `INVALID_COLOR` | Màu áo không hợp lệ. |
| D184 | `INVALID_NAME` | Tên mẫu áo cần từ 2 ký tự. |
| D185 | `REQUEST_CLOSED` | Yêu cầu này đã được xử lý. |
| D186 | `FORBIDDEN` | Chỉ chủ nhiệm / đội trưởng CLB làm được việc này. |

**features/club/api/clubApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D187 | `AUTH_REQUIRED` | Bạn cần đăng nhập để tiếp tục. |
| D188 | `NAME_REQUIRED` | Hãy nhập tên CLB. |
| D189 | `NAME_TOO_LONG` | Tên CLB tối đa 60 ký tự. |
| D190 | `NAME_TAKEN` | Tên này đã có CLB khác dùng. Hãy chọn tên khác. |
| D191 | `DESC_TOO_LONG` | Mô tả tối đa 300 ký tự. |
| D192 | `CLUB_NOT_FOUND` | CLB không còn tồn tại. |
| D193 | `CLUB_FULL` | CLB đã đủ số thành viên tối đa. |
| D194 | `CLUB_FREE_FULL` | CLB chưa đủ điều kiện nhận thêm thành viên: gói Miễn phí đã đủ số người tối đa. Nâng cấp CLB Pro để nhận không giới hạn. |
| D195 | `ALREADY_MEMBER` | Bạn đã ở trong CLB này hoặc đang chờ duyệt. |
| D196 | `BANNED` | Bạn đã bị hạn chế tham gia CLB này. |
| D197 | `INVITE_ONLY` | CLB này chỉ nhận thành viên qua link mời. |
| D198 | `INVALID_INVITE` | Mã mời không đúng hoặc đã hết hiệu lực. |
| D199 | `FORBIDDEN` | Bạn không có quyền làm việc này. |
| D200 | `BOOST_DAY_TOO_LATE` | Ngày vàng phải đặt trước, từ ngày mai trở đi (ngày đã bắt đầu thì không đổi được). |
| D201 | `INVALID_MULTIPLIER` | Hệ số chỉ được ×1,5, ×2 hoặc ×3. |
| D202 | `BOOST_DAYS_LIMIT` | Mỗi tháng tối đa 4 ngày vàng. |
| D203 | `TAGLINE_TOO_LONG` | Khẩu hiệu tối đa 80 ký tự. |
| D204 | `EXCHANGE_PENDING` | Đã có một thư mời đang chờ CLB này trả lời. |
| D205 | `EXCHANGE_LIMIT` | Mỗi CLB tối đa 5 thư mời đang chờ. |
| D206 | `EXCHANGE_CLOSED` | Thư mời đã được trả lời hoặc đã huỷ. |
| D207 | `EXCHANGE_EXPIRED` | Buổi giao lưu đã qua giờ. |
| D208 | `EXCHANGE_NOT_FOUND` | Không tìm thấy thư mời. |
| D209 | `REASON_REQUIRED` | Hãy ghi lý do (ít nhất 3 ký tự). |
| D210 | `CLUB_BANK_MISSING` | CLB chưa khai tài khoản nhận tiền (tab Quỹ) nên chưa đặt hàng được. |
| D211 | `ORDERS_CLOSED` | Sản phẩm đã chốt đơn. |
| D212 | `OUT_OF_STOCK` | Không còn đủ số lượng. |
| D213 | `INVALID_SIZE` | Chọn size có trong danh sách. |
| D214 | `INVALID_QUANTITY` | Số lượng không hợp lệ. |
| D215 | `INVALID_PRICE` | Giá không hợp lệ. |
| D216 | `ORDER_LOCKED` | Đơn đã được CLB xác nhận, không huỷ được. Liên hệ ban quản trị CLB. |
| D217 | `PRODUCT_NOT_FOUND` | Không tìm thấy sản phẩm. |
| D218 | `ACTIVITY_NOT_PENDING` | Bài chạy này đã được người khác duyệt. |
| D219 | `NOT_AUTHORIZED` | Bạn không có quyền làm việc này. |
| D220 | `MEMBER_NOT_FOUND` | Không tìm thấy thành viên này. |
| D221 | `TARGET_NOT_APPROVED` | Chỉ áp dụng được với thành viên đã được duyệt. |
| D222 | `OWNER_CANNOT_LEAVE` | Hãy trao quyền Chủ nhiệm cho người khác trước khi rời CLB. |
| D223 | `MUST_ASSIGN_NEW_OWNER` | Hãy trao quyền Chủ nhiệm cho người khác trước khi rời CLB. |
| D224 | `LAST_MEMBER_MUST_DELETE` | Bạn là thành viên cuối cùng. Hãy giải tán CLB thay vì rời đi. |
| D225 | `CANNOT_TRANSFER_TO_SELF` | Không thể trao quyền cho chính mình. |
| D226 | `TARGET_NOT_MEMBER` | Người được chọn không phải thành viên CLB. |
| D227 | `CONFIRM_MISMATCH` | Tên xác nhận không khớp. Hãy gõ đúng tên CLB. |
| D228 | `NOT_A_MEMBER` | Bạn cần là thành viên CLB để làm việc này. |
| D229 | `INSUFFICIENT_FUNDS` | Số Xu trong ví không đủ. |
| D230 | `INSUFFICIENT_BALANCE` | Số Xu trong ví không đủ. |
| D231 | `INVALID_AMOUNT` | Số Xu phải lớn hơn 0. |
| D232 | `INVALID_ROLE` | Vai trò không hợp lệ. |
| D233 | `INVALID_STATUS` | Trạng thái không hợp lệ. |
| D234 | `INVALID_POLICY` | Chế độ tham gia không hợp lệ. |
| D235 | `INVALID_LIMIT` | Giới hạn thành viên phải từ 2 đến 1000. |
| D236 | `LIMIT_BELOW_CURRENT` | Giới hạn mới thấp hơn số thành viên hiện tại. |
| D237 | `INVALID_COLOR` | Màu không hợp lệ. |
| D238 | `AVATAR_TYPE` | Chỉ nhận ảnh JPG, PNG hoặc WebP. |
| D239 | `AVATAR_SIZE` | Ảnh tối đa 2 MB. Hãy chọn ảnh nhẹ hơn. |
| D240 | `IMAGE_TYPE` | Chỉ nhận ảnh JPG, PNG hoặc WebP. |
| D241 | `IMAGE_SIZE` | Mỗi ảnh tối đa 5 MB. |
| D242 | `EMPTY_POST` | Hãy viết gì đó hoặc thêm ảnh. |
| D243 | `EMPTY_COMMENT` | Hãy viết bình luận. |
| D244 | `NOT_AUTHOR` | Chỉ người viết mới sửa được bình luận này. |
| D245 | `COMMENT_NOT_FOUND` | Bình luận không còn nữa. |
| D246 | `EMPTY_MESSAGE` | Tin nhắn đang trống. |
| D247 | `POST_TOO_LONG` | Nội dung quá dài. |
| D248 | `POST_NOT_FOUND` | Bài đăng không còn tồn tại. |
| D249 | `INVALID_IMAGE_PATH` | Ảnh không hợp lệ, hãy tải lại. |
| D250 | `RATE_LIMITED` | Bạn gửi hơi nhanh, đợi một chút rồi thử lại nhé. |
| D251 | `CAPTAIN_LIMIT` | CLB đã đủ số quản trị viên của gói Miễn phí. Nâng cấp CLB Pro để thêm. |
| D252 | `PRO_REQUIRED` | CLB chưa đủ điều kiện dùng tính năng này: cần nâng cấp CLB Pro. |
| D253 | `INVALID_SLUG` | Link riêng dài 3–30 ký tự, chỉ gồm chữ thường không dấu, số và dấu gạch ngang. |
| D254 | `SLUG_TAKEN` | Link này đã có CLB khác dùng. |
| D255 | `BATTLE_EXISTS` | Hai CLB đang có một trận đấu (hoặc lời mời) chưa kết thúc. |
| D256 | `BATTLE_NOT_PENDING` | Lời thách đấu này đã được trả lời. |
| D257 | `BATTLE_EXPIRED` | Trận đấu đã hết giờ. |
| D258 | `BATTLE_NOT_FOUND` | Không tìm thấy trận đấu. |
| D259 | `INVALID_OPPONENT` | Hãy chọn một CLB khác để thách đấu. |
| D260 | `INVALID_DURATION` | Trận đấu dài từ 1 ngày đến 2 tháng. |
| D261 | `START_IN_PAST` | Giờ bắt đầu đã qua. |
| D262 | `INVALID_TIME_RANGE` | Thời gian không hợp lệ. |
| D263 | `TITLE_REQUIRED` | Tiêu đề cần 3–120 ký tự. |
| D264 | `INVALID_URL` | Link phải bắt đầu bằng https:// (dán link album Google Photos, Drive, Facebook…). |
| D265 | `ALBUM_EXISTS` | Link album này đã có trong kho ảnh CLB. |
| D266 | `ALBUM_NOT_FOUND` | Album không còn tồn tại. |
| D267 | `INVALID_DATE` | Ngày chụp không hợp lệ. |

**features/club/api/eventsApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D268 | `NOT_A_MEMBER` | Bạn cần là thành viên CLB để làm việc này. |
| D269 | `FORBIDDEN` | Chỉ ban quản trị CLB làm được việc này. |
| D270 | `EVENT_NOT_FOUND` | Sự kiện không còn tồn tại. |
| D271 | `EVENT_CANCELLED` | Sự kiện đã bị hủy. |
| D272 | `EVENT_ENDED` | Sự kiện đã kết thúc. |
| D273 | `EVENT_FULL` | Sự kiện đã đủ người. |
| D274 | `INVALID_TITLE` | Tên cần từ 3 đến 80 ký tự. |
| D275 | `INVALID_TIME` | Thời gian không hợp lệ. |
| D276 | `INVALID_LOCATION` | Tọa độ điểm hẹn không hợp lệ. |
| D277 | `INVALID_EVENT` | Thông tin sự kiện không hợp lệ. |
| D278 | `REASON_REQUIRED` | Hãy ghi lý do. |
| D279 | `INVALID_TOKEN` | Mã QR không đúng. Hãy quét lại mã trên máy ban tổ chức. |
| D280 | `TOKEN_EXPIRED` | Mã QR đã hết hạn. Nhờ ban tổ chức mở mã mới. |
| D281 | `CHECKIN_CLOSED` | Chưa tới hoặc đã quá giờ điểm danh. |
| D282 | `INVALID_BANK` | Thông tin tài khoản ngân hàng chưa đúng. |
| D283 | `INVALID_QR` | Ảnh QR không hợp lệ. Hãy tải lại ảnh. |
| D284 | `INVALID_AMOUNT` | Số tiền không hợp lệ. |
| D285 | `DUE_NOT_FOUND` | Không tìm thấy kỳ thu phí. |
| D286 | `DUE_CLOSED` | Kỳ thu phí đã đóng. |
| D287 | `REMIND_TOO_SOON` | Vừa nhắc rồi. Mỗi kỳ chỉ nhắc 1 lần / 12 giờ. |
| D288 | `INVALID_RECEIPT` | Ảnh hóa đơn không hợp lệ. |
| D289 | `ENTRY_VOIDED` | Khoản này đã hủy. |
| D290 | `INVALID_QUESTION` | Câu hỏi cần từ 3 đến 200 ký tự. |
| D291 | `INVALID_OPTIONS` | Cần 2–10 lựa chọn, mỗi lựa chọn tối đa 80 ký tự. |
| D292 | `INVALID_CHOICES` | Lựa chọn không hợp lệ. |
| D293 | `POLL_CLOSED` | Bình chọn đã đóng. |
| D294 | `RATE_LIMITED` | Bạn tạo hơi nhiều bình chọn. Thử lại sau ít phút. |

**features/club/api/pointsApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D295 | `INVALID_RULES` | Luật chưa hợp lệ: 1–12 luật, tên 2–60 ký tự, điểm theo km tối đa 100 / km, giờ bắt đầu phải trước giờ kết thúc. |
| D296 | `INVALID_APPLY` | Chọn thời điểm áp dụng hợp lệ. |
| D297 | `RECAP_NOT_POSTED` | Kỳ vừa rồi đã có tổng kết hoặc chưa ai chạy — không có gì để đăng. |
| D298 | `FORBIDDEN` | Chỉ ban quản trị CLB làm được việc này. |
| D299 | `NOT_A_MEMBER` | Bạn cần là thành viên CLB. |

**features/cup/api/cupApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D300 | `FORBIDDEN` | Bạn không có quyền làm việc này. |
| D301 | `CUP_NOT_FOUND` | Không tìm thấy thách đấu (hoặc đang chờ duyệt). |
| D302 | `CLUB_STAFF_REQUIRED` | Chỉ Chủ nhiệm / Quản trị viên của CLB mới đăng ký CLB vào thách đấu. |
| D303 | `CUP_NOT_OPEN` | Thách đấu chưa mở hoặc đã đóng. |
| D304 | `CUP_NOT_PENDING` | Thách đấu này đã được xử lý. |
| D305 | `REGISTRATION_CLOSED` | Đã hết hạn đăng ký. |
| D306 | `ALREADY_JOINED` | CLB đã có trong thách đấu. |
| D307 | `CUP_FULL` | Thách đấu đã đủ số CLB. |
| D308 | `CUP_STARTED` | Thách đấu đã bắt đầu. |
| D309 | `INVALID_TITLE` | Tên thách đấu cần từ 3 đến 120 ký tự. |
| D310 | `INVALID_METRIC` | Cách tính điểm không hợp lệ. |
| D311 | `INVALID_TIME_RANGE` | Thời gian kết thúc phải sau thời gian bắt đầu. |
| D312 | `START_IN_PAST` | Thời gian bắt đầu phải ở tương lai. |
| D313 | `INVALID_DURATION` | Thách đấu kéo dài từ 1 ngày đến 3 tháng. |
| D314 | `INVALID_REG_CLOSE` | Hạn đăng ký phải sau hiện tại và trước khi kết thúc. |
| D315 | `INVALID_MAX` | Số CLB tối đa từ 2 đến 200. |
| D316 | `REASON_REQUIRED` | Nhập lý do từ chối (ít nhất 3 ký tự). |
| D317 | `RATE_LIMITED` | Bạn tạo quá nhiều thách đấu trong hôm nay. |

**features/draw/api/drawApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D318 | `NO_ENTRANTS` | Chưa có ai đủ điều kiện quay (hoặc tất cả đã trúng ở lượt trước). |
| D319 | `DRAW_CLOSED` | Lượt quay này đã quay hoặc đã huỷ. |
| D320 | `INVALID_PRIZES` | Nhập 1–10 giải, tổng tối đa 200 suất. |
| D321 | `TITLE_REQUIRED` | Tên lượt quay cần 3–120 ký tự. |
| D322 | `TOO_MANY_DRAWS` | Đang có 5 lượt quay chờ. Quay hoặc huỷ bớt trước. |
| D323 | `PICK_REQUIRED` | Hãy chọn ít nhất một người thuộc chương trình. |
| D324 | `TOO_MANY_PEOPLE` | Chọn tối đa 2.000 người. |
| D325 | `DRAW_NOT_LIVE` | Lượt quay chưa bắt đầu hoặc đã kết thúc. |
| D326 | `PRIZE_FULL` | Giải này đã đủ người trúng. Chọn giải khác. |
| D327 | `POOL_EXHAUSTED` | Đã hết người trong danh sách để quay. |
| D328 | `NOT_A_WINNER` | Người này không còn trong danh sách trúng. |
| D329 | `NO_WINNERS` | Chưa có ai trúng — quay ít nhất một giải trước khi công bố. |
| D330 | `DRAW_STARTED` | Đã quay ra người trúng nên không huỷ được. Hãy quay tiếp hoặc công bố. |
| D331 | `NAMES_REQUIRED` | Dán ít nhất một tên (mỗi dòng một người). |
| D332 | `EVENT_REQUIRED` | Chọn một buổi của CLB. |
| D333 | `INVALID_SPONSOR` | Tên nhà tài trợ tối đa 80 ký tự; logo phải là ảnh https. |
| D334 | `FORBIDDEN` | Bạn không có quyền làm việc này. |

**features/game/api/gameApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D335 | `PROMO_INVALID` | Mã không đúng hoặc đã hết hạn. |
| D336 | `PROMO_USED_UP` | Mã đã hết lượt sử dụng. |
| D337 | `PROMO_ALREADY_USED` | Bạn đã dùng mã này rồi. |
| D338 | `PROMO_NOT_ELIGIBLE` | Mã này không dành cho tài khoản của bạn. |
| D339 | `TOO_MANY_ATTEMPTS` | Bạn nhập sai quá nhiều lần. Thử lại sau 1 giờ. |
| D340 | `CANNOT_GIFT_SELF` | Không tự tặng quà cho chính mình được. |
| D341 | `GIFT_DAILY_LIMIT` | Bạn đã tặng quà tối đa trong hôm nay. Mai tiếp nhé! |
| D342 | `GIFT_NOT_AVAILABLE` | Quà này hiện không còn (hết mùa hoặc đã ngừng). |
| D343 | `GIFT_CONTEXT_REQUIRED` | Quà này chỉ tặng được trên bài chạy đạt đúng mốc (5K, 10K, Half, Full, Ultra hoặc kỷ lục cá nhân). |
| D344 | `VIP_REQUIRED` | Quà này dành cho thành viên VIP. |
| D345 | `INVALID_QTY` | Số lượng quà không hợp lệ. |
| D346 | `CHEER_REPLACED_BY_GIFTS` | Tặng Xu trực tiếp đã được thay bằng Quà tặng. Hãy cập nhật ứng dụng. |
| D347 | `INSUFFICIENT_BALANCE` | Số Xu trong ví không đủ. |
| D348 | `SHIELD_LIMIT` | Bạn đã có số khiên tối đa. |
| D349 | `INSUFFICIENT_SHINE` | Tỏa sáng khả dụng chưa đủ. |
| D350 | `SHINE_LIMIT` | Bạn đã đổi món này đủ số lần trong kỳ. |
| D351 | `SHINE_NEED_SENDERS` | Cần Tỏa sáng từ đủ số người tặng khác nhau trong 30 ngày. |
| D352 | `SHINE_ONLY` | Vật phẩm này chỉ đổi bằng Tỏa sáng. |
| D353 | `SHINE_ITEM_NOT_FOUND` | Món này không còn trong cửa hàng Tỏa sáng. |
| D354 | `ALREADY_OWNED` | Bạn đã có vật phẩm này. |
| D355 | `ALREADY_THANKED` | Hôm nay bạn đã cảm ơn người này rồi. |
| D356 | `NOT_A_SUPPORTER` | Chỉ cảm ơn được người đã tặng quà cho bạn trong 30 ngày. |
| D357 | `THANKS_LIMIT` | Hôm nay bạn đã gửi đủ lời cảm ơn. |
| D358 | `INVALID_AMOUNT` | Số Xu không hợp lệ (1–10). |
| D359 | `INVALID_GOAL` | Mục tiêu tuần từ 1 đến 7 ngày. |
| D360 | `MESSAGE_TOO_LONG` | Lời nhắn tối đa 140 ký tự. |
| D361 | `USER_NOT_FOUND` | Không tìm thấy người nhận. |
| D362 | `FORBIDDEN` | Bạn không có quyền làm việc này. |

**features/help/api/helpApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D363 | `PAGE_NOT_FOUND` | Không tìm thấy trang. |
| D364 | `INVALID_SLUG` | Đường dẫn chỉ gồm chữ thường không dấu, số và dấu gạch ngang (2–60 ký tự). |
| D365 | `INVALID_SECTION` | Chọn nhóm cho trang. |
| D366 | `INVALID_TITLE` | Tiêu đề cần 2–120 ký tự. |
| D367 | `FORBIDDEN` | Chỉ quản trị viên hệ thống mới sửa được. |

**features/knowledge/api/knowledgeApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D368 | `ARTICLE_NOT_FOUND` | Không tìm thấy bài viết (có thể đã gỡ hoặc chưa đăng). |
| D369 | `EXPERT_REVIEW_REQUIRED` | Bài thuộc chủ đề sức khoẻ / giáo án — cần chuyên gia duyệt chuyên môn trước khi đăng. |
| D370 | `TITLE_TOO_SHORT` | Tiêu đề cần ít nhất 5 ký tự. |
| D371 | `INVALID_SLUG` | Đường dẫn bài không hợp lệ. |
| D372 | `SLUG_TAKEN` | Đường dẫn này đã có bài khác dùng — đổi tiêu đề hoặc đường dẫn. |
| D373 | `INVALID_CATEGORY` | Chọn chuyên mục. |
| D374 | `INVALID_URL` | Link ảnh / nguồn phải bắt đầu bằng https:// |
| D375 | `BODY_TOO_SHORT` | Nội dung quá ngắn để đăng. |
| D376 | `INVALID_SCHEDULE` | Giờ hẹn đăng phải ở tương lai. |
| D377 | `CANNOT_REVIEW_OWN` | Không tự duyệt chuyên môn bài của mình. |
| D378 | `NOTE_REQUIRED` | Ghi rõ góp ý để người viết sửa. |
| D379 | `ARCHIVE_INSTEAD` | Bài đã từng đăng — hãy Lưu trữ thay vì xoá (giữ link và thống kê). |
| D380 | `IMAGE_TYPE` | Chỉ nhận ảnh JPG, PNG, WEBP. |
| D381 | `IMAGE_SIZE` | Ảnh tối đa 5 MB. |
| D382 | `FORBIDDEN` | Bạn không có quyền làm việc này. |

**features/market/api/bibApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D383 | `NOT_ELIGIBLE` | Cần ít nhất 3 bài chạy hợp lệ để đăng tin BIB (chống tài khoản ảo, lừa đảo). |
| D384 | `PRICE_ABOVE_ORIGINAL` | Chợ BIB không cho bán cao hơn giá gốc — giúp runner mua đúng giá. |
| D385 | `PRICE_REQUIRED` | Nhập giá gốc và giá nhượng. |
| D386 | `CONTACT_REQUIRED` | Nhập ít nhất một cách liên hệ hợp lệ (số điện thoại, Zalo hoặc link Facebook). |
| D387 | `RACE_DATE_PAST` | Ngày giải đã qua. |
| D388 | `RACE_REQUIRED` | Nhập tên giải. |
| D389 | `INVALID_DISTANCE` | Chọn cự ly. |
| D390 | `NO_LINKS` | Ghi chú không được chứa link (trừ Facebook). |
| D391 | `TOO_MANY_LISTINGS` | Mỗi runner tối đa 5 tin đang mở. Đóng bớt tin cũ nhé. |
| D392 | `TOO_MANY_REVEALS` | Bạn đã xem liên hệ của nhiều tin trong 24 giờ. Thử lại sau. |
| D393 | `LISTING_NOT_FOUND` | Tin không còn tồn tại. |
| D394 | `LISTING_HIDDEN` | Tin đang bị ẩn — chờ quản trị viên xem xét. |
| D395 | `RATE_LIMITED` | Bạn đăng hơi nhiều trong hôm nay. Thử lại sau. |
| D396 | `FORBIDDEN` | Bạn không có quyền làm việc này. |

**features/market/api/marketApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D397 | `PARTNER_EXISTS` | Bạn đã có hồ sơ loại này — hãy sửa hồ sơ hiện có. |
| D398 | `PARTNER_NOT_FOUND` | Không tìm thấy hồ sơ (có thể chưa được xác minh hoặc đã bị ẩn). |
| D399 | `INVALID_PARTNER_IMAGE` | Ảnh phải tải lên từ RaceHub. |
| D400 | `INVALID_PARTNER` | Nhập tên hồ sơ (ít nhất 2 ký tự) và chọn loại. |
| D401 | `INVALID_CONTACT` | Liên hệ chưa đúng: điện thoại 8–16 số; Facebook / website bắt đầu bằng https://; email hợp lệ. |
| D402 | `TOO_MANY_SERVICES` | Tối đa 12 dịch vụ. |
| D403 | `REASON_REQUIRED` | Nhập lý do (ít nhất 3 ký tự) để chủ hồ sơ biết cần sửa gì. |
| D404 | `FORBIDDEN` | Bạn không có quyền sửa hồ sơ này. |

**features/nearby/api/nearbyApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D405 | `CONSENT_REQUIRED` | Cần đồng ý điều khoản chia sẻ vị trí gần đúng trước khi bật. |
| D406 | `NOT_ELIGIBLE` | Cần ít nhất 3 bài chạy hợp lệ để bật Quanh đây (chống tài khoản ảo). |
| D407 | `NEARBY_SUSPENDED` | Quanh đây của bạn đang tạm khoá do có báo cáo, chờ quản trị viên xem xét. |
| D408 | `NEARBY_DISABLED` | Bạn chưa bật Quanh đây. |
| D409 | `NO_PRESENCE` | Hãy chọn vị trí gần đúng của bạn để tìm runner quanh đây. |
| D410 | `TOO_MANY_MOVES` | Bạn đã đổi vị trí 3 lần trong 24 giờ. Thử lại sau (bảo vệ quyền riêng tư của mọi người). |
| D411 | `TOO_MANY_SEARCHES` | Bạn tìm quá nhiều lần trong 1 giờ. Nghỉ chút rồi thử lại. |
| D412 | `INVALID_LOCATION` | Vị trí không hợp lệ. |
| D413 | `TARGET_UNAVAILABLE` | Runner này hiện không nhận kết nối. |
| D414 | `ALREADY_CONNECTED` | Hai bạn đã kết nối. |
| D415 | `ALREADY_REQUESTED` | Bạn đã gửi lời mời, chờ người kia trả lời. |
| D416 | `REQUEST_COOLDOWN` | Lời mời trước bị từ chối — 30 ngày sau mới gửi lại được. |
| D417 | `TOO_MANY_REQUESTS` | Bạn đã gửi đủ số lời mời hôm nay. Mai gửi tiếp nhé. |
| D418 | `NO_LINKS` | Lời nhắn không được chứa link, số Zalo / Telegram. Kết nối xong hãy rủ nhau vào buổi chạy. |
| D419 | `NOT_CONNECTED` | Chỉ rủ được người đã kết nối. |
| D420 | `REQUEST_CLOSED` | Lời mời đã được xử lý. |
| D421 | `EVENT_FULL` | Buổi chạy đã đủ người. |
| D422 | `EVENT_ENDED` | Buổi chạy đã kết thúc. |
| D423 | `EVENT_CANCELLED` | Buổi chạy đã bị huỷ. |
| D424 | `EVENT_NOT_FOUND` | Không tìm thấy buổi chạy (có thể đã chuyển về chỉ thành viên CLB). |
| D425 | `EVENT_NEEDS_LOCATION` | Buổi chạy công khai cần toạ độ điểm hẹn (nơi công cộng). |
| D426 | `EVENT_NOT_PUBLIC` | Người này không thuộc CLB đó — chỉ rủ được vào buổi chạy công khai. |
| D427 | `FORBIDDEN` | Bạn không có quyền làm việc này. |

**features/org/api/orgApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D428 | `NAME_REQUIRED` | Hãy nhập tên người liên hệ. |
| D429 | `ORG_NAME_REQUIRED` | Hãy nhập tên tổ chức (ít nhất 2 ký tự). |
| D430 | `INVALID_PHONE` | Số điện thoại chưa đúng. |
| D431 | `RATE_LIMITED` | Bạn đã gửi nhiều yêu cầu hôm nay. Chúng tôi sẽ liên hệ sớm. |
| D432 | `OWNER_NOT_FOUND` | Không tìm thấy tài khoản với email này. Người quản trị cần đăng ký RaceHub trước. |
| D433 | `ORG_NOT_FOUND` | Không tìm thấy tổ chức. |
| D434 | `NOT_DEMO` | Chỉ xoá được tổ chức demo. |
| D435 | `NOT_A_MEMBER` | Bạn chưa là thành viên tổ chức này. |
| D436 | `INVALID_CODE` | Mã mời không đúng hoặc đã được đổi. |
| D437 | `ORG_INACTIVE` | Gói của tổ chức đã hết hạn hoặc tạm dừng. Liên hệ quản trị tổ chức. |
| D438 | `ORG_FULL` | Tổ chức đã đủ số chỗ theo hợp đồng. Quản trị tổ chức cần nâng số chỗ. |
| D439 | `OWNER_CANNOT_LEAVE` | Người sở hữu tổ chức không thể rời. Liên hệ RaceHub để chuyển quyền. |
| D440 | `UNIT_EXISTS` | Tên đơn vị đã có. |
| D441 | `UNIT_LIMIT` | Tối đa 500 đơn vị. |
| D442 | `INVALID_NAME` | Tên không hợp lệ. |
| D443 | `INVALID_UNIT_LABEL` | Tên gọi đơn vị dài 2–30 ký tự. |
| D444 | `TAGLINE_TOO_LONG` | Khẩu hiệu tối đa 80 ký tự. |
| D445 | `INVALID_URL` | Link ảnh phải bắt đầu bằng https:// |
| D446 | `CLUB_NOT_FOUND` | Không tìm thấy CLB. |
| D447 | `CLUB_IN_ORG` | CLB này đang thuộc một tổ chức khác. |
| D448 | `ALREADY_INVITED` | Đã mời CLB này rồi. |
| D449 | `ORG_CLUB_LIMIT` | Đã đủ số CLB theo hợp đồng. |
| D450 | `INVITE_NOT_FOUND` | Lời mời không còn hiệu lực. |
| D451 | `TITLE_REQUIRED` | Tên chiến dịch cần 3–120 ký tự. |
| D452 | `INVALID_METRIC` | Cách tính không hợp lệ. |
| D453 | `INVALID_TIME_RANGE` | Thời gian không hợp lệ (tối đa 1 năm). |
| D454 | `REASON_REQUIRED` | Hãy ghi lý do (ít nhất 3 ký tự). |
| D455 | `MEMBER_NOT_FOUND` | Không tìm thấy thành viên. |
| D456 | `IMAGE_TYPE` | Chỉ nhận ảnh JPG, PNG hoặc WebP. |
| D457 | `IMAGE_SIZE` | Ảnh quá lớn, hãy chọn ảnh khác. |
| D458 | `FORBIDDEN` | Bạn không có quyền làm việc này. |
| D459 | `DOMAIN_REQUIRED_LIST` | Bật "chỉ nhận email công ty" cần khai báo ít nhất một tên miền. |
| D460 | `DOMAIN_REQUIRED` | Tổ chức chỉ nhận tài khoản dùng email công ty. Hãy đăng nhập bằng email công ty. |
| D461 | `INVALID_DOMAIN` | Tên miền không hợp lệ (vd: congty.vn), tối đa 10 tên miền. |
| D462 | `PUBLIC_DOMAIN` | Không dùng tên miền email công cộng (gmail, yahoo…). |
| D463 | `UNIT_CYCLE` | Không thể đặt đơn vị làm con của chính nó. |
| D464 | `UNIT_DEPTH` | Tối đa 4 cấp đơn vị. |
| D465 | `UNIT_REQUIRED` | Gán đơn vị trước khi chọn làm trưởng đơn vị. |
| D466 | `INVALID_ROWS` | Danh sách không hợp lệ (tối đa 5.000 dòng). |
| D467 | `CAMPAIGN_LOCKED` | Chiến dịch đã chốt kết quả, không sửa được. |
| D468 | `CAMPAIGN_NOT_ENDED` | Chiến dịch chưa kết thúc. |
| D469 | `CAMPAIGN_NOT_LOCKED` | Hãy chốt kết quả trước khi duyệt. |
| D470 | `TOO_MANY_BOOST_DAYS` | Tối đa 20 ngày hội. |
| D471 | `NOT_ELIGIBLE` | Bạn chưa đủ điều kiện nhận chứng nhận. |
| D472 | `CERT_DISABLED` | Chiến dịch không cấp chứng nhận. |
| D473 | `INVALID_CERT_IMAGE` | Ảnh chứng nhận phải tải lên từ kho ảnh của tổ chức. |
| D474 | `INVALID_CERT_DESIGN` | Mẫu chứng nhận không hợp lệ. |
| D475 | `POSTS_ADMIN_ONLY` | Chỉ quản trị tổ chức được đăng bài. |
| D476 | `EMPTY_POST` | Hãy viết nội dung. |
| D477 | `EMPTY_COMMENT` | Hãy viết bình luận. |
| D478 | `NOT_AUTHOR` | Chỉ người viết mới sửa được bình luận này. |
| D479 | `COMMENT_NOT_FOUND` | Bình luận không còn nữa. |
| D480 | `POST_NOT_FOUND` | Bài đăng không còn. |
| D481 | `INVALID_IMAGE_PATH` | Ảnh không hợp lệ, hãy tải lại. |

**features/profile/api/profileApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D482 | `INVALID_NAME` | Tên hiển thị cần từ 2 đến 40 ký tự. |
| D483 | `INVALID_BIO` | Giới thiệu tối đa 160 ký tự. |
| D484 | `INVALID_GENDER` | Giới tính không hợp lệ. |
| D485 | `INVALID_BIRTH_DATE` | Ngày sinh không hợp lệ (bạn cần từ 10 tuổi trở lên). |
| D486 | `INVALID_HEIGHT` | Chiều cao cần từ 100 đến 250 cm. |
| D487 | `INVALID_WEIGHT` | Cân nặng cần từ 25 đến 250 kg. |
| D488 | `INVALID_PROFILE` | Thông tin hồ sơ không hợp lệ. |

**features/profile/components/SettingsScreen.tsx**

| # | Mã | Câu báo |
|---|---|---|
| D489 | `CONFIRM_REQUIRED` | Gõ đúng chữ XOÁ để xác nhận. |
| D490 | `ADMIN_CANNOT_DELETE` | Tài khoản quản trị viên cần được gỡ quyền quản trị trước khi xoá. |
| D491 | `TRANSFER_CLUB_FIRST` | Bạn đang là chủ nhiệm CLB còn thành viên — hãy chuyển quyền chủ nhiệm cho người khác trước. |

**features/race/api/raceApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D492 | `FORBIDDEN` | Bạn không có quyền làm việc này. |
| D493 | `APP_OUTDATED` | Ứng dụng vừa được cập nhật — tải lại trang rồi lưu lại thiết kế. |
| D494 | `RACE_ORGANIZER_REQUIRED` | Chỉ CLB hoặc cá nhân được RaceHub cấp quyền mới tạo được giải chạy. Liên hệ admin để đăng ký. |
| D495 | `CAPACITY_REQUIRED` | Chọn quy mô (số VĐV tối đa) — phí tạo giải tính theo quy mô. |
| D496 | `INSUFFICIENT_BALANCE` | Ví của bạn không đủ Xu trả phí tạo giải. |
| D497 | `INSUFFICIENT_TREASURY` | Quỹ CLB không đủ Xu trả phí tạo giải. |
| D498 | `RACE_NOT_FOUND` | Không tìm thấy giải (hoặc giải chỉ dành cho thành viên CLB). |
| D499 | `RACE_CANCELLED` | Giải đã bị hủy. |
| D500 | `REGISTRATION_CLOSED` | Đã hết hạn đăng ký. |
| D501 | `RACE_FULL` | Giải đã đủ số VĐV. |
| D502 | `INVALID_DISTANCE` | Cự ly không có trong giải. |
| D503 | `RACE_STARTED` | Giải đã bắt đầu, không rút tên được nữa. |
| D504 | `NOT_REGISTERED` | Bạn chưa đăng ký giải này. |
| D505 | `INVALID_TITLE` | Tên giải cần từ 3 đến 120 ký tự. |
| D506 | `INVALID_TIME_RANGE` | Thời gian kết thúc phải sau thời gian bắt đầu. |
| D507 | `INVALID_DURATION` | Giải kéo dài tối đa 3 tháng và chưa kết thúc. |
| D508 | `INVALID_REG_CLOSE` | Hạn đăng ký phải trước khi giải kết thúc. |
| D509 | `INVALID_AUDIENCE` | Giải nội bộ cần chọn CLB. |
| D510 | `INVALID_MAX` | Số VĐV tối đa từ 2 đến 100.000. |
| D511 | `INVALID_BIB_PREFIX` | Tiền tố BIB chỉ gồm chữ và số, tối đa 6 ký tự. |
| D512 | `INVALID_DISTANCES` | Chọn 1–6 cự ly, mỗi cự ly từ 1 đến 250 km. |
| D513 | `INVALID_BIB_DESIGN` | Thiết kế BIB không hợp lệ. |
| D514 | `INVALID_BIB_IMAGE` | Ảnh phải được tải lên từ trình thiết kế BIB của giải này. |
| D515 | `INVALID_IMAGE_TYPE` | Chỉ nhận ảnh PNG, JPG hoặc WebP. |
| D516 | `IMAGE_TOO_LARGE` | Ảnh quá lớn, không nén được. Thử ảnh nhỏ hơn. |
| D517 | `AUTH_REQUIRED` | Phiên đăng nhập đã hết, vui lòng đăng nhập lại. |

**features/referral/api/referralApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D518 | `AUTH_REQUIRED` | Bạn cần đăng nhập để nhận lời mời. |
| D519 | `CANNOT_REFER_SELF` | Bạn không thể tự giới thiệu chính mình. |
| D520 | `ALREADY_REFERRED` | Tài khoản của bạn đã nhận lời mời của người khác trước đó. |
| D521 | `REFERRER_NOT_FOUND` | Mã giới thiệu không đúng. Kiểm tra lại 8 ký tự trên link / tin nhắn mời. |
| D522 | `REFERRAL_WINDOW_EXPIRED` | Chỉ nhập được mã giới thiệu trong 14 ngày đầu sau khi tạo tài khoản. |

**features/social/api/socialApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D523 | `SPAM` | Làm phiền / spam |
| D524 | `INVALID_TARGET` | Không thực hiện được với chính bạn. |
| D525 | `USER_NOT_FOUND` | Không tìm thấy runner này. |
| D526 | `BLOCKED` | Hai bạn đang chặn nhau nên không làm được việc này. |
| D527 | `DM_NOT_ALLOWED` | Chỉ nhắn được khi người này theo dõi bạn, là bạn kết nối, cùng CLB hoặc đã từng nhắn cho bạn. |
| D528 | `RATE_LIMITED` | Bạn thao tác hơi nhanh. Nghỉ một chút rồi thử lại nhé. |
| D529 | `EMPTY_MESSAGE` | Tin nhắn đang trống (tối đa 2000 ký tự). |
| D530 | `NOT_AUTHOR` | Chỉ người gửi mới thu hồi được tin này. |
| D531 | `NOT_FOUND` | Tin nhắn không còn nữa. |
| D532 | `INVALID_REASON` | Hãy chọn lý do báo cáo. |

**features/system/api/systemApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D533 | `INVALID_LEVEL` | Mức thông báo không hợp lệ. |
| D534 | `INVALID_TITLE` | Tiêu đề cần 2–80 ký tự. |
| D535 | `INVALID_MESSAGE` | Nội dung tối đa 500 ký tự. |
| D536 | `INVALID_TIME_RANGE` | Thời điểm tự tắt phải ở tương lai. |
| D537 | `FORBIDDEN` | Chỉ quản trị hệ thống mới làm được việc này. |
| D538 | `INVALID_CONFIG` | Giá trị ngoài giới hạn cho phép — kiểm tra lại các ô vừa sửa. |
| D539 | `VERSION_NOT_FOUND` | Không tìm thấy phiên bản này. |

**features/voucher/api/voucherApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D540 | `FORBIDDEN` | Chỉ Ban tổ chức thử thách hoặc admin mới làm được việc này. |
| D541 | `INVALID_URL` | Đường link / logo phải bắt đầu bằng https:// |
| D542 | `INVALID_VOUCHER_CODE` | Nhập mã chung (ít nhất 3 ký tự). |
| D543 | `INVALID_VOUCHER` | Thông tin voucher chưa hợp lệ (Top N từ 1 đến 100, chỉ áp cho thử thách). |
| D544 | `TOO_MANY_CODES` | Tối đa 5.000 mã mỗi lần dán. |
| D545 | `VOUCHER_NOT_FOUND` | Không tìm thấy voucher. |

**shared/lib/errors.ts**

| # | Mã | Câu báo |
|---|---|---|
| D546 | `AUTH_REQUIRED` | Bạn cần đăng nhập để tiếp tục. |
| D547 | `FORBIDDEN` | Bạn không có quyền thực hiện thao tác này. |
| D548 | `INSUFFICIENT_BALANCE` | Số dư Xu không đủ. |
| D549 | `INSUFFICIENT_FUNDS` | Số dư Xu không đủ. |
| D550 | `INVALID_TITLE` | Tên thử thách cần từ 3 đến 120 ký tự. |
| D551 | `INVALID_TIME_RANGE` | Thời gian kết thúc phải sau thời gian bắt đầu. |
| D552 | `INVALID_MAX_SLOTS` | Số người tham gia tối đa không hợp lệ (1 – 10.000). |
| D553 | `INVALID_DISTANCE` | Cự ly không hợp lệ. |
| D554 | `INVALID_PACE` | Khoảng pace không hợp lệ. |
| D555 | `INVALID_CHALLENGE_TYPE` | Loại thử thách không hợp lệ. |
| D556 | `IDEMPOTENCY_KEY_REQUIRED` | Yêu cầu không hợp lệ, vui lòng thử lại. |
| D557 | `ACTIVITY_DUPLICATE` | Bài chạy này đã được lưu trước đó. |
| D558 | `RATE_LIMITED` | Bạn thao tác quá nhanh, thử lại sau ít phút. |
| D559 | `NOT_A_MEMBER` | Bạn chưa là thành viên CLB này. |

## E. Thông báo nhanh (toast)

| # | Kiểu | Câu | Vị trí |
|---|---|---|---|
| E1 | success | Kết nối Strava thành công! | `app/(app)/me/page.tsx:36` |
| E2 | success | Đã nhận lời mời của ${r.referrer_name}! Chạy đủ km đầu tiên để cả hai nhận Xu 🎉 | `app/join/[code]/page.tsx:24` |
| E3 | error | Mật khẩu cần ít nhất 8 ký tự. | `app/reset-password/page.tsx:23` |
| E4 | error | Mật khẩu nhập lại không khớp. | `app/reset-password/page.tsx:24` |
| E5 | error | Không đặt được mật khẩu: | `app/reset-password/page.tsx:28` |
| E6 | success | Đã cập nhật mật khẩu | `app/reset-password/page.tsx:29` |
| E7 | error | Không thực hiện được. Hãy thử lại. | `features/activity/components/ReviewNotice.tsx:31` |
| E8 | error | Không tạo được ảnh. Thử lại. | `features/activity/components/ShareActivity.tsx:43` |
| E9 | error | Không chia sẻ được. Hãy tải ảnh về rồi đăng. | `features/activity/components/ShareActivity.tsx:57` |
| E10 | success | Đã xóa CLB ${club.name} | `features/admin/components/ClubsProTab.tsx:109` |
| E11 | success | Đã chép | `features/admin/components/SystemTab.tsx:220` |
| E12 | success | Đã cập nhật trang Gói (chính sách vận hành bản v${v}) | `features/admin/components/commerce/FreePlansEditor.tsx:51` |
| E13 | success | Đã lưu quà | `features/admin/components/commerce/GiftsTab.tsx:40` |
| E14 | success | Đã kết thúc chương trình — giá về giá gốc | `features/admin/components/commerce/ItemPromos.tsx:48` |
| E15 | success | Đã lưu gói nạp Xu | `features/admin/components/commerce/PlansTab.tsx:149` |
| E16 | success | Đã cấp ${code} ${MONTH_LABEL[months]} cho ${target?.name} | `features/admin/components/commerce/PlansTab.tsx:191` |
| E17 | success | Đã lưu tài khoản nhận tiền | `features/admin/components/commerce/PlansTab.tsx:52` |
| E18 | success | Đã lưu ${name} | `features/admin/components/commerce/PlansTab.tsx:96` |
| E19 | success | Đã tặng cho ${formatNumber(r.recipients)} người | `features/admin/components/commerce/PromotionsTab.tsx:138` |
| E20 | success | Đã tạo mã ${code} | `features/admin/components/commerce/PromotionsTab.tsx:166` |
| E21 | success | Đã bật đợt giảm giá | `features/admin/components/commerce/PromotionsTab.tsx:201` |
| E22 | success | Đã cập nhật | `features/admin/components/commerce/PromotionsTab.tsx:241` |
| E23 | error | Hãy chọn một CLB | `features/admin/components/commerce/PromotionsTab.tsx:73` |
| E24 | success | Đã lưu nhiệm vụ | `features/admin/components/commerce/QuestsTab.tsx:32` |
| E25 | success | Đã lưu giới hạn | `features/admin/components/commerce/QuestsTab.tsx:90` |
| E26 | success | Đã lưu | `features/admin/components/commerce/ShineAdmin.tsx:25` |
| E27 | success | Đã lưu cài đặt | `features/admin/components/commerce/ShineAdmin.tsx:26` |
| E28 | success | Đã hủy thử thách và báo người tham gia | `features/admin/components/console/ChallengesTab.tsx:66` |
| E29 | error | Hãy ghi lý do (ít nhất 3 ký tự). | `features/admin/components/console/ChallengesTab.tsx:72` |
| E30 | error | Không tạo được file Excel, thử lại. | `features/admin/components/console/GpsQaTab.tsx:76` |
| E31 | success | Đã áp dụng chính sách vận hành bản v${v} | `features/admin/components/console/OpsPolicyTab.tsx:104` |
| E32 | success | Đã khôi phục — đang dùng bản v${v} | `features/admin/components/console/OpsPolicyTab.tsx:242` |
| E33 | success | Đã chuyển chính sách · ${formatNumber(r.changed)} bài Strava được cập nhật | `features/admin/components/console/StravaTab.tsx:28` |
| E34 | error | Ghi lý do (ít nhất 3 ký tự) | `features/admin/components/console/StravaTab.tsx:60` |
| E35 | error | Hãy ghi lý do (ít nhất 3 ký tự). | `features/admin/components/console/UsersTab.tsx:164` |
| E36 | success | Đã tặng ${qty} lượt tạo cho ${target.name} | `features/admin/components/economy/PassesTab.tsx:38` |
| E37 | success | Đã thu hồi vé | `features/admin/components/economy/PassesTab.tsx:49` |
| E38 | success | Đã áp dụng chính sách phiên bản ${v} | `features/admin/components/economy/PolicyTab.tsx:79` |
| E39 | success | Đã lưu bộ sưu tập | `features/admin/components/items/CollectionsPanel.tsx:69` |
| E40 | success | Đã tạo bộ ${name.trim()} (${items.length} món) | `features/admin/components/items/KitSheet.tsx:59` |
| E41 | success | Đã duyệt ${name.trim()} | `features/admin/components/items/UniformReviewPanel.tsx:103` |
| E42 | success | Đã trả lại mẫu cho CLB | `features/admin/components/items/UniformReviewPanel.tsx:150` |
| E43 | success | Đã chép ${label.toLowerCase()} | `features/billing/components/OrderSheet.tsx:25` |
| E44 | success | Đã hủy đơn | `features/billing/components/OrderSheet.tsx:46` |
| E45 | success | Đã sao chép link mời | `features/challenge/components/detail/ChallengeDetailScreen.tsx:553` |
| E46 | error | Không sao chép được, hãy chọn và sao chép thủ công. | `features/challenge/components/detail/ChallengeDetailScreen.tsx:553` |
| E47 | success | Đã đổi hạn đăng ký | `features/challenge/components/detail/ChallengeExtras.tsx:30` |
| E48 | success | Đã lưu hạng mục của bạn | `features/challenge/components/detail/ConquestPanel.tsx:63` |
| E49 | success | Đã chia đội và báo cho mọi người | `features/challenge/components/detail/PledgePanel.tsx:175` |
| E50 | success | Đã lưu mục tiêu của bạn | `features/challenge/components/detail/PledgePanel.tsx:52` |
| E51 | success | Đã lưu thể lệ | `features/challenge/components/detail/RulesInfo.tsx:100` |
| E52 | success | Đã lưu thiết kế vinh danh | `features/challenge/components/honor/HonorDesigner.tsx:51` |
| E53 | success | Đã đổi ảnh vinh danh | `features/challenge/components/honor/HonorPanel.tsx:176` |
| E54 | success | Đã đổi ảnh | `features/challenge/components/honor/HonorPanel.tsx:228` |
| E55 | success | Đã lưu hạng mục vinh danh | `features/challenge/components/honor/HonorSetup.tsx:37` |
| E56 | error | Đã tạo thử thách nhưng chưa bật được mục tiêu tự đăng ký: ${challengeErrorMessage(e)} | `features/challenge/components/wizard/CreateChallengeScreen.tsx:105` |
| E57 | error | Đã tạo thử thách nhưng chưa lưu được thể lệ (sửa lại ở tab Luật chơi): ${challengeErrorMessage(e)} | `features/challenge/components/wizard/CreateChallengeScreen.tsx:109` |
| E58 | error | Đã tạo thử thách nhưng chưa bật được tự lặp lại: ${challengeErrorMessage(e)} | `features/challenge/components/wizard/CreateChallengeScreen.tsx:113` |
| E59 | success | Đã chép luật từ "${t.title}" — kiểm tra lại rồi tạo | `features/challenge/components/wizard/CreateChallengeScreen.tsx:145` |
| E60 | error | Kiểm tra lại các ô được đánh dấu. | `features/challenge/components/wizard/CreateChallengeScreen.tsx:76` |
| E61 | error | Đã tạo thử thách nhưng chưa lưu được hạng mục: ${challengeErrorMessage(e)} | `features/challenge/components/wizard/CreateChallengeScreen.tsx:95` |
| E62 | error | Đã tạo thử thách nhưng chưa đặt được hạn đăng ký: ${challengeErrorMessage(e)} | `features/challenge/components/wizard/CreateChallengeScreen.tsx:99` |
| E63 | error | Tối đa 12 lớp in. | `features/character/components/GarmentDesigner.tsx:193` |
| E64 | error | Tối đa 12 lớp in. | `features/character/components/GarmentDesigner.tsx:198` |
| E65 | error | Ảnh tối đa 2 MB. | `features/character/components/GarmentDesigner.tsx:199` |
| E66 | error | Không tải được ảnh. Hãy thử lại. | `features/character/components/GarmentDesigner.tsx:202` |
| E67 | error | Không tìm được màu trong ảnh này. | `features/character/components/KitStudio.tsx:120` |
| E68 | success | Đã lấy màu CLB | `features/character/components/KitStudio.tsx:127` |
| E69 | error | Không đọc được ảnh. Thử ảnh PNG / JPG khác. | `features/character/components/KitStudio.tsx:129` |
| E70 | success | Đã gắn logo CLB lên ngực áo | `features/character/components/KitStudio.tsx:151` |
| E71 | error | Không lấy được logo CLB. Hãy tải ảnh logo lên. | `features/character/components/KitStudio.tsx:153` |
| E72 | error | Ảnh tối đa 2 MB. | `features/character/components/KitStudio.tsx:380` |
| E73 | error | Không tải được ảnh. Hãy thử lại. | `features/character/components/KitStudio.tsx:383` |
| E74 | error | Logo tối đa 2 MB. | `features/character/components/PrintFields.tsx:30` |
| E75 | success | Đã gửi bộ đồng phục | `features/character/components/UniformStudio.tsx:126` |
| E76 | success | Đã hủy yêu cầu | `features/character/components/UniformStudio.tsx:45` |
| E77 | success | Đã đủ bộ đồng phục | `features/character/components/Wardrobe.tsx:105` |
| E78 | success | Đã lưu bộ đồ | `features/character/components/Wardrobe.tsx:64` |
| E79 | success | Đã mua ${buying.name} | `features/character/components/Wardrobe.tsx:74` |
| E80 | success | Đang mặc thử ${it.name} tới ${new Date(r.expires_at).toLocaleDateString('vi-VN')} | `features/character/components/Wardrobe.tsx:82` |
| E81 | success | Đã nhận ${r.items} món trong ${bundle.title} | `features/character/components/Wardrobe.tsx:87` |
| E82 | success | Đã đăng tổng kết lên bảng tin | `features/club/components/admin/ClubDashboardScreen.tsx:141` |
| E83 | info | Đã sao chép | `features/club/components/chat/ClubChatScreen.tsx:122` |
| E84 | success | Đã hủy sự kiện | `features/club/components/events/ClubEventScreen.tsx:220` |
| E85 | success | Đã sao chép link tham gia | `features/club/components/events/ClubEventScreen.tsx:50` |
| E86 | error | Không sao chép được link. | `features/club/components/events/ClubEventScreen.tsx:50` |
| E87 | success | Đã sao chép link tham gia | `features/club/components/events/EventFormSheet.tsx:156` |
| E88 | error | Không sao chép được, hãy chọn và sao chép thủ công. | `features/club/components/events/EventFormSheet.tsx:156` |
| E89 | error | Không lấy được vị trí. Hãy bật định vị cho ứng dụng hoặc gõ tên địa điểm. | `features/club/components/events/PlaceField.tsx:63` |
| E90 | success | Đã đóng bình chọn | `features/club/components/events/Polls.tsx:68` |
| E91 | success | Đã ghi lựa chọn | `features/club/components/events/Polls.tsx:74` |
| E92 | success | Đã tạo bình chọn | `features/club/components/events/Polls.tsx:99` |
| E93 | success | Đã gửi thư mời tới ${to!.name} | `features/club/components/exchange/ExchangeScreen.tsx:184` |
| E94 | success | Đã sửa bình luận | `features/club/components/feed/CommentsSheet.tsx:37` |
| E95 | info | Tối đa ${MAX_POST_IMAGES} ảnh mỗi bài. | `features/club/components/feed/Composer.tsx:42` |
| E96 | success | Đã xóa bài | `features/club/components/feed/PostCard.tsx:223` |
| E97 | info | Đã hủy yêu cầu tham gia | `features/club/components/hub/ClubShell.tsx:170` |
| E98 | success | Đã tạo CLB. Mời mọi người vào thôi! | `features/club/components/hub/ClubsInboxScreen.tsx:150` |
| E99 | success | Đã bỏ ngày vàng | `features/club/components/leaderboard/BoostDays.tsx:23` |
| E100 | success | Đã gửi lời thách đấu | `features/club/components/leaderboard/ClubBattles.tsx:161` |
| E101 | success | Đã lưu luật bản ${v} và báo cả CLB | `features/club/components/leaderboard/ClubPoints.tsx:200` |
| E102 | success | Đã sao chép ${what} | `features/club/components/members/InvitePanel.tsx:44` |
| E103 | error | Không sao chép được, hãy chọn và sao chép thủ công. | `features/club/components/members/InvitePanel.tsx:44` |
| E104 | success | Đã xoá album | `features/club/components/photos/ClubPhotosScreen.tsx:103` |
| E105 | success | Đã cập nhật tường nhà CLB | `features/club/components/settings/BrandingEditor.tsx:31` |
| E106 | success | Đã đổi logo | `features/club/components/settings/ClubSettingsScreen.tsx:100` |
| E107 | success | Đã đổi mã mời. Link và QR cũ không còn dùng được. | `features/club/components/settings/ClubSettingsScreen.tsx:157` |
| E108 | success | Đã lưu | `features/club/components/settings/ClubSettingsScreen.tsx:181` |
| E109 | success | Đã lưu cài đặt thông báo | `features/club/components/settings/ClubSettingsScreen.tsx:64` |
| E110 | success | Đã lưu thông tin CLB | `features/club/components/settings/ClubSettingsScreen.tsx:95` |
| E111 | success | Đã ghi đơn — chuyển khoản để CLB xác nhận | `features/club/components/shop/ClubShopScreen.tsx:120` |
| E112 | success | Đã sao chép ${what} | `features/club/components/shop/ClubShopScreen.tsx:150` |
| E113 | success | Đã huỷ đơn | `features/club/components/shop/ClubShopScreen.tsx:91` |
| E114 | success | Đã báo thủ quỹ. Chờ xác nhận nhé! | `features/club/components/treasury/ClubFinance.tsx:190` |
| E115 | success | Đã nhắc ${n} người chưa đóng | `features/club/components/treasury/ClubFinance.tsx:203` |
| E116 | success | Đã sao chép ${what} | `features/club/components/treasury/ClubFinance.tsx:29` |
| E117 | error | Không sao chép được | `features/club/components/treasury/ClubFinance.tsx:29` |
| E118 | success | Đã hủy khoản | `features/club/components/treasury/ClubFinance.tsx:322` |
| E119 | success | Đã tạo kỳ thu phí | `features/club/components/treasury/ClubFinance.tsx:350` |
| E120 | success | Đã ghi vào sổ | `features/club/components/treasury/ClubFinance.tsx:377` |
| E121 | error | Ảnh tối đa 5 MB | `features/club/components/treasury/ClubFinance.tsx:393` |
| E122 | error | Hãy chọn một file ảnh. | `features/club/components/treasury/ClubFinance.tsx:409` |
| E123 | error | Ảnh tối đa 5 MB | `features/club/components/treasury/ClubFinance.tsx:410` |
| E124 | success | Đã lưu ảnh QR | `features/club/components/treasury/ClubFinance.tsx:411` |
| E125 | success | Đã gỡ tài khoản | `features/club/components/treasury/ClubFinance.tsx:422` |
| E126 | success | Đã lưu tài khoản | `features/club/components/treasury/ClubFinance.tsx:424` |
| E127 | success | Đã gỡ ảnh QR | `features/club/components/treasury/ClubFinance.tsx:440` |
| E128 | success | Cảm ơn bạn đã góp ${formatCoin(value)} Xu vào quỹ! | `features/club/components/treasury/ClubTreasuryScreen.tsx:93` |
| E129 | success | Đã tạo lượt quay | `features/draw/components/DrawPanel.tsx:199` |
| E130 | success | Đã sao chép kết quả — dán vào Zalo / Facebook | `features/draw/components/DrawPanel.tsx:84` |
| E131 | error | Không sao chép được | `features/draw/components/DrawPanel.tsx:84` |
| E132 | info | ${shown.name}: vắng mặt — quay lại ${shown.prize} | `features/draw/components/DrawStage.tsx:103` |
| E133 | success | Đã công bố kết quả và báo người trúng | `features/draw/components/DrawStage.tsx:113` |
| E134 | info | Trình duyệt này không hỗ trợ toàn màn hình | `features/draw/components/DrawStage.tsx:133` |
| E135 | success | Đã tặng ${toName} ${qty > 1 ? | `features/game/components/GiftButton.tsx:98` |
| E136 | success | ${r.title ?? 'Đã nhận khuyến mãi'}${parts.length ? | `features/game/components/PromoCodeForm.tsx:19` |
| E137 | success | Đã gửi lời cảm ơn tới ${u.display_name ?? 'runner'} 💛 | `features/game/components/ShineScreen.tsx:112` |
| E138 | success | Đã đổi ${r.name} | `features/game/components/ShineScreen.tsx:138` |
| E139 | success | Đã lưu | `features/game/components/ShineScreen.tsx:160` |
| E140 | success | Đã thêm 1 khiên giữ chuỗi | `features/game/components/StreakSheet.tsx:25` |
| E141 | success | Đã lưu trang | `features/help/components/HelpAdminTab.tsx:123` |
| E142 | success | Đã xoá trang (nội dung cũ lưu trong nhật ký quản trị) | `features/help/components/HelpAdminTab.tsx:128` |
| E143 | success | Đã lưu thông tin pháp nhân | `features/help/components/HelpAdminTab.tsx:82` |
| E144 | error | Trình duyệt chặn cửa sổ in — hãy cho phép popup. | `features/insights/components/InsightsScreen.tsx:213` |
| E145 | error | Không lưu được lựa chọn. Thử lại sau. | `features/integrations/strava/components/StravaShareCard.tsx:27` |
| E146 | success | Đã nhận ${s.imported} bài chạy mới từ Strava | `features/integrations/strava/components/StravaSyncCard.tsx:38` |
| E147 | warning | Không nhập bài nào: ${skipped.join('; ')}. | `features/integrations/strava/components/StravaSyncCard.tsx:69` |
| E148 | info | Không có bài chạy mới trên Strava. Bài vừa chạy có thể cần vài phút để Strava xử lý xong. | `features/integrations/strava/components/StravaSyncCard.tsx:70` |
| E149 | success | Đã nhập ${s.imported} bài chạy | `features/integrations/strava/components/StravaSyncCard.tsx:72` |
| E150 | success | Cảm ơn góp ý của bạn! | `features/knowledge/components/ArticleScreen.tsx:272` |
| E151 | success | Huy hiệu mới: Runner ham học 🎓 | `features/knowledge/components/ArticleScreen.tsx:53` |
| E152 | success | Đã đọc xong bài | `features/knowledge/components/ArticleScreen.tsx:54` |
| E153 | success | Đã sao chép link bài viết | `features/knowledge/components/ArticleScreen.tsx:99` |
| E154 | success | Đã tải ảnh | `features/knowledge/components/cms/ArticleEditor.tsx:111` |
| E155 | success | Đã gửi góp ý | `features/knowledge/components/cms/ArticleEditor.tsx:319` |
| E156 | success | Đã xoá | `features/knowledge/components/cms/ArticleEditor.tsx:326` |
| E157 | success | Đã thêm vào ban nội dung | `features/knowledge/components/cms/CmsScreen.tsx:261` |
| E158 | success | Đã lưu tác giả | `features/knowledge/components/cms/CmsScreen.tsx:283` |
| E159 | success | Đã cập nhật | `features/market/components/BibMarket.tsx:103` |
| E160 | success | Đã gửi báo cáo — quản trị viên sẽ xem xét | `features/market/components/BibMarket.tsx:173` |
| E161 | success | Đã gỡ CLB khỏi Quanh đây | `features/nearby/components/ClubPlaceSection.tsx:34` |
| E162 | success | Đã lưu khu vực CLB | `features/nearby/components/ClubPlaceSection.tsx:43` |
| E163 | success | Đã huỷ kết nối | `features/nearby/components/ConnectionsScreen.tsx:119` |
| E164 | success | Đã rút lời mời | `features/nearby/components/ConnectionsScreen.tsx:130` |
| E165 | success | Đã bỏ chặn ${name} | `features/nearby/components/ConnectionsScreen.tsx:145` |
| E166 | success | Đã bật Quanh đây | `features/nearby/components/EnableSheet.tsx:70` |
| E167 | error | Thiết bị không hỗ trợ định vị — hãy chạm trên bản đồ. | `features/nearby/components/LocationPicker.tsx:58` |
| E168 | error | Không lấy được vị trí. Bạn có thể chạm trên bản đồ để chọn khu vực. | `features/nearby/components/LocationPicker.tsx:62` |
| E169 | success | Đã ẩn bạn khỏi Quanh đây | `features/nearby/components/NearbyScreen.tsx:115` |
| E170 | success | Đã cập nhật khu vực | `features/nearby/components/NearbyScreen.tsx:130` |
| E171 | success | Đã rủ ${name} | `features/nearby/components/RunnerCard.tsx:118` |
| E172 | success | Đã gửi báo cáo | `features/nearby/components/RunnerCard.tsx:165` |
| E173 | success | Đã chặn ${name} | `features/nearby/components/RunnerCard.tsx:197` |
| E174 | success | Đã gửi. Thông báo sẽ hiện sau vài giây. | `features/notification/components/PushSettings.tsx:56` |
| E175 | success | Đã tắt thông báo trên thiết bị này | `features/notification/components/PushSettings.tsx:61` |
| E176 | success | Đã bật thông báo trên thiết bị này | `features/notification/components/PushSettings.tsx:63` |
| E177 | error | Bạn chưa cho phép thông báo. | `features/notification/components/PushSettings.tsx:64` |
| E178 | error | Chưa xóa được thông báo. Thử lại sau. | `features/notification/hooks/useNotifications.ts:39` |
| E179 | success | Đã bật thông báo | `features/onboarding/components/OnboardingScreen.tsx:289` |
| E180 | error | Bạn chưa cho phép thông báo. Có thể bật lại trong Cài đặt. | `features/onboarding/components/OnboardingScreen.tsx:290` |
| E181 | error | Không bật được thông báo. Thử lại trong Cài đặt. | `features/onboarding/components/OnboardingScreen.tsx:292` |
| E182 | error | Có lỗi, thử lại nhé. | `features/onboarding/components/OnboardingScreen.tsx:339` |
| E183 | success | Đã kết nối Strava! Bài chạy 30 ngày gần nhất đang được đồng bộ. | `features/onboarding/components/OnboardingScreen.tsx:42` |
| E184 | success | Đã huỷ chiến dịch | `features/org/components/CampaignScreen.tsx:38` |
| E185 | success | CLB đã rời tổ chức | `features/org/components/ClubOrgCard.tsx:27` |
| E186 | success | Đã vào tổ chức | `features/org/components/JoinOrgScreen.tsx:25` |
| E187 | success | Đã gửi yêu cầu — chờ quản trị tổ chức duyệt | `features/org/components/JoinOrgScreen.tsx:26` |
| E188 | success | Đã xoá tổ chức demo | `features/org/components/admin/EnterpriseAdminTab.tsx:177` |
| E189 | success | Đã tạo tổ chức · mã mời ${r.invite_code} | `features/org/components/admin/EnterpriseAdminTab.tsx:199` |
| E190 | success | Đã cập nhật gói | `features/org/components/admin/EnterpriseAdminTab.tsx:247` |
| E191 | success | Đã sửa bình luận | `features/org/components/tabs/FeedTab.tsx:158` |
| E192 | success | Đã lưu | `features/org/components/tabs/MembersTab.tsx:110` |
| E193 | error | Không tạo được file Excel, thử lại. | `features/org/components/tabs/MembersTab.tsx:177` |
| E194 | error | Không tạo được file mẫu, thử lại. | `features/org/components/tabs/MembersTab.tsx:205` |
| E195 | error | Không tạo được file Excel, thử lại. | `features/org/components/tabs/OverviewTab.tsx:56` |
| E196 | success | Đã lưu | `features/org/components/tabs/SettingsTab.tsx:129` |
| E197 | success | Đã lưu thông tin xuất hoá đơn | `features/org/components/tabs/SettingsTab.tsx:162` |
| E198 | success | Đã lưu tên miền | `features/org/components/tabs/SettingsTab.tsx:190` |
| E199 | success | Đã đổi mã mời — mã cũ hết hiệu lực | `features/org/components/tabs/SettingsTab.tsx:43` |
| E200 | error | Không sao chép được | `features/org/components/tabs/SettingsTab.tsx:47` |
| E201 | success | Đã lưu thương hiệu | `features/org/components/tabs/SettingsTab.tsx:79` |
| E202 | success | Đã gửi lời mời — chờ ban quản trị CLB đồng ý | `features/org/components/tabs/UnitsTab.tsx:160` |
| E203 | success | Đã đổi đơn vị | `features/org/components/tabs/UnitsTab.tsx:38` |
| E204 | success | Đã bỏ CLB khỏi tổ chức | `features/org/components/tabs/UnitsTab.tsx:43` |
| E205 | success | Đã đổi ảnh đại diện | `features/profile/components/AvatarPicker.tsx:50` |
| E206 | success | Đã gỡ ảnh đại diện | `features/profile/components/AvatarPicker.tsx:55` |
| E207 | error | Hãy chọn một file ảnh. | `features/profile/components/AvatarPicker.tsx:61` |
| E208 | error | Không đọc được ảnh này. Thử ảnh JPG hoặc PNG khác. | `features/profile/components/AvatarPicker.tsx:67` |
| E209 | error | Không tạo được ảnh từ nhân vật. Thử lại sau. | `features/profile/components/AvatarPicker.tsx:78` |
| E210 | error | Không hủy được kết nối Strava. Thử lại sau. | `features/profile/components/MeScreen.tsx:89` |
| E211 | success | Đã hủy kết nối Strava | `features/profile/components/MeScreen.tsx:90` |
| E212 | success | Đã xoá tài khoản. Cảm ơn bạn đã chạy cùng RaceHub. | `features/profile/components/SettingsScreen.tsx:212` |
| E213 | success | Đã cài RaceHub lên màn hình chính | `features/pwa/components/InstallApp.tsx:37` |
| E214 | success | Đã có mạng trở lại | `features/pwa/components/OfflineBanner.tsx:25` |
| E215 | success | Đã kết nối lại máy chủ | `features/pwa/components/OfflineBanner.tsx:27` |
| E216 | success | Đã lưu thiết kế BIB — VĐV thấy ngay | `features/race/components/BibDesigner.tsx:40` |
| E217 | success | Đã tạo giải | `features/race/components/CreateRaceScreen.tsx:62` |
| E218 | success | Đã hủy giải và báo cho VĐV | `features/race/components/RaceDetailScreen.tsx:283` |
| E219 | success | Đã rút tên | `features/race/components/RaceDetailScreen.tsx:92` |
| E220 | success | Đã ghi nhận lời mời của ${x.referrer_name} | `features/referral/components/InviteScreen.tsx:118` |
| E221 | success | Đã sao chép ${what} | `features/referral/components/InviteScreen.tsx:38` |
| E222 | error | Không sao chép được, hãy chọn và sao chép thủ công. | `features/referral/components/InviteScreen.tsx:38` |
| E223 | info | Đã bỏ bài chạy | `features/run/components/RunScreen.tsx:352` |
| E224 | success | Đã gửi bài chạy ${formatKm(item.payload.p_distance_m)} km lên RaceHub | `features/run/hooks/usePendingRuns.ts:55` |
| E225 | error | Không gửi được một bài chạy lưu trên máy | `features/run/hooks/usePendingRuns.ts:69` |
| E226 | info | Đã sao chép | `features/social/components/DirectChatScreen.tsx:111` |
| E227 | success | Đã theo dõi ${name} | `features/social/components/FollowPanel.tsx:33` |
| E228 | success | Đã gửi báo cáo | `features/social/components/ReportRunnerSheet.tsx:22` |
| E229 | success | Đã thêm ${r.added} mã${r.issued ? | `features/voucher/components/VoucherForm.tsx:25` |
| E230 | success | Đã lưu voucher tài trợ | `features/voucher/components/VoucherForm.tsx:29` |
| E231 | success | Đã sao chép mã | `features/voucher/components/VoucherWallet.tsx:47` |
| E232 | error | Tối đa ${max} phần tử | `shared/design/studio/Studio.tsx:73` |
| E233 | success | Đã tải ảnh về máy | `shared/ui/SaveImage.tsx:21` |
| E234 | success | Đã mở bảng chia sẻ — chọn "Lưu ảnh" để lưu vào máy | `shared/ui/SaveImage.tsx:22` |
