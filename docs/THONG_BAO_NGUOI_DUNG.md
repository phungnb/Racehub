# Toàn bộ câu chữ gửi đến người dùng

Tạo tự động bằng `python3 scripts/list-messages.py` — **không sửa tay**. Muốn đổi câu nào: gửi số mục (vd **A12**) hoặc chép câu cũ → câu mới.

`{…}` là phần tự điền (tên người, số km, số Xu…). Một số câu ghép theo điều kiện nên hiện dạng `{case when …}`.

Tổng: 128 thông báo · 7 lời báo bài chạy · 10 câu giọng HLV · 617 câu báo lỗi · 257 thông báo nhanh (toast).

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
| A10 | BADGE | Huy hiệu mới: {v_title} | — | `match_badge` |
| A11 | CHALLENGE_BOOST | Ngày vàng ×{trim(to_char(p_multiplier, 'FM9.9'))} ngày {to_char(p_day, 'DD/MM')}: {c.title} | {v_title} — km chạy trong ngày được nhân ×{trim(to_char(p_multiplier, 'FM9.9'))}. | `set_challenge_boost_day` |
| A12 | CHALLENGE_CANCELLED | RaceHub đã hủy thử thách: {c.title} | {trim(p_reason)} | `admin_cancel_challenge` |
| A13 | CHALLENGE_CANCELLED | Thử thách đã bị hủy: {c.title} | {p_reason} | `cancel_challenge` |
| A14 | CHALLENGE_JOINED | {display_name(v_uid)}{case when c.format = 'DUEL' then ' đã nh}{c.title} | — | `join_challenge` |
| A15 | CHALLENGE_JOINED | Đã chia đội: {c.title} | Bạn ở đội {m.name}. Mục tiêu đã khóa — chạy thôi! | `assign_pledge_teams` |
| A16 | CHALLENGE_NEW | Thử thách mới trong {coalesce(v_club_name, 'CLB')}: {v_title} | {case when v_reward > 0 then 'Giải thưởng}{v_reward}{' Xu. Vào tham gia ngay!' else 'Vào tham} | `create_challenge_v2` |
| A17 | CHALLENGE_RECUR_FAILED | Chưa tạo được kỳ mới: {left(c.title, 80)} | {case when sqlerrm like '%INSUFFICIENT%' }{left(sqlerrm, 120) end} | `spawn_next_occurrence` |
| A18 | CHALLENGE_RESULT | Kết quả: {c.title} | {case when r.profile_id = any(v_winners) }{r.final_rank end}{case when r.reward_xu > 0 then ' · +'}{r.reward_xu}{' Xu' else '' end} | `settle_challenge` |
| A19 | CHALLENGE_RULES | BTC cập nhật thể lệ: {c.title} | Xem lại phần Luật chơi để nắm thể lệ mới. | `set_challenge_rules` |
| A20 | CHAT_MENTION | {display_name(new.author_id)} nhắc đến bạn trong {coalesce(v_club, 'CLB')} | {left(new.body, 140)} | `after_club_message` |
| A21 | CLUB_ALBUM | Album chưa được duyệt | {a.title}{coalesce(': '}{nullif(trim(p_note), ''), '')} | `review_club_album` |
| A22 | CLUB_ALBUM | Album của bạn đã được duyệt | {a.title} | `review_club_album` |
| A23 | CLUB_ALBUM | Album ảnh mới: {v_title} | Xem ảnh trong tab Ảnh của CLB | `save_club_album` |
| A24 | CLUB_ALBUM | Link ảnh chờ duyệt | {display_name(v_uid)} gửi album "{v_title}" | `save_club_album` |
| A25 | CLUB_ANNOUNCEMENT | {coalesce(v_title, 'Thông báo mới từ CLB'} | {left(v_body, 140)} | `create_club_post` |
| A26 | CLUB_APPROVED | Bạn đã được duyệt vào {v_club.name} | Vào CLB để chào mọi người nhé! | `club_member_events` |
| A27 | CLUB_BATTLE | {v_a} thách đấu CLB của bạn | {coalesce(v_msg, 'Xem luật thi đấu rồi Nh} | `create_club_duel` |
| A28 | CLUB_BATTLE | {v_me} đã từ chối lời thách đấu | {coalesce('Lý do: '}{v_note, null)} | `respond_club_duel` |
| A29 | CLUB_BATTLE | {v_me} đề xuất lại điều khoản "{u.title}" | {coalesce(v_note, 'Xem điều khoản mới rồi} | `respond_club_duel` |
| A30 | CLUB_BATTLE | ⚔ {u.title}: đăng ký thi đấu! | Đối thủ đã nhận lời. Bấm "Đăng ký thi đấu" trước {v_close} — chỉ người đăng ký mới được tính cho CLB. | `respond_club_duel` |
| A31 | CLUB_BATTLE | ⚔ {u.title}: đăng ký thi đấu! | CLB đã nhận lời. Bấm "Đăng ký thi đấu" trước {v_close} — chỉ người đăng ký mới được tính cho CLB. | `respond_club_duel` |
| A32 | CLUB_BOOST_DAY | Ngày vàng ×{trim(to_char(p_multiplier, 'FM9.9'))} ở {v_name}: {to_char(p_day, 'DD/MM')} | {v_title} — km chạy trong ngày được nhân ×{trim(to_char(p_multiplier, 'FM9.9'))} trên BXH và thử thách của CLB. | `set_club_boost_day` |
| A33 | CLUB_CUP | Thách đấu CLB chờ duyệt: {v_title} | {v_name} vừa tạo. Vào Quản trị → Thách đấu để duyệt. | `create_club_cup` |
| A34 | CLUB_CUP | {case when p_approve then 'Thách đấu "'}{u.title}{'" đã được duyệt' else 'Thách đấu "'}{u.title}{'" chưa được duyệt' end} | {case when p_approve then 'Ban quản trị c} | `review_club_cup` |
| A35 | CLUB_CUP | {v_club} tham gia "{u.title}": đăng ký thi đấu! | {case when coalesce(u.require_signup, fal}{to_char(coalesce(u.roster_close_at, u.en}{' — chỉ người đăng ký mới được tính cho }{to_char(u.start_at at time zone 'Asia/Ho}{' đều tính cho CLB. Chạy thôi!' end} | `join_club_cup` |
| A36 | CLUB_CUP | {v_club} đã đăng ký "{u.title}" | — | `join_club_cup` |
| A37 | CLUB_DUE | Nhắc đóng phí: {d.title} | {to_char(d.amount_vnd, 'FM999G999G999')}đ{coalesce(' · hạn '}{to_char(d.due_date, 'DD/MM'), '')} | `remind_due` |
| A38 | CLUB_DUE | Thu phí: {trim(p_title)} | {to_char(p_amount, 'FM999G999G999')}đ{coalesce(' · hạn '}{to_char(p_due_date, 'DD/MM'), '')} | `create_club_due` |
| A39 | CLUB_DUE | {display_name(v_uid)} báo đã đóng phí | {d.title} · {to_char(d.amount_vnd, 'FM999G999G999')}đ — kiểm tra tài khoản và xác nhận | `claim_due_paid` |
| A40 | CLUB_DUE | Đã xác nhận đóng phí | {d.title} | `set_due_payment` |
| A41 | CLUB_EVENT | Sắp tới: {e.title} | {to_char(e.starts_at at time zone 'Asia/H}{coalesce(' · '}{e.location_name, '')} | `remind_events` |
| A42 | CLUB_EVENT | Sự kiện mới: {f.title} | {to_char(f.starts_at at time zone 'Asia/H}{coalesce(' · '}{f.location_name, '')} | `create_club_event` |
| A43 | CLUB_EVENT | Đã hủy: {e.title} | {trim(p_reason)} | `cancel_club_event` |
| A44 | CLUB_EVENT | Đổi lịch: {f.title} | {to_char(f.starts_at at time zone 'Asia/H}{coalesce(' · '}{f.location_name, '')} | `update_club_event` |
| A45 | CLUB_EXCHANGE | Giao lưu với {v_from}: {x.title} | {x.location_name} — đăng ký tham gia ở tab Lịch | `respond_club_exchange` |
| A46 | CLUB_EXCHANGE | {v_from} mời CLB giao lưu: {x.title} | {to_char(x.starts_at at time zone 'Asia/H} · {x.location_name}. Mở thư mời để nhận lời. | `send_club_exchange` |
| A47 | CLUB_EXCHANGE | {v_to} chưa nhận lời giao lưu | {coalesce(x.response_note, x.title)} | `respond_club_exchange` |
| A48 | CLUB_EXCHANGE | {v_to} đã nhận lời giao lưu! | {x.title} · {x.location_name} | `respond_club_exchange` |
| A49 | CLUB_EXCHANGE | Đã huỷ giao lưu: {x.title} | {v_reason} | `cancel_club_exchange` |
| A50 | CLUB_JOIN_REQUEST | {display_name(new.user_id)} xin gia nhập {v_club.name} | — | `club_member_events` |
| A51 | CLUB_NEWS | {v_title} | {left(coalesce(nullif(v_body, ''), 'Tin m} | `news_categories` |
| A52 | CLUB_POLL | {display_name(v_uid)} tạo bình chọn | {trim(p_question)} | `create_club_poll` |
| A53 | CLUB_PRO | CLB đã lên gói CLB Pro | Hiệu lực tới {to_char(v_row.ends_at at time zone 'Asia}. | `grant_subscription` |
| A54 | CLUB_PRO | CLB được cấp quyền tổ chức giải chạy | — | `admin_set_race_organizer` |
| A55 | CLUB_PRO | {case when upper(p_plan) = 'PRO' then c.n}{' đã lên gói CLB Pro' else c.name}{' trở về gói miễn phí' end} | {case when upper(p_plan) = 'PRO' then 'Mở} | `admin_set_club_plan` |
| A56 | CLUB_ROLE | Bạn là Chủ nhiệm mới | Chủ nhiệm cũ đã rời CLB và trao quyền cho bạn. | `leave_club` |
| A57 | CLUB_ROLE | Bạn là Chủ nhiệm mới của {v_club} | Quyền Chủ nhiệm CLB đã được trao cho bạn. | `transfer_club_ownership` |
| A58 | CLUB_RUN_REVIEW | {display_name(new.user_id)} có bài chạy cần duyệt | {round(coalesce(new.distance_m, 0) / 1000} km · {coalesce(new.validation_reason, '')} | `activity_pending_notify` |
| A59 | CLUB_SHOP | Cửa hàng CLB: {trim(p->>'title')} | Mở đặt hàng{case when nullif(p->>'order_deadline', '}{to_char((p->>'order_deadline')::timestam}. Xem và đặt ngay trong CLB. | `save_club_product` |
| A60 | CLUB_SHOP | {case v_to when 'PAID' then 'CLB đã nhận }{o.code when 'DELIVERED' then 'Đơn '}{o.code}{' đã giao' else 'Đơn '}{o.code}{' đã bị huỷ' end} | {coalesce(nullif(trim(coalesce(p_note, ''} | `set_club_order_status` |
| A61 | CLUB_UNIFORM | CLB có đồng phục mới: {r.name} | Vào Tủ đồ, bấm "Mặc cả bộ" để mặc đồng phục CLB. | `admin_review_uniform_request` |
| A62 | CLUB_UNIFORM | Đồng phục "{r.name}" cần chỉnh sửa | {r.review_note} | `admin_review_uniform_request` |
| A63 | COMMENT_LIKE | {display_name(v_uid)} đã thích bình luận của bạn | {left(c.body, 140)} | `toggle_post_comment_like` |
| A64 | COMMENT_LIKE | {display_name(v_uid)} đã thích bình luận của bạn | {left(cm.body, 120)} | `toggle_org_comment_like` |
| A65 | COMMENT_REPLY | {display_name(v_uid)} đã trả lời bình luận của bạn | {left(v_body, 140)} | `add_post_comment` |
| A66 | COMMENT_REPLY | {display_name(v_uid)} đã trả lời bình luận của bạn | {left(trim(p_body), 120)} | `add_org_post_comment` |
| A67 | CONTENT | Bài viết cần chỉnh sửa | "{a.title}": {coalesce(p_note, 'Xem ghi chú biên tập')} | `cms_set_status` |
| A68 | CONTENT | Bài viết cộng đồng chờ duyệt | "{v_title}" — {display_name(v_uid)} | `knowledge_submit` |
| A69 | CONTENT | Bài viết của bạn đã được đăng · +{v_xu} Xu 🎉 | {new.title} | `content_reward_on_publish` |
| A70 | CONTENT | Bài viết đã được đăng | {a.title} | `cms_set_status` |
| A71 | CONTENT | Chuyên gia góp ý bài viết | "{a.title}": {left(trim(p_note), 200)} | `cms_expert_review` |
| A72 | DM | {display_name(v_uid)} nhắn tin cho bạn | {left(v_body, 140)} | `send_direct_message` |
| A73 | ENTERPRISE_LEAD | Yêu cầu báo giá Doanh nghiệp: {left(trim(p->>'org_name'), 80)} | {left(trim(p->>'contact_name'), 80)} · {v_phone} | `request_enterprise_quote` |
| A74 | FOLLOW | {display_name(v_uid)} đã theo dõi bạn | {case when private.is_following(p_user, v} | `follow_runner` |
| A75 | GIFT | {v_name} tặng bạn {case when v_qty > 1 then v_qty}{' × ' else '' end}{g.emoji} {g.name} | {coalesce(v_msg, g.description)} | `send_gift` |
| A76 | HONOR | BTC đã chọn ảnh vinh danh cho bạn | Thử thách "{c.title}". Bạn có thể đổi ảnh khác hoặc ẩn mình khỏi ảnh công khai. | `set_honor_pref` |
| A77 | HONOR | Bạn được vinh danh 🏆 | Bạn có tên trong bảng vinh danh "{c.title}". Tải ảnh vinh danh để chia sẻ! | `publish_challenge_honor` |
| A78 | HUB_INTEREST | {display_name(v_uid)} quan tâm bài của bạn | {left(h.body, 120)} | `toggle_hub_interest` |
| A79 | HUB_NEARBY | {first_name(v_uid)} rủ chạy gần bạn | {left(v_body, 120)} | `create_hub_post` |
| A80 | LEAGUE | {case v_outcome when 'PROMOTED' then 'Bạn}{league_name(v_new_tier)}{'!' when 'DEMOTED' then 'Bạn xuống hạng }{league_name(v_new_tier) else 'Bạn giữ hạ}{league_name(v_new_tier) end} | Tuần trước bạn xếp thứ {m.final_rank}/{n} | `settle_league_week` |
| A81 | LEVEL_UP | Chúc mừng! Bạn lên cấp {p_level} | {level_name(p_level)}{case when v_xu > 0 then ' · +'}{trim_scale(v_xu)}{' Xu' else '' end} | `level_up_event` |
| A82 | LUCKY_DRAW_WIN | Chúc mừng! Bạn trúng {w.prize} | {d.title} | `draw_absent` |
| A83 | MARKET | {case v_act when 'APPROVE' then 'Hồ sơ "'}{r.name}{'" đã được xác minh ✓' when 'REJECT' the}{r.name}{'" cần bổ sung' else 'Hồ sơ "'}{r.name}{'" đã bị ẩn' end} | {coalesce(p_note, 'Hồ sơ của bạn đã hiện } | `admin_review_partner` |
| A84 | MARKET | {case when p_hide then 'Tin BIB đã bị ẩn'} | {b.race_name}{coalesce(': '}{nullif(trim(p_reason), ''), '')} | `admin_hide_bib` |
| A85 | ORG_APPROVED | Bạn đã vào {coalesce(v_org, 'tổ chức')} | Xem chiến dịch đang diễn ra. | `set_org_member` |
| A86 | ORG_APPROVED | Bạn đã được thêm vào {(select o.name from public.organizations} | Xem chiến dịch đang diễn ra. | `org_import_members` |
| A87 | ORG_CAMPAIGN | {coalesce(v_org, 'Tổ chức')}: {v_title} | Chiến dịch mới — bài chạy hợp lệ của bạn được tính tự động. | `save_org_campaign` |
| A88 | ORG_CAMPAIGN_DQ | Kết quả chiến dịch “{c.title}” không được công nhận | {left(trim(p_note), 300)} | `review_campaign_result` |
| A89 | ORG_CLUB_INVITE | {o.name} mời CLB tham gia tổ chức | {case when o.include_club_pro then 'Tham } | `org_invite_club` |
| A90 | ORG_CLUB_JOINED | {(select c.name from public.clubs c where} đã vào tổ chức | Thành viên CLB được tính vào chiến dịch của tổ chức. | `respond_org_invite` |
| A91 | ORG_CREATED | Mời bạn dùng thử RaceHub Doanh nghiệp | Bạn là quản trị viên của tổ chức dùng thử "{v_name}" trong {v_days} ngày. | `admin_create_demo_org` |
| A92 | ORG_CREATED | Tổ chức {left(v_name, 80)} đã sẵn sàng | Bạn là quản trị viên. Mời thành viên bằng mã {v_code} và tạo chiến dịch đầu tiên. | `admin_create_org` |
| A93 | ORG_JOIN_REQUEST | {display_name(v_uid)} xin vào {o.name} | Duyệt ở mục Thành viên của tổ chức. | `join_org` |
| A94 | ORG_POST_COMMENT | {display_name(v_uid)} bình luận bài của bạn | {left(trim(p_body), 120)} | `add_org_post_comment` |
| A95 | POST_CHEER | {display_name(v_uid)}{case when p.kind = 'AUTO_RUN' then ' đã } | — | `toggle_post_reaction` |
| A96 | POST_COMMENT | {display_name(v_uid)} đã bình luận bài của bạn | {left(v_body, 140)} | `add_post_comment` |
| A97 | PROMO | {pr.title} | {coalesce(nullif(trim(coalesce(pr.message}{array_to_string(v_parts, ', '))} | `give_promo_reward` |
| A98 | RACE_CANCELLED | Giải {r.title} đã hủy | {coalesce(nullif(trim(p_reason), ''), 'Ba} | `cancel_virtual_race` |
| A99 | RACE_FINISHED | Hoàn thành {r.title} | Cự ly {g.distance_km} km · BIB {g.bib}. Xem thứ hạng và nhận giấy chứng nhận. | `race_evaluate` |
| A100 | REFERRAL | Bạn nhận {trim_scale((cfg->>'inviterXu')::numeric)} Xu giới thiệu | {display_name(p_user)} đã hoàn thành bài chạy đầu tiên. | `referral_on_run` |
| A101 | RUNNER_CONNECT | {first_name(v_uid)} muốn kết nối chạy cùng bạn | {coalesce(v_msg, 'Xem lời mời trong Quanh} | `send_connection` |
| A102 | RUNNER_CONNECTED | {first_name(v_uid)} đã chấp nhận kết nối | Rủ nhau một buổi chạy nhé! | `respond_connection` |
| A103 | RUNNER_INVITE | {first_name(v_uid)} rủ bạn chạy: {e.title} | {coalesce(v_note, to_char(e.starts_at at }{coalesce(' · '}{e.location_name, ''))} | `invite_to_run` |
| A104 | RUNNER_INVITE | {first_name(v_uid)} rủ bạn vào CLB {(select name from public.clubs where id } | {v_note} | `invite_to_run` |
| A105 | RUN_REVIEW | Bài chạy đang chờ xác minh | {coalesce(new.validation_reason, 'Bài chạ} | `activity_pending_notify` |
| A106 | RUN_REVIEW | Bài chạy đã được khôi phục | {round(coalesce(a.distance_m, 0) / 1000.0} km — đã xem xét lại và ghi nhận, cộng Xu, XP và thử thách. | `restore_activity` |
| A107 | RUN_REVIEW | {case when p_status = 'APPROVED' then 'Bà} | {round(coalesce(a.distance_m, 0) / 1000.0} km — {case when p_status = 'APPROVED' then 'đã} | `review_activity` |
| A108 | RUN_SYNCED | {v_title} | {v_body} | `run_synced_notify` |
| A109 | SHINE | Bạn đã đạt Tỏa sáng {v_names[private.shine_tier(v_new) + 1]} ✨ | Ảnh đại diện của bạn có khung mới. Cảm ơn cộng đồng đã tiếp sức! | `shine_on_gift` |
| A110 | SYSTEM | Quyền quản trị của bạn đã được cập nhật | {case when cardinality(v_scopes) = 0 then}{array_to_string(v_scopes, ', ') end}{coalesce(' · hết hạn '}{to_char(p_expires_at at time zone 'Asia/} | `admin_set_permissions` |
| A111 | SYSTEM | {case when v_role = 'SYSTEM_ADMIN' then '} | {coalesce(p_reason, '')} | `admin_set_user_role` |
| A112 | THANKS | {display_name(v_uid)} cảm ơn bạn đã tiếp sức 💛 | Món quà của bạn đã tiếp thêm năng lượng cho buổi chạy. | `send_thanks` |
| A113 | VICTORY | {coalesce(v_award, v_facts->>'headline')} 🏅 | {display_name(v_uid)} vinh danh bạn trong thử thách {coalesce(v_facts->>'title', '')} | `issue_victory` |
| A114 | VIP | Bạn đã là {v_name} | Hiệu lực tới {to_char(v_row.ends_at at time zone 'Asia}. Lượt tạo thử thách tháng này đã được cấp. | `grant_subscription` |
| A115 | VIP | Bạn được cấp quyền tổ chức giải chạy | — | `admin_set_race_organizer` |
| A116 | VOUCHER | Bạn nhận voucher từ {c.sponsor_name} 🎟️ | {c.title} | `issue_voucher` |
| A117 | match_kind_note(u) | "{u.title}" đã hủy | — | `cancel_club_cup` |
| A118 | p_kind | {p_title} | {p_body} | `notify_club` |
| A119 | p_kind text | {p_title text} | {p_body text} | `notify` |
| A120 | v_kind | CLB bị xử thua "{u.title}" | Chưa đủ {u.min_roster} VĐV đăng ký lúc chốt danh sách. | `match_tick` |
| A121 | v_kind | Kết quả chính thức: {v_msg} | {match_score_text(u, nullif(r->>'score', } · {(r->>'runners')}/{(r->>'members')} VĐV đã chạy{case when v_mvp is not null and (v_mvp->}{(v_mvp->>'display_name') else '' end} | `match_finalize` |
| A122 | v_kind | Kết quả tạm: {u.title} | Hạng {e.rk} · {match_score_text(u, nullif(e.score, ''):}. Kết quả chính thức sau {u.final_delay_hours} giờ (chờ bài đồng bộ muộn và bài đang duyệt). | `match_tick` |
| A123 | v_kind | Lời thách đấu "{u.title}" đã hết hạn | Đối thủ chưa trả lời trước giờ chốt danh sách. | `match_tick` |
| A124 | v_kind | Lời thách đấu "{u.title}" đã hết hạn | — | `match_tick` |
| A125 | v_kind | Sắp chốt danh sách: {u.title} | Bấm để đăng ký thi đấu trước {v_close} — chỉ người đã đăng ký mới được tính cho CLB. | `match_tick` |
| A126 | v_kind | Trận "{u.title}" đã hủy | Không đủ {u.min_roster} VĐV đăng ký lúc chốt danh sách. | `match_tick` |
| A127 | v_kind | {v_pending} bài chạy thi đấu đang chờ duyệt | Duyệt trước {to_char((u.end_at + make_interval(hours } để được tính vào kết quả "{u.title}". | `match_tick` |
| A128 | v_kind | Đã chốt danh sách: {u.title} | Bắt đầu {to_char(u.start_at at time zone 'Asia/Ho}. Mọi bài chạy hợp lệ trong giờ thi đấu đều tính cho CLB! | `match_tick` |

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


**features/activity/api/reviewApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D1 | `NOTE_REQUIRED` | Hãy ghi lý do khôi phục (ít nhất 5 ký tự). |
| D2 | `OVERLAPS_COUNTED_RUN` | Bài trùng giờ với một bài khác đang được tính — khôi phục sẽ tính 2 lần. |
| D3 | `ACTIVITY_NOT_REJECTED` | Bài này không còn ở trạng thái bị loại. |
| D4 | `FORBIDDEN` | Bạn không có quyền xem lại bài này (không tự khôi phục bài của mình). |

**features/admin/api/adminApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D5 | `CORE` | Cơ bản |
| D6 | `PROMO_OVERLAP` | Vật phẩm này đang có chương trình khác trong cùng thời gian. Mỗi vật phẩm chỉ một chương trình. |
| D7 | `INVALID_DISCOUNT` | Mức giảm từ 5% đến 90%. Muốn tặng miễn phí hãy dùng loại "Miễn phí". |
| D8 | `FLASH_TOO_LONG` | Flash sale cần giờ kết thúc, tối đa 72 giờ. |
| D9 | `FREE_NEEDS_LIMIT` | Quà miễn phí phải giới hạn số lượt mỗi người (chống farm). |
| D10 | `TRIAL_AVATAR_ONLY` | Dùng thử chỉ áp cho đồ nhân vật. |
| D11 | `INVALID_BUNDLE` | Gói cần 2–12 món đồ nhân vật đang bán và giá gói. |
| D12 | `INVALID_PROMO_TITLE` | Nhập tên chương trình. |
| D13 | `INVALID_PROMO` | Chương trình không hợp lệ. |
| D14 | `FORBIDDEN` | Chỉ quản trị viên hệ thống mới làm được việc này. |
| D15 | `REASON_REQUIRED` | Hãy ghi lý do (ít nhất 5 ký tự) để lưu nhật ký. |
| D16 | `INVALID_AMOUNT` | Số lượng không hợp lệ. |
| D17 | `INVALID_COIN_KIND` | Loại Xu không hợp lệ. |
| D18 | `INSUFFICIENT_BALANCE` | Số dư không đủ để trừ — không cho phép âm. |
| D19 | `NEGATIVE_BALANCE` | Số dư không đủ để trừ — không cho phép âm. |
| D20 | `USER_NOT_FOUND` | Không tìm thấy người dùng. |
| D21 | `CLUB_NOT_FOUND` | Không tìm thấy CLB. |
| D22 | `INVALID_MAX_SLOTS` | Số người tối đa của vé phải từ 1 đến 10.000. |
| D23 | `INVALID_TIME_RANGE` | Khoảng thời gian không hợp lệ (kết thúc sau bắt đầu, sự kiện cần đủ 2 mốc, tối đa 1 năm). |
| D24 | `INVALID_TITLE` | Tên cần từ 2 ký tự. |
| D25 | `PASS_NOT_FOUND` | Không tìm thấy vé. |
| D26 | `INVALID_CONFIG` | Cấu hình không hợp lệ — kiểm tra lại các mốc và đơn giá. |
| D27 | `INVALID_CODE` | Mã không hợp lệ: vật phẩm dùng chữ thường, số, dấu _ (3–48 ký tự); món Tỏa sáng dùng chữ in hoa, số, dấu _ (2–32 ký tự). |
| D28 | `INVALID_NAME` | Tên vật phẩm cần 2–60 ký tự. |
| D29 | `INVALID_DESCRIPTION` | Mô tả tối đa 160 ký tự. |
| D30 | `INVALID_SLOT` | Ô trang phục không hợp lệ. |
| D31 | `INVALID_RARITY` | Độ hiếm không hợp lệ. |
| D32 | `INVALID_PRICE` | Giá phải từ 0 đến 100.000 Xu. |
| D33 | `INVALID_LEVEL` | Cấp mở khóa phải từ 1 đến 8. |
| D34 | `INVALID_STATUS` | Trạng thái không hợp lệ. |
| D35 | `COLLECTION_NOT_FOUND` | Không tìm thấy bộ sưu tập. |
| D36 | `BADGE_NOT_FOUND` | Không tìm thấy huy hiệu với mã này. |
| D37 | `CHALLENGE_NOT_FOUND` | Không tìm thấy thử thách. |
| D38 | `PRINT_TOP_ONLY` | Chỉ áo mới có vùng in. |
| D39 | `INVALID_PRINT` | Nội dung in chưa hợp lệ (logo PNG/WebP/JPG, màu chữ dạng #rrggbb). |
| D40 | `ITEM_HAS_OWNERS` | Đã có người sở hữu: không đưa về Nháp / Chờ duyệt được. Dùng Ngừng bán. |
| D41 | `INVALID_SUPPLY` | Số lượng giới hạn phải từ 1 trở lên. |
| D42 | `REQUEST_NOT_FOUND` | Không tìm thấy yêu cầu. |
| D43 | `REQUEST_CLOSED` | Yêu cầu đã được xử lý. |
| D44 | `INVALID_ACTION` | Thao tác không hợp lệ. |
| D45 | `INVALID_PATTERN` | Họa tiết không hợp lệ cho món này. |
| D46 | `PATTERN_TINT_ONLY` | Họa tiết chỉ dùng cho món đổi màu (không dùng cho lớp ảnh). |
| D47 | `INVALID_KIT` | Mã bộ không hợp lệ. |
| D48 | `INVALID_PARTS` | Bộ đồng phục chỉ gồm áo, quần, tất, giày. |
| D49 | `TINT_SLOT_ONLY` | Vật phẩm đổi màu chỉ dành cho áo, quần, tất, giày. |
| D50 | `INVALID_COLOR` | Mã màu không hợp lệ. |
| D51 | `LAYER_REQUIRED` | Cần ít nhất một ảnh lớp (Nam hoặc Nữ). |
| D52 | `INVALID_LAYER` | Đường dẫn ảnh lớp không hợp lệ (phải là PNG). |
| D53 | `SLOT_LOCKED` | Đã có người sở hữu món này, không đổi sang ô khác được. Hãy tạo mã mới. |
| D54 | `ITEM_REQUIRED` | Không ngừng bán được bản nguyên bản (bộ mặc định của mọi người). |
| D55 | `ITEM_NOT_FOUND` | Không tìm thấy vật phẩm. |
| D56 | `INVALID_REWARD` | Phần thưởng không hợp lệ: cần ít nhất Xu, lượt tạo hoặc gói VIP (gói tặng phải là VIP1–3). |
| D57 | `SEGMENT_TOO_LARGE` | Nhóm quá lớn (trên 50.000 người) — chia nhỏ theo điều kiện khác. |
| D58 | `INVALID_SALE` | Đợt giảm giá cần % giảm hoặc % tặng thêm. |
| D59 | `INVALID_PERIOD` | Kỳ nhiệm vụ không hợp lệ. |
| D60 | `INVALID_METRIC` | Chỉ số không hợp với kỳ (km / ngày chạy trong tuần chỉ cho nhiệm vụ tuần; km cộng đồng cho tuần / tháng / sự kiện; điểm danh chỉ hằng ngày). |
| D61 | `INVALID_TARGET` | Mục tiêu phải lớn hơn 0. |
| D62 | `TOO_MANY_ACTIVE` | Đã đủ số nhiệm vụ đang bật cho loại này. Tắt bớt một nhiệm vụ hoặc nâng giới hạn ở thẻ Giới hạn. |
| D63 | `INVALID_TIERS` | Bậc không hợp lệ: mục tiêu phải tăng dần, tối đa 5 bậc (km cộng đồng không dùng bậc). |
| D64 | `INVALID_PARAMS` | Tham số không hợp lệ (km tối thiểu 0–100, giờ chạy sớm 1–23). |
| D65 | `INVALID_CATEGORY` | Nhóm nhiệm vụ không hợp lệ. |
| D66 | `INVALID_BADGE` | Tên huy hiệu cần 2–60 ký tự. |
| D67 | `INVALID_PASSES` | Lượt tạo không hợp lệ (1–10 lượt, quy mô 2–1.000 người). |
| D68 | `INVALID_LIMIT` | Giới hạn không hợp lệ. |
| D69 | `INVALID_KIND` | Loại món không hợp lệ. |
| D70 | `ORDER_NOT_FOUND` | Không tìm thấy đơn hàng. |
| D71 | `ORDER_NOT_PENDING` | Đơn đã được xử lý hoặc đã hủy. |
| D72 | `SELF_CONFIRM_FORBIDDEN` | Đây là đơn của chính bạn — cần một admin khác xác nhận sau khi kiểm tra tiền đã về. |
| D73 | `INVALID_PLAN` | Gói không hợp lệ cho loại tài khoản này (VIP cho cá nhân, CLB Pro cho CLB). |
| D74 | `INVALID_MONTHS` | Kỳ hạn chỉ 1, 3, 6 hoặc 12 tháng. |
| D75 | `INVALID_BANK` | Tài khoản nhận tiền không hợp lệ: mã BIN 6 số, số tài khoản 4–30 ký tự, tên chủ tài khoản ≥ 3 ký tự. |
| D76 | `INVALID_OWNER` | Loại tài khoản không hợp lệ. |

**features/admin/api/consoleApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D77 | `CANNOT_TARGET_SELF` | Không thao tác lên chính tài khoản của bạn. |
| D78 | `CANNOT_BAN_ADMIN` | Không khóa được quản trị viên — gỡ quyền admin trước. |
| D79 | `USER_BANNED` | Tài khoản đang bị khóa — mở khóa trước khi cấp quyền. |
| D80 | `REASON_REQUIRED` | Hãy ghi lý do (ít nhất 3 ký tự) để lưu nhật ký. |
| D81 | `CHALLENGE_CLOSED` | Thử thách đã kết thúc hoặc đã hủy. |
| D82 | `USER_NOT_FOUND` | Không tìm thấy người dùng. |
| D83 | `OWNER_REQUIRED` | Chưa có Quản trị chính. Người giữ key hệ thống chạy lệnh đặt Quản trị chính trong Supabase SQL Editor trước. |
| D84 | `OWNER_ONLY` | Chỉ Quản trị chính mới cấp / gỡ quyền và phân quyền admin. |
| D85 | `CANNOT_TARGET_OWNER` | Không tác động được Quản trị chính (chỉ đổi được bằng key hệ thống). |
| D86 | `EMAIL_REQUIRED` | Tài khoản này chưa có email đăng nhập — không cấp quyền admin được. |
| D87 | `INVALID_SCOPE` | Nhóm quyền không hợp lệ. |
| D88 | `INVALID_EXPIRY` | Ngày hết hạn phải ở tương lai. |
| D89 | `NOT_ADMIN` | Người này chưa là admin. |
| D90 | `FORBIDDEN` | Bạn chưa được giao quyền cho việc này. |
| D91 | `USER_BAN` | Khóa tài khoản |
| D92 | `ADMIN_GRANT_XU` | Cộng / trừ Xu |
| D93 | `PARTNER_APPROVE` | Xác minh đối tác |
| D94 | `CLUB_TRANSFER_OWNER` | Trao quyền chủ nhiệm |
| D95 | `CONFIRM_ORDER` | Xác nhận đơn hàng |
| D96 | `PUBLISH_CONFIG` | Đổi chính sách kinh tế |
| D97 | `SAVE_PLAN` | Sửa gói & giá |
| D98 | `SAVE_ITEM_PROMO` | Khuyến mãi vật phẩm |
| D99 | `SAVE_GIFT` | Sửa quà tặng |
| D100 | `SYSTEM_NOTICE` | Bật thông báo hệ thống |

**features/billing/api/billingApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D101 | `TOO_MANY_PENDING_ORDERS` | Bạn đang có 5 đơn chờ thanh toán. Hoàn tất hoặc hủy bớt rồi tạo đơn mới. |
| D102 | `INVALID_PLAN` | Gói không còn bán. |
| D103 | `INVALID_MONTHS` | Kỳ hạn này không còn bán. |
| D104 | `INVALID_PACKAGE` | Gói Xu không còn bán. |
| D105 | `CLUB_STAFF_REQUIRED` | Chỉ ban quản trị CLB mới mua gói cho CLB. |
| D106 | `ORDER_NOT_FOUND` | Không tìm thấy đơn hàng. |
| D107 | `ORDER_NOT_PENDING` | Đơn đã được xử lý. |
| D108 | `NOT_A_MEMBER` | Bạn không thuộc CLB này. |
| D109 | `FORBIDDEN` | Bạn không có quyền làm việc này. |

**features/challenge/api/challengeApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D110 | `VIP_REQUIRED` | Nhân bản thử thách cũ dành cho VIP2 trở lên. |
| D111 | `INVALID_CONQUEST` | Hạng mục chưa hợp lệ: mỗi hạng mục cần tên, cự ly 0,4–250 km và mục tiêu hợp lý (pace 2:00–25:00/km). |
| D112 | `CONQUEST_LOCKED` | Đã có người đăng ký hạng mục — không đổi luật chinh phục được nữa. |
| D113 | `CONQUEST_TARGET_LOCKED` | Thử thách đã bắt đầu: bạn chỉ thêm được hạng mục mới, không bỏ hay đổi mục tiêu đã đăng ký. |
| D114 | `CONQUEST_NOT_SUPPORTED` | Thử thách này không có hạng mục chinh phục. |
| D115 | `REGISTRATION_CLOSED` | Đã hết hạn đăng ký thử thách này. |
| D116 | `INVALID_DEADLINE` | Hạn đăng ký phải từ bây giờ đến trước khi kết thúc (thử thách đội: trước giờ xuất phát). |
| D117 | `BOOST_DAY_TOO_LATE` | Ngày vàng phải là ngày sắp tới, nằm trong thời gian thử thách. |
| D118 | `BOOST_DAYS_LIMIT` | Mỗi thử thách tối đa 10 ngày vàng. |
| D119 | `BOOST_NOT_SUPPORTED` | Ngày vàng chỉ áp dụng cho thử thách tính theo km. |
| D120 | `INVALID_MULTIPLIER` | Hệ số chỉ được ×1,5, ×2 hoặc ×3. |
| D121 | `REWARD_TOO_LARGE` | Mỗi thử thách chỉ treo thưởng tối đa 50% số dư quỹ CLB. |
| D122 | `REWARD_NOT_ALLOWED` | Chỉ thử thách CLB mới treo thưởng được (trích quỹ CLB). Thử thách cá nhân không treo thưởng Xu. |
| D123 | `PLEDGES_MISSING` | Còn thành viên chưa đăng ký mục tiêu. Nhắc họ, hoặc chia đội luôn (người chưa đăng ký tính 0 km). |
| D124 | `PLEDGE_LOCKED` | Mục tiêu đã khóa (đã xuất phát hoặc đã chia đội). |
| D125 | `PLEDGE_RULES_LOCKED` | Đã có người đăng ký mục tiêu và thử thách đã bắt đầu — không đổi luật được nữa. |
| D126 | `INVALID_PLEDGE` | Mục tiêu không nằm trong các mục tiêu cho phép. |
| D127 | `INVALID_PLEDGE_OPTIONS` | Các mục tiêu không hợp lệ. |
| D128 | `INVALID_PLEDGE_CAP` | % vượt mục tiêu không hợp lệ. |
| D129 | `INVALID_TEAM_SIZE` | Mỗi đội từ 2 đến 50 người. |
| D130 | `PLEDGE_NOT_SUPPORTED` | Thử thách này không dùng mục tiêu tự đăng ký. |
| D131 | `PLEDGE_REQUIRED` | Hãy chọn mục tiêu km của bạn để tham gia. |
| D132 | `NOT_ENOUGH_MEMBERS` | Chưa đủ người để chia đội. |
| D133 | `CHALLENGE_NOT_FOUND` | Không tìm thấy thử thách, hoặc bạn cần mã mời để xem. |
| D134 | `CHALLENGE_CLOSED` | Thử thách đã kết thúc hoặc đã bị hủy. |
| D135 | `TOO_MANY_RULES` | Tối đa 5 mục thể lệ tự đặt. |
| D136 | `CHALLENGE_FULL` | Thử thách đã đủ người. |
| D137 | `ALREADY_JOINED` | Bạn đã tham gia thử thách này. |
| D138 | `NOT_JOINED` | Bạn chưa tham gia thử thách này. |
| D139 | `INVALID_INVITE` | Thử thách riêng tư — cần đúng mã mời. |
| D140 | `CLUB_MEMBERS_ONLY` | Chỉ thành viên CLB tổ chức mới tham gia được. |
| D141 | `TEAM_ROSTER_LOCKED` | Thử thách đội đã bắt đầu, không đổi đội hay vào thêm được. |
| D142 | `TEAM_FULL` | Đội này đã đủ người. Hãy chọn đội khác. |
| D143 | `INVALID_TEAM` | Đội không hợp lệ. |
| D144 | `CANNOT_LEAVE_STARTED` | Thử thách đội và 1-1 không rời được sau khi đã bắt đầu. |
| D145 | `CANNOT_CANCEL_STARTED` | Không hủy được khi thử thách đã bắt đầu và có người tham gia. |
| D146 | `INVALID_TITLE` | Tên thử thách cần từ 3 đến 120 ký tự. |
| D147 | `DESC_TOO_LONG` | Mô tả quá dài. |
| D148 | `INVALID_TIME_RANGE` | Thời gian không hợp lệ (kết thúc phải sau bắt đầu, tối thiểu 1 giờ, tối đa 1 năm). |
| D149 | `TEAM_START_TOO_SOON` | Thử thách đội cần bắt đầu sau ít nhất 10 phút. |
| D150 | `TARGET_REQUIRED` | Hãy đặt mục tiêu cho thử thách. |
| D151 | `INVALID_STREAK` | Chuỗi ngày cần cự ly tối thiểu mỗi ngày và không dài hơn thời gian thử thách. |
| D152 | `INVALID_TEAMS` | Cần từ 2 đến 8 đội, tên tối đa 40 ký tự. |
| D153 | `INVALID_DISTANCE` | Cự ly không hợp lệ. |
| D154 | `INVALID_PACE` | Khoảng pace không hợp lệ. |
| D155 | `INVALID_MAX_SLOTS` | Số người tối đa không hợp lệ. |
| D156 | `INSUFFICIENT_BALANCE` | Số Xu trong ví không đủ cho phí tạo và tiền treo thưởng. |
| D157 | `INSUFFICIENT_TREASURY` | Quỹ CLB không đủ cho phí tạo và tiền treo thưởng. |
| D158 | `INVALID_RECURRENCE` | Chu kỳ lặp không hợp lệ. |
| D159 | `RECURRENCE_NOT_SUPPORTED` | Kèo 1-1 không lặp lại được. |
| D160 | `RECURRENCE_TOO_SHORT` | Mỗi kỳ dài hơn chu kỳ lặp — rút ngắn thời gian hoặc chọn chu kỳ dài hơn. |
| D161 | `INVALID_AMOUNT` | Số Xu thưởng không hợp lệ. |
| D162 | `FORBIDDEN` | Bạn không có quyền làm việc này. |
| D163 | `RATE_LIMITED` | Bạn thao tác hơi nhanh, thử lại sau ít phút. |
| D164 | `HONOR_PRO_REQUIRED` | Vinh danh là tính năng của CLB Pro hoặc gói VIP (người tạo thử thách). |
| D165 | `HONOR_REVIEW_PENDING` | Chỉ công bố được sau khi thử thách kết thúc 24 giờ (thời gian duyệt bài / khiếu nại). |
| D166 | `HONOR_NOT_CONFIGURED` | Hãy bật vinh danh và chọn ít nhất một hạng mục. |
| D167 | `HONOR_NOT_AVAILABLE` | Thử thách đã hủy, không vinh danh được. |
| D168 | `INVALID_HONOR_CATEGORIES` | Hạng mục vinh danh không hợp lệ (tối đa 8, mỗi hạng mục 1–10 người). |
| D169 | `INVALID_HONOR_DESIGN` | Thiết kế ảnh vinh danh không hợp lệ. |
| D170 | `INVALID_BIB_DESIGN` | Thiết kế không hợp lệ. |
| D171 | `INVALID_HONOR_IMAGE` | Ảnh phải được tải lên từ trang vinh danh của thử thách này. |
| D172 | `NOT_A_PARTICIPANT` | Người này không tham gia thử thách. |

**features/character/api/characterApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D173 | `INSUFFICIENT_BALANCE` | Số Xu trong ví không đủ. |
| D174 | `LEVEL_TOO_LOW` | Vật phẩm này cần cấp độ cao hơn. |
| D175 | `ALREADY_OWNED` | Bạn đã có vật phẩm này. |
| D176 | `ITEM_NOT_FOUND` | Vật phẩm không còn bán. |
| D177 | `ITEM_NOT_OWNED` | Bạn chưa sở hữu vật phẩm này. |
| D178 | `SLOT_REQUIRED` | Nhân vật cần có áo, quần, tất và giày. |
| D179 | `INVALID_LOOK` | Dáng người không hợp lệ. |
| D180 | `TRIAL_USED` | Bạn đã dùng thử món này rồi. |
| D181 | `PROMO_NOT_AVAILABLE` | Chương trình đã kết thúc hoặc hết lượt. |
| D182 | `PROMO_LIMIT_REACHED` | Bạn đã dùng hết lượt của chương trình này. |
| D183 | `PROMO_NOT_ELIGIBLE` | Chương trình này không áp dụng cho tài khoản của bạn. |
| D184 | `SHINE_ONLY` | Vật phẩm này chỉ đổi bằng Tỏa sáng. |
| D185 | `CLUB_ONLY` | Đồng phục này chỉ dành cho thành viên CLB. |
| D186 | `BADGE_REQUIRED` | Cần có huy hiệu yêu cầu để nhận vật phẩm này. |
| D187 | `CHALLENGE_REQUIRED` | Hoàn thành thử thách để nhận vật phẩm này. |
| D188 | `NOT_YET_AVAILABLE` | Vật phẩm chưa mở bán. |
| D189 | `SALE_ENDED` | Vật phẩm đã hết thời gian bán. |
| D190 | `SOLD_OUT` | Vật phẩm đã hết hàng. |
| D191 | `NOT_FOR_SALE` | Vật phẩm này không bán. |

**features/character/api/uniformApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D192 | `TOO_MANY_REQUESTS` | CLB đang có 3 mẫu chờ duyệt. Chờ admin duyệt hoặc hủy bớt. |
| D193 | `INVALID_PATTERN` | Họa tiết không hợp lệ cho món này. |
| D194 | `INVALID_PARTS` | Bộ đồng phục chỉ gồm áo, quần, tất, giày. |
| D195 | `INVALID_PRINT` | Nội dung in chưa hợp lệ: cần ít nhất logo, chữ hoặc tên runner; logo phải tải lên từ đây. |
| D196 | `INVALID_COLOR` | Màu áo không hợp lệ. |
| D197 | `INVALID_NAME` | Tên mẫu áo cần từ 2 ký tự. |
| D198 | `REQUEST_CLOSED` | Yêu cầu này đã được xử lý. |
| D199 | `FORBIDDEN` | Chỉ chủ nhiệm / đội trưởng CLB làm được việc này. |

**features/club/api/clubApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D200 | `AUTH_REQUIRED` | Bạn cần đăng nhập để tiếp tục. |
| D201 | `NAME_REQUIRED` | Hãy nhập tên CLB. |
| D202 | `NAME_TOO_LONG` | Tên CLB tối đa 60 ký tự. |
| D203 | `NAME_TAKEN` | Tên này đã có CLB khác dùng. Hãy chọn tên khác. |
| D204 | `DESC_TOO_LONG` | Mô tả tối đa 300 ký tự. |
| D205 | `CLUB_NOT_FOUND` | CLB không còn tồn tại. |
| D206 | `CLUB_FULL` | CLB đã đủ số thành viên tối đa. |
| D207 | `CLUB_FREE_FULL` | CLB chưa đủ điều kiện nhận thêm thành viên: gói Miễn phí đã đủ số người tối đa. Nâng cấp CLB Pro để nhận không giới hạn. |
| D208 | `ALREADY_MEMBER` | Bạn đã ở trong CLB này hoặc đang chờ duyệt. |
| D209 | `BANNED` | Bạn đã bị hạn chế tham gia CLB này. |
| D210 | `INVITE_ONLY` | CLB này chỉ nhận thành viên qua link mời. |
| D211 | `INVALID_INVITE` | Mã mời không đúng hoặc đã hết hiệu lực. |
| D212 | `FORBIDDEN` | Bạn không có quyền làm việc này. |
| D213 | `BOOST_DAY_TOO_LATE` | Ngày vàng phải đặt trước, từ ngày mai trở đi (ngày đã bắt đầu thì không đổi được). |
| D214 | `INVALID_MULTIPLIER` | Hệ số chỉ được ×1,5, ×2 hoặc ×3. |
| D215 | `BOOST_DAYS_LIMIT` | Mỗi tháng tối đa 4 ngày vàng. |
| D216 | `TAGLINE_TOO_LONG` | Khẩu hiệu tối đa 80 ký tự. |
| D217 | `EXCHANGE_PENDING` | Đã có một thư mời đang chờ CLB này trả lời. |
| D218 | `EXCHANGE_LIMIT` | Mỗi CLB tối đa 5 thư mời đang chờ. |
| D219 | `EXCHANGE_CLOSED` | Thư mời đã được trả lời hoặc đã huỷ. |
| D220 | `EXCHANGE_EXPIRED` | Buổi giao lưu đã qua giờ. |
| D221 | `EXCHANGE_NOT_FOUND` | Không tìm thấy thư mời. |
| D222 | `REASON_REQUIRED` | Hãy ghi lý do (ít nhất 3 ký tự). |
| D223 | `CLUB_BANK_MISSING` | CLB chưa khai tài khoản nhận tiền (tab Quỹ) nên chưa đặt hàng được. |
| D224 | `ORDERS_CLOSED` | Sản phẩm đã chốt đơn. |
| D225 | `OUT_OF_STOCK` | Không còn đủ số lượng. |
| D226 | `INVALID_SIZE` | Chọn size có trong danh sách. |
| D227 | `INVALID_QUANTITY` | Số lượng không hợp lệ. |
| D228 | `INVALID_PRICE` | Giá không hợp lệ. |
| D229 | `ORDER_LOCKED` | Đơn đã được CLB xác nhận, không huỷ được. Liên hệ ban quản trị CLB. |
| D230 | `PRODUCT_NOT_FOUND` | Không tìm thấy sản phẩm. |
| D231 | `ACTIVITY_NOT_PENDING` | Bài chạy này đã được người khác duyệt. |
| D232 | `NOT_AUTHORIZED` | Bạn không có quyền làm việc này. |
| D233 | `MEMBER_NOT_FOUND` | Không tìm thấy thành viên này. |
| D234 | `TARGET_NOT_APPROVED` | Chỉ áp dụng được với thành viên đã được duyệt. |
| D235 | `OWNER_CANNOT_LEAVE` | Hãy trao quyền Chủ nhiệm cho người khác trước khi rời CLB. |
| D236 | `MUST_ASSIGN_NEW_OWNER` | Hãy trao quyền Chủ nhiệm cho người khác trước khi rời CLB. |
| D237 | `LAST_MEMBER_MUST_DELETE` | Bạn là thành viên cuối cùng. Hãy giải tán CLB thay vì rời đi. |
| D238 | `CANNOT_TRANSFER_TO_SELF` | Không thể trao quyền cho chính mình. |
| D239 | `TARGET_NOT_MEMBER` | Người được chọn không phải thành viên CLB. |
| D240 | `CONFIRM_MISMATCH` | Tên xác nhận không khớp. Hãy gõ đúng tên CLB. |
| D241 | `NOT_A_MEMBER` | Bạn cần là thành viên CLB để làm việc này. |
| D242 | `INSUFFICIENT_FUNDS` | Số Xu trong ví không đủ. |
| D243 | `INSUFFICIENT_BALANCE` | Số Xu trong ví không đủ. |
| D244 | `INVALID_AMOUNT` | Số Xu phải lớn hơn 0. |
| D245 | `INVALID_ROLE` | Vai trò không hợp lệ. |
| D246 | `INVALID_STATUS` | Trạng thái không hợp lệ. |
| D247 | `INVALID_POLICY` | Chế độ tham gia không hợp lệ. |
| D248 | `INVALID_LIMIT` | Giới hạn thành viên phải từ 2 đến 1000. |
| D249 | `LIMIT_BELOW_CURRENT` | Giới hạn mới thấp hơn số thành viên hiện tại. |
| D250 | `INVALID_COLOR` | Màu không hợp lệ. |
| D251 | `AVATAR_TYPE` | Chỉ nhận ảnh JPG, PNG hoặc WebP. |
| D252 | `AVATAR_SIZE` | Ảnh tối đa 2 MB. Hãy chọn ảnh nhẹ hơn. |
| D253 | `IMAGE_TYPE` | Chỉ nhận ảnh JPG, PNG hoặc WebP. |
| D254 | `IMAGE_SIZE` | Mỗi ảnh tối đa 5 MB. |
| D255 | `EMPTY_POST` | Hãy viết gì đó hoặc thêm ảnh. |
| D256 | `EMPTY_COMMENT` | Hãy viết bình luận. |
| D257 | `NOT_AUTHOR` | Chỉ người viết mới sửa được bình luận này. |
| D258 | `COMMENT_NOT_FOUND` | Bình luận không còn nữa. |
| D259 | `EMPTY_MESSAGE` | Tin nhắn đang trống. |
| D260 | `POST_TOO_LONG` | Nội dung quá dài. |
| D261 | `POST_NOT_FOUND` | Bài đăng không còn tồn tại. |
| D262 | `INVALID_IMAGE_PATH` | Ảnh không hợp lệ, hãy tải lại. |
| D263 | `RATE_LIMITED` | Bạn gửi hơi nhanh, đợi một chút rồi thử lại nhé. |
| D264 | `CAPTAIN_LIMIT` | CLB đã đủ số quản trị viên của gói Miễn phí. Nâng cấp CLB Pro để thêm. |
| D265 | `PRO_REQUIRED` | CLB chưa đủ điều kiện dùng tính năng này: cần nâng cấp CLB Pro. |
| D266 | `INVALID_SLUG` | Link riêng dài 3–30 ký tự, chỉ gồm chữ thường không dấu, số và dấu gạch ngang. |
| D267 | `SLUG_TAKEN` | Link này đã có CLB khác dùng. |
| D268 | `BATTLE_EXISTS` | Hai CLB đang có một trận đấu (hoặc lời mời) chưa kết thúc. |
| D269 | `BATTLE_NOT_PENDING` | Lời thách đấu này đã được trả lời. |
| D270 | `BATTLE_EXPIRED` | Trận đấu đã hết giờ. |
| D271 | `BATTLE_NOT_FOUND` | Không tìm thấy trận đấu. |
| D272 | `INVALID_OPPONENT` | Hãy chọn một CLB khác để thách đấu. |
| D273 | `INVALID_DURATION` | Trận đấu dài từ 1 ngày đến 2 tháng. |
| D274 | `START_IN_PAST` | Giờ bắt đầu đã qua. |
| D275 | `INVALID_TIME_RANGE` | Thời gian không hợp lệ. |
| D276 | `TITLE_REQUIRED` | Tiêu đề cần 3–120 ký tự. |
| D277 | `INVALID_URL` | Link phải bắt đầu bằng https:// (dán link album Google Photos, Drive, Facebook…). |
| D278 | `ALBUM_EXISTS` | Link album này đã có trong kho ảnh CLB. |
| D279 | `ALBUM_NOT_FOUND` | Album không còn tồn tại. |
| D280 | `INVALID_DATE` | Ngày chụp không hợp lệ. |

**features/club/api/eventsApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D281 | `NOT_A_MEMBER` | Bạn cần là thành viên CLB để làm việc này. |
| D282 | `FORBIDDEN` | Chỉ ban quản trị CLB làm được việc này. |
| D283 | `EVENT_NOT_FOUND` | Sự kiện không còn tồn tại. |
| D284 | `EVENT_CANCELLED` | Sự kiện đã bị hủy. |
| D285 | `EVENT_ENDED` | Sự kiện đã kết thúc. |
| D286 | `EVENT_FULL` | Sự kiện đã đủ người. |
| D287 | `INVALID_TITLE` | Tên cần từ 3 đến 80 ký tự. |
| D288 | `INVALID_TIME` | Thời gian không hợp lệ. |
| D289 | `INVALID_LOCATION` | Tọa độ điểm hẹn không hợp lệ. |
| D290 | `INVALID_EVENT` | Thông tin sự kiện không hợp lệ. |
| D291 | `REASON_REQUIRED` | Hãy ghi lý do. |
| D292 | `INVALID_TOKEN` | Mã QR không đúng. Hãy quét lại mã trên máy ban tổ chức. |
| D293 | `TOKEN_EXPIRED` | Mã QR đã hết hạn. Nhờ ban tổ chức mở mã mới. |
| D294 | `CHECKIN_CLOSED` | Chưa tới hoặc đã quá giờ điểm danh. |
| D295 | `INVALID_BANK` | Thông tin tài khoản ngân hàng chưa đúng. |
| D296 | `INVALID_QR` | Ảnh QR không hợp lệ. Hãy tải lại ảnh. |
| D297 | `INVALID_AMOUNT` | Số tiền không hợp lệ. |
| D298 | `DUE_NOT_FOUND` | Không tìm thấy kỳ thu phí. |
| D299 | `DUE_CLOSED` | Kỳ thu phí đã đóng. |
| D300 | `REMIND_TOO_SOON` | Vừa nhắc rồi. Mỗi kỳ chỉ nhắc 1 lần / 12 giờ. |
| D301 | `INVALID_RECEIPT` | Ảnh hóa đơn không hợp lệ. |
| D302 | `ENTRY_VOIDED` | Khoản này đã hủy. |
| D303 | `INVALID_QUESTION` | Câu hỏi cần từ 3 đến 200 ký tự. |
| D304 | `INVALID_OPTIONS` | Cần 2–10 lựa chọn, mỗi lựa chọn tối đa 80 ký tự. |
| D305 | `INVALID_CHOICES` | Lựa chọn không hợp lệ. |
| D306 | `POLL_CLOSED` | Bình chọn đã đóng. |
| D307 | `RATE_LIMITED` | Bạn tạo hơi nhiều bình chọn. Thử lại sau ít phút. |

**features/club/api/pointsApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D308 | `INVALID_RULES` | Luật chưa hợp lệ: 1–12 luật, tên 2–60 ký tự, điểm theo km tối đa 100 / km, giờ bắt đầu phải trước giờ kết thúc. |
| D309 | `INVALID_APPLY` | Chọn thời điểm áp dụng hợp lệ. |
| D310 | `RECAP_NOT_POSTED` | Kỳ vừa rồi đã có tổng kết hoặc chưa ai chạy — không có gì để đăng. |
| D311 | `FORBIDDEN` | Chỉ ban quản trị CLB làm được việc này. |
| D312 | `NOT_A_MEMBER` | Bạn cần là thành viên CLB. |

**features/cup/api/cupApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D313 | `JOINED_CLUB_TOO_LATE` | Bạn vào CLB sau khi trận được tạo nên không đăng ký được (luật chống "chiêu mộ" giữa trận). |
| D314 | `ROSTER_LOCKED` | Đã chốt danh sách thi đấu — không đăng ký / rút được nữa. |
| D315 | `ROSTER_FULL` | CLB đã đủ số VĐV tối đa. |
| D316 | `BATTLE_EXISTS` | Hai CLB đang có một trận chưa kết thúc. |
| D317 | `BATTLE_NOT_PENDING` | Lời thách đấu này đã được trả lời hoặc hết hạn. |
| D318 | `INVALID_OPPONENT` | Chọn một CLB khác làm đối thủ. |
| D319 | `TOO_MANY_COUNTERS` | Đã đề xuất lại quá nhiều lần — hãy Nhận lời hoặc Từ chối. |
| D320 | `INVALID_FORMAT` | Hình thức tính không hợp lệ. |
| D321 | `INVALID_MEASURE` | Cách đo không hợp lệ. |
| D322 | `INVALID_TOP_N` | Chọn số VĐV top từ 1 đến 50. |
| D323 | `INVALID_ROSTER` | Số VĐV tối thiểu 1–100, tối đa không nhỏ hơn tối thiểu. |
| D324 | `INVALID_DAILY_CAP` | Trần mỗi ngày từ 5 đến 100 km. |
| D325 | `INVALID_SHARE_CAP` | Trần đóng góp từ 20% đến 60%. |
| D326 | `INVALID_PACE_MIN` | Số km tối thiểu để xét pace từ 1 đến 42 km. |
| D327 | `LOCK_TOO_SOON` | Giờ chốt danh sách phải sau hiện tại ít nhất 30 phút — dời giờ bắt đầu muộn hơn. |
| D328 | `NOT_A_CUP` | Trận 1–1 đã có sẵn hai CLB. |
| D329 | `FEATURE_MOVED` | Tính năng đã được nâng cấp — tải lại trang. |
| D330 | `INVALID_ACTION` | Thao tác không hợp lệ. |
| D331 | `ALREADY_SIGNED_UP` | Bạn đã đăng ký thi đấu cho một CLB khác trong giải này. |
| D332 | `CLUB_NOT_IN_CUP` | CLB chưa được ban quản trị đăng ký vào thách đấu. |
| D333 | `NOT_A_MEMBER` | Bạn chưa là thành viên CLB này. |
| D334 | `FORBIDDEN` | Bạn không có quyền làm việc này. |
| D335 | `CUP_NOT_FOUND` | Không tìm thấy thách đấu (hoặc đang chờ duyệt). |
| D336 | `CLUB_STAFF_REQUIRED` | Chỉ Chủ nhiệm / Quản trị viên của CLB mới đăng ký CLB vào thách đấu. |
| D337 | `CUP_NOT_OPEN` | Thách đấu chưa mở hoặc đã đóng. |
| D338 | `CUP_NOT_PENDING` | Thách đấu này đã được xử lý. |
| D339 | `REGISTRATION_CLOSED` | Đã hết hạn đăng ký. |
| D340 | `ALREADY_JOINED` | CLB đã có trong thách đấu. |
| D341 | `CUP_FULL` | Thách đấu đã đủ số CLB. |
| D342 | `CUP_STARTED` | Thách đấu đã bắt đầu. |
| D343 | `INVALID_TITLE` | Tên thách đấu cần từ 3 đến 120 ký tự. |
| D344 | `INVALID_METRIC` | Cách tính điểm không hợp lệ. |
| D345 | `INVALID_TIME_RANGE` | Thời gian kết thúc phải sau thời gian bắt đầu. |
| D346 | `START_IN_PAST` | Thời gian bắt đầu phải ở tương lai. |
| D347 | `INVALID_DURATION` | Thời gian thi đấu từ 1 ngày đến 2 tháng (1–1) / 3 tháng (nhiều CLB). |
| D348 | `INVALID_REG_CLOSE` | Hạn đăng ký phải sau hiện tại và trước khi kết thúc. |
| D349 | `INVALID_MAX` | Số CLB tối đa từ 2 đến 200. |
| D350 | `REASON_REQUIRED` | Nhập lý do từ chối (ít nhất 3 ký tự). |
| D351 | `RATE_LIMITED` | Bạn tạo quá nhiều thách đấu trong hôm nay. |

**features/draw/api/drawApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D352 | `NO_ENTRANTS` | Chưa có ai đủ điều kiện quay (hoặc tất cả đã trúng ở lượt trước). |
| D353 | `DRAW_CLOSED` | Lượt quay này đã quay hoặc đã huỷ. |
| D354 | `INVALID_PRIZES` | Nhập 1–10 giải, tổng tối đa 200 suất. |
| D355 | `TITLE_REQUIRED` | Tên lượt quay cần 3–120 ký tự. |
| D356 | `TOO_MANY_DRAWS` | Đang có 5 lượt quay chờ. Quay hoặc huỷ bớt trước. |
| D357 | `PICK_REQUIRED` | Hãy chọn ít nhất một người thuộc chương trình. |
| D358 | `TOO_MANY_PEOPLE` | Chọn tối đa 2.000 người. |
| D359 | `DRAW_NOT_LIVE` | Lượt quay chưa bắt đầu hoặc đã kết thúc. |
| D360 | `PRIZE_FULL` | Giải này đã đủ người trúng. Chọn giải khác. |
| D361 | `POOL_EXHAUSTED` | Đã hết người trong danh sách để quay. |
| D362 | `NOT_A_WINNER` | Người này không còn trong danh sách trúng. |
| D363 | `NO_WINNERS` | Chưa có ai trúng — quay ít nhất một giải trước khi công bố. |
| D364 | `DRAW_STARTED` | Đã quay ra người trúng nên không huỷ được. Hãy quay tiếp hoặc công bố. |
| D365 | `NAMES_REQUIRED` | Dán ít nhất một tên (mỗi dòng một người). |
| D366 | `EVENT_REQUIRED` | Chọn một buổi của CLB. |
| D367 | `INVALID_SPONSOR` | Tên nhà tài trợ tối đa 80 ký tự; logo phải là ảnh https. |
| D368 | `FORBIDDEN` | Bạn không có quyền làm việc này. |

**features/game/api/gameApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D369 | `PROMO_INVALID` | Mã không đúng hoặc đã hết hạn. |
| D370 | `PROMO_USED_UP` | Mã đã hết lượt sử dụng. |
| D371 | `PROMO_ALREADY_USED` | Bạn đã dùng mã này rồi. |
| D372 | `PROMO_NOT_ELIGIBLE` | Mã này không dành cho tài khoản của bạn. |
| D373 | `TOO_MANY_ATTEMPTS` | Bạn nhập sai quá nhiều lần. Thử lại sau 1 giờ. |
| D374 | `CANNOT_GIFT_SELF` | Không tự tặng quà cho chính mình được. |
| D375 | `GIFT_DAILY_LIMIT` | Bạn đã tặng quà tối đa trong hôm nay. Mai tiếp nhé! |
| D376 | `GIFT_NOT_AVAILABLE` | Quà này hiện không còn (hết mùa hoặc đã ngừng). |
| D377 | `GIFT_CONTEXT_REQUIRED` | Quà này chỉ tặng được trên bài chạy đạt đúng mốc (5K, 10K, Half, Full, Ultra hoặc kỷ lục cá nhân). |
| D378 | `VIP_REQUIRED` | Quà này dành cho thành viên VIP. |
| D379 | `INVALID_QTY` | Số lượng quà không hợp lệ. |
| D380 | `CHEER_REPLACED_BY_GIFTS` | Tặng Xu trực tiếp đã được thay bằng Quà tặng. Hãy cập nhật ứng dụng. |
| D381 | `INSUFFICIENT_BALANCE` | Số Xu trong ví không đủ. |
| D382 | `SHIELD_LIMIT` | Bạn đã có số khiên tối đa. |
| D383 | `INSUFFICIENT_SHINE` | Tỏa sáng khả dụng chưa đủ. |
| D384 | `SHINE_LIMIT` | Bạn đã đổi món này đủ số lần trong kỳ. |
| D385 | `SHINE_NEED_SENDERS` | Cần Tỏa sáng từ đủ số người tặng khác nhau trong 30 ngày. |
| D386 | `SHINE_ONLY` | Vật phẩm này chỉ đổi bằng Tỏa sáng. |
| D387 | `SHINE_ITEM_NOT_FOUND` | Món này không còn trong cửa hàng Tỏa sáng. |
| D388 | `ALREADY_OWNED` | Bạn đã có vật phẩm này. |
| D389 | `ALREADY_THANKED` | Hôm nay bạn đã cảm ơn người này rồi. |
| D390 | `NOT_A_SUPPORTER` | Chỉ cảm ơn được người đã tặng quà cho bạn trong 30 ngày. |
| D391 | `THANKS_LIMIT` | Hôm nay bạn đã gửi đủ lời cảm ơn. |
| D392 | `INVALID_AMOUNT` | Số Xu không hợp lệ (1–10). |
| D393 | `INVALID_GOAL` | Mục tiêu tuần từ 1 đến 7 ngày. |
| D394 | `MESSAGE_TOO_LONG` | Lời nhắn tối đa 140 ký tự. |
| D395 | `USER_NOT_FOUND` | Không tìm thấy người nhận. |
| D396 | `FORBIDDEN` | Bạn không có quyền làm việc này. |

**features/help/api/helpApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D397 | `PAGE_NOT_FOUND` | Không tìm thấy trang. |
| D398 | `INVALID_SLUG` | Đường dẫn chỉ gồm chữ thường không dấu, số và dấu gạch ngang (2–60 ký tự). |
| D399 | `INVALID_SECTION` | Chọn nhóm cho trang. |
| D400 | `INVALID_TITLE` | Tiêu đề cần 2–120 ký tự. |
| D401 | `FORBIDDEN` | Chỉ quản trị viên hệ thống mới sửa được. |

**features/hub/api/hubApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D402 | `HUB_NOT_JOINED` | Tham gia Hội quán (tạo hồ sơ) để đăng bài. |
| D403 | `INVALID_POST` | Bài đăng chưa hợp lệ: nội dung 5–500 ký tự, ngày hẹn trong 4 tháng tới. |
| D404 | `RACE_NAME_REQUIRED` | Ghi tên giải bạn định chạy. |
| D405 | `TOO_MANY_POSTS` | Tối đa 5 bài / ngày. Mai đăng tiếp nhé. |
| D406 | `POST_NOT_FOUND` | Bài đăng không còn (đã đóng, hết hạn hoặc bị ẩn). |
| D407 | `ACTIVITY_NOT_FOUND` | Không tìm thấy bài chạy (cần là bài hợp lệ, đã chia sẻ). |
| D408 | `INVALID_TARGET` | Không thực hiện được với bài của chính bạn. |
| D409 | `RATE_LIMITED` | Bạn thao tác hơi nhiều. Nghỉ chút rồi thử lại. |
| D410 | `INVALID_REASON` | Chọn lý do báo cáo. |

**features/knowledge/api/knowledgeApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D411 | `ALREADY_PUBLISHED` | Bài đã đăng thì không sửa được nữa — liên hệ ban biên tập nếu cần chỉnh. |
| D412 | `BODY_TOO_LONG` | Nội dung quá dài (tối đa 60.000 ký tự). |
| D413 | `RATE_LIMITED` | Bạn đã tạo nhiều bài hôm nay. Mai viết tiếp nhé! |
| D414 | `PDF_TYPE` | Ebook phải là tệp PDF. |
| D415 | `PDF_SIZE` | Tệp PDF tối đa 10 MB. |
| D416 | `ARTICLE_NOT_FOUND` | Không tìm thấy bài viết (có thể đã gỡ hoặc chưa đăng). |
| D417 | `EXPERT_REVIEW_REQUIRED` | Bài thuộc chủ đề sức khoẻ / giáo án — cần chuyên gia duyệt chuyên môn trước khi đăng. |
| D418 | `TITLE_TOO_SHORT` | Tiêu đề cần ít nhất 5 ký tự. |
| D419 | `INVALID_SLUG` | Đường dẫn bài không hợp lệ. |
| D420 | `SLUG_TAKEN` | Đường dẫn này đã có bài khác dùng — đổi tiêu đề hoặc đường dẫn. |
| D421 | `INVALID_CATEGORY` | Chọn chuyên mục. |
| D422 | `INVALID_URL` | Link ảnh / nguồn phải bắt đầu bằng https:// |
| D423 | `BODY_TOO_SHORT` | Nội dung quá ngắn: bài viết cần ít nhất 300 ký tự; ebook cần tệp PDF + vài dòng giới thiệu. |
| D424 | `INVALID_SCHEDULE` | Giờ hẹn đăng phải ở tương lai. |
| D425 | `CANNOT_REVIEW_OWN` | Không tự duyệt chuyên môn bài của mình. |
| D426 | `NOTE_REQUIRED` | Ghi rõ góp ý để người viết sửa. |
| D427 | `ARCHIVE_INSTEAD` | Bài đã từng đăng — hãy Lưu trữ thay vì xoá (giữ link và thống kê). |
| D428 | `IMAGE_TYPE` | Chỉ nhận ảnh JPG, PNG, WEBP. |
| D429 | `IMAGE_SIZE` | Ảnh tối đa 5 MB. |
| D430 | `FORBIDDEN` | Bạn không có quyền làm việc này. |

**features/market/api/bibApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D431 | `NOT_ELIGIBLE` | Cần ít nhất 3 bài chạy hợp lệ để đăng tin BIB (chống tài khoản ảo, lừa đảo). |
| D432 | `PRICE_ABOVE_ORIGINAL` | Chợ BIB không cho bán cao hơn giá gốc — giúp runner mua đúng giá. |
| D433 | `PRICE_REQUIRED` | Nhập giá gốc và giá nhượng. |
| D434 | `CONTACT_REQUIRED` | Nhập ít nhất một cách liên hệ hợp lệ (số điện thoại, Zalo hoặc link Facebook). |
| D435 | `RACE_DATE_PAST` | Ngày giải đã qua. |
| D436 | `RACE_REQUIRED` | Nhập tên giải. |
| D437 | `INVALID_DISTANCE` | Chọn cự ly. |
| D438 | `NO_LINKS` | Ghi chú không được chứa link (trừ Facebook). |
| D439 | `TOO_MANY_LISTINGS` | Mỗi runner tối đa 5 tin đang mở. Đóng bớt tin cũ nhé. |
| D440 | `TOO_MANY_REVEALS` | Bạn đã xem liên hệ của nhiều tin trong 24 giờ. Thử lại sau. |
| D441 | `LISTING_NOT_FOUND` | Tin không còn tồn tại. |
| D442 | `LISTING_HIDDEN` | Tin đang bị ẩn — chờ quản trị viên xem xét. |
| D443 | `RATE_LIMITED` | Bạn đăng hơi nhiều trong hôm nay. Thử lại sau. |
| D444 | `FORBIDDEN` | Bạn không có quyền làm việc này. |

**features/market/api/marketApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D445 | `PARTNER_EXISTS` | Bạn đã có hồ sơ loại này — hãy sửa hồ sơ hiện có. |
| D446 | `PARTNER_NOT_FOUND` | Không tìm thấy hồ sơ (có thể chưa được xác minh hoặc đã bị ẩn). |
| D447 | `INVALID_PARTNER_IMAGE` | Ảnh phải tải lên từ RaceHub. |
| D448 | `INVALID_PARTNER` | Nhập tên hồ sơ (ít nhất 2 ký tự) và chọn loại. |
| D449 | `INVALID_CONTACT` | Liên hệ chưa đúng: điện thoại 8–16 số; Facebook / website bắt đầu bằng https://; email hợp lệ. |
| D450 | `TOO_MANY_SERVICES` | Tối đa 12 dịch vụ. |
| D451 | `REASON_REQUIRED` | Nhập lý do (ít nhất 3 ký tự) để chủ hồ sơ biết cần sửa gì. |
| D452 | `FORBIDDEN` | Bạn không có quyền sửa hồ sơ này. |

**features/nearby/api/nearbyApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D453 | `CONSENT_REQUIRED` | Cần đồng ý điều khoản chia sẻ vị trí gần đúng trước khi bật. |
| D454 | `NOT_ELIGIBLE` | Cần ít nhất 3 bài chạy hợp lệ để bật Quanh đây (chống tài khoản ảo). |
| D455 | `NEARBY_SUSPENDED` | Quanh đây của bạn đang tạm khoá do có báo cáo, chờ quản trị viên xem xét. |
| D456 | `NEARBY_DISABLED` | Bạn chưa bật Quanh đây. |
| D457 | `NO_PRESENCE` | Hãy bật "Khu hay chạy tự động" hoặc chọn vị trí gần đúng để tìm runner quanh đây. |
| D458 | `TOO_MANY_MOVES` | Bạn đã đổi vị trí 3 lần trong 24 giờ. Thử lại sau (bảo vệ quyền riêng tư của mọi người). |
| D459 | `TOO_MANY_SEARCHES` | Bạn tìm quá nhiều lần trong 1 giờ. Nghỉ chút rồi thử lại. |
| D460 | `INVALID_LOCATION` | Vị trí không hợp lệ. |
| D461 | `TARGET_UNAVAILABLE` | Runner này hiện không nhận kết nối. |
| D462 | `ALREADY_CONNECTED` | Hai bạn đã kết nối. |
| D463 | `ALREADY_REQUESTED` | Bạn đã gửi lời mời, chờ người kia trả lời. |
| D464 | `REQUEST_COOLDOWN` | Lời mời trước bị từ chối — 30 ngày sau mới gửi lại được. |
| D465 | `TOO_MANY_REQUESTS` | Bạn đã gửi đủ số lời mời hôm nay. Mai gửi tiếp nhé. |
| D466 | `NO_LINKS` | Không ghi link, số điện thoại, Zalo / Telegram / Facebook. Kết nối xong hai bạn nhắn tin trong RaceHub. |
| D467 | `INVALID_SETTINGS` | Thông tin chưa hợp lệ (tỉnh / thành, mục tiêu, khung giờ). Kiểm tra lại nhé. |
| D468 | `NOT_CONNECTED` | Chỉ rủ được người đã kết nối. |
| D469 | `REQUEST_CLOSED` | Lời mời đã được xử lý. |
| D470 | `EVENT_FULL` | Buổi chạy đã đủ người. |
| D471 | `EVENT_ENDED` | Buổi chạy đã kết thúc. |
| D472 | `EVENT_CANCELLED` | Buổi chạy đã bị huỷ. |
| D473 | `EVENT_NOT_FOUND` | Không tìm thấy buổi chạy (có thể đã chuyển về chỉ thành viên CLB). |
| D474 | `EVENT_NEEDS_LOCATION` | Buổi chạy công khai cần toạ độ điểm hẹn (nơi công cộng). |
| D475 | `EVENT_NOT_PUBLIC` | Người này không thuộc CLB đó — chỉ rủ được vào buổi chạy công khai. |
| D476 | `FORBIDDEN` | Bạn không có quyền làm việc này. |

**features/org/api/orgApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D477 | `NAME_REQUIRED` | Hãy nhập tên người liên hệ. |
| D478 | `ORG_NAME_REQUIRED` | Hãy nhập tên tổ chức (ít nhất 2 ký tự). |
| D479 | `INVALID_PHONE` | Số điện thoại chưa đúng. |
| D480 | `RATE_LIMITED` | Bạn đã gửi nhiều yêu cầu hôm nay. Chúng tôi sẽ liên hệ sớm. |
| D481 | `OWNER_NOT_FOUND` | Không tìm thấy tài khoản với email này. Người quản trị cần đăng ký RaceHub trước. |
| D482 | `ORG_NOT_FOUND` | Không tìm thấy tổ chức. |
| D483 | `NOT_DEMO` | Chỉ xoá được tổ chức demo. |
| D484 | `NOT_A_MEMBER` | Bạn chưa là thành viên tổ chức này. |
| D485 | `INVALID_CODE` | Mã mời không đúng hoặc đã được đổi. |
| D486 | `ORG_INACTIVE` | Gói của tổ chức đã hết hạn hoặc tạm dừng. Liên hệ quản trị tổ chức. |
| D487 | `ORG_FULL` | Tổ chức đã đủ số chỗ theo hợp đồng. Quản trị tổ chức cần nâng số chỗ. |
| D488 | `OWNER_CANNOT_LEAVE` | Người sở hữu tổ chức không thể rời. Liên hệ RaceHub để chuyển quyền. |
| D489 | `UNIT_EXISTS` | Tên đơn vị đã có. |
| D490 | `UNIT_LIMIT` | Tối đa 500 đơn vị. |
| D491 | `INVALID_NAME` | Tên không hợp lệ. |
| D492 | `INVALID_UNIT_LABEL` | Tên gọi đơn vị dài 2–30 ký tự. |
| D493 | `TAGLINE_TOO_LONG` | Khẩu hiệu tối đa 80 ký tự. |
| D494 | `INVALID_URL` | Link ảnh phải bắt đầu bằng https:// |
| D495 | `CLUB_NOT_FOUND` | Không tìm thấy CLB. |
| D496 | `CLUB_IN_ORG` | CLB này đang thuộc một tổ chức khác. |
| D497 | `ALREADY_INVITED` | Đã mời CLB này rồi. |
| D498 | `ORG_CLUB_LIMIT` | Đã đủ số CLB theo hợp đồng. |
| D499 | `INVITE_NOT_FOUND` | Lời mời không còn hiệu lực. |
| D500 | `TITLE_REQUIRED` | Tên chiến dịch cần 3–120 ký tự. |
| D501 | `INVALID_METRIC` | Cách tính không hợp lệ. |
| D502 | `INVALID_TIME_RANGE` | Thời gian không hợp lệ (tối đa 1 năm). |
| D503 | `REASON_REQUIRED` | Hãy ghi lý do (ít nhất 3 ký tự). |
| D504 | `MEMBER_NOT_FOUND` | Không tìm thấy thành viên. |
| D505 | `IMAGE_TYPE` | Chỉ nhận ảnh JPG, PNG hoặc WebP. |
| D506 | `IMAGE_SIZE` | Ảnh quá lớn, hãy chọn ảnh khác. |
| D507 | `FORBIDDEN` | Bạn không có quyền làm việc này. |
| D508 | `DOMAIN_REQUIRED_LIST` | Bật "chỉ nhận email công ty" cần khai báo ít nhất một tên miền. |
| D509 | `DOMAIN_REQUIRED` | Tổ chức chỉ nhận tài khoản dùng email công ty. Hãy đăng nhập bằng email công ty. |
| D510 | `INVALID_DOMAIN` | Tên miền không hợp lệ (vd: congty.vn), tối đa 10 tên miền. |
| D511 | `PUBLIC_DOMAIN` | Không dùng tên miền email công cộng (gmail, yahoo…). |
| D512 | `UNIT_CYCLE` | Không thể đặt đơn vị làm con của chính nó. |
| D513 | `UNIT_DEPTH` | Tối đa 4 cấp đơn vị. |
| D514 | `UNIT_REQUIRED` | Gán đơn vị trước khi chọn làm trưởng đơn vị. |
| D515 | `INVALID_ROWS` | Danh sách không hợp lệ (tối đa 5.000 dòng). |
| D516 | `CAMPAIGN_LOCKED` | Chiến dịch đã chốt kết quả, không sửa được. |
| D517 | `CAMPAIGN_NOT_ENDED` | Chiến dịch chưa kết thúc. |
| D518 | `CAMPAIGN_NOT_LOCKED` | Hãy chốt kết quả trước khi duyệt. |
| D519 | `TOO_MANY_BOOST_DAYS` | Tối đa 20 ngày hội. |
| D520 | `NOT_ELIGIBLE` | Bạn chưa đủ điều kiện nhận chứng nhận. |
| D521 | `CERT_DISABLED` | Chiến dịch không cấp chứng nhận. |
| D522 | `INVALID_CERT_IMAGE` | Ảnh chứng nhận phải tải lên từ kho ảnh của tổ chức. |
| D523 | `INVALID_CERT_DESIGN` | Mẫu chứng nhận không hợp lệ. |
| D524 | `POSTS_ADMIN_ONLY` | Chỉ quản trị tổ chức được đăng bài. |
| D525 | `EMPTY_POST` | Hãy viết nội dung. |
| D526 | `EMPTY_COMMENT` | Hãy viết bình luận. |
| D527 | `NOT_AUTHOR` | Chỉ người viết mới sửa được bình luận này. |
| D528 | `COMMENT_NOT_FOUND` | Bình luận không còn nữa. |
| D529 | `POST_NOT_FOUND` | Bài đăng không còn. |
| D530 | `INVALID_IMAGE_PATH` | Ảnh không hợp lệ, hãy tải lại. |

**features/profile/api/profileApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D531 | `INVALID_NAME` | Tên hiển thị cần từ 2 đến 40 ký tự. |
| D532 | `INVALID_BIO` | Giới thiệu tối đa 160 ký tự. |
| D533 | `INVALID_GENDER` | Giới tính không hợp lệ. |
| D534 | `INVALID_BIRTH_DATE` | Ngày sinh không hợp lệ (bạn cần từ 10 tuổi trở lên). |
| D535 | `INVALID_HEIGHT` | Chiều cao cần từ 100 đến 250 cm. |
| D536 | `INVALID_WEIGHT` | Cân nặng cần từ 25 đến 250 kg. |
| D537 | `INVALID_PROFILE` | Thông tin hồ sơ không hợp lệ. |

**features/profile/components/SettingsScreen.tsx**

| # | Mã | Câu báo |
|---|---|---|
| D538 | `CONFIRM_REQUIRED` | Gõ đúng chữ XOÁ để xác nhận. |
| D539 | `ADMIN_CANNOT_DELETE` | Tài khoản quản trị viên cần được gỡ quyền quản trị trước khi xoá. |
| D540 | `TRANSFER_CLUB_FIRST` | Bạn đang là chủ nhiệm CLB còn thành viên — hãy chuyển quyền chủ nhiệm cho người khác trước. |

**features/race/api/raceApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D541 | `FORBIDDEN` | Bạn không có quyền làm việc này. |
| D542 | `APP_OUTDATED` | Ứng dụng vừa được cập nhật — tải lại trang rồi lưu lại thiết kế. |
| D543 | `RACE_ORGANIZER_REQUIRED` | Chỉ CLB hoặc cá nhân được RaceHub cấp quyền mới tạo được giải chạy. Liên hệ admin để đăng ký. |
| D544 | `CAPACITY_REQUIRED` | Chọn quy mô (số VĐV tối đa) — phí tạo giải tính theo quy mô. |
| D545 | `INSUFFICIENT_BALANCE` | Ví của bạn không đủ Xu trả phí tạo giải. |
| D546 | `INSUFFICIENT_TREASURY` | Quỹ CLB không đủ Xu trả phí tạo giải. |
| D547 | `RACE_NOT_FOUND` | Không tìm thấy giải (hoặc giải chỉ dành cho thành viên CLB). |
| D548 | `RACE_CANCELLED` | Giải đã bị hủy. |
| D549 | `REGISTRATION_CLOSED` | Đã hết hạn đăng ký. |
| D550 | `RACE_FULL` | Giải đã đủ số VĐV. |
| D551 | `INVALID_DISTANCE` | Cự ly không có trong giải. |
| D552 | `RACE_STARTED` | Giải đã bắt đầu, không rút tên được nữa. |
| D553 | `NOT_REGISTERED` | Bạn chưa đăng ký giải này. |
| D554 | `INVALID_TITLE` | Tên giải cần từ 3 đến 120 ký tự. |
| D555 | `INVALID_TIME_RANGE` | Thời gian kết thúc phải sau thời gian bắt đầu. |
| D556 | `INVALID_DURATION` | Giải kéo dài tối đa 3 tháng và chưa kết thúc. |
| D557 | `INVALID_REG_CLOSE` | Hạn đăng ký phải trước khi giải kết thúc. |
| D558 | `INVALID_AUDIENCE` | Giải nội bộ cần chọn CLB. |
| D559 | `INVALID_MAX` | Số VĐV tối đa từ 2 đến 100.000. |
| D560 | `INVALID_BIB_PREFIX` | Tiền tố BIB chỉ gồm chữ và số, tối đa 6 ký tự. |
| D561 | `INVALID_DISTANCES` | Chọn 1–6 cự ly, mỗi cự ly từ 1 đến 250 km. |
| D562 | `INVALID_BIB_DESIGN` | Thiết kế BIB không hợp lệ. |
| D563 | `INVALID_BIB_IMAGE` | Ảnh phải được tải lên từ trình thiết kế BIB của giải này. |
| D564 | `INVALID_IMAGE_TYPE` | Chỉ nhận ảnh PNG, JPG hoặc WebP. |
| D565 | `IMAGE_TOO_LARGE` | Ảnh quá lớn, không nén được. Thử ảnh nhỏ hơn. |
| D566 | `AUTH_REQUIRED` | Phiên đăng nhập đã hết, vui lòng đăng nhập lại. |

**features/referral/api/referralApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D567 | `AUTH_REQUIRED` | Bạn cần đăng nhập để nhận lời mời. |
| D568 | `CANNOT_REFER_SELF` | Bạn không thể tự giới thiệu chính mình. |
| D569 | `ALREADY_REFERRED` | Tài khoản của bạn đã nhận lời mời của người khác trước đó. |
| D570 | `REFERRER_NOT_FOUND` | Mã giới thiệu không đúng. Kiểm tra lại 8 ký tự trên link / tin nhắn mời. |
| D571 | `REFERRAL_WINDOW_EXPIRED` | Chỉ nhập được mã giới thiệu trong 14 ngày đầu sau khi tạo tài khoản. |

**features/social/api/socialApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D572 | `SPAM` | Làm phiền / spam |
| D573 | `INVALID_TARGET` | Không thực hiện được với chính bạn. |
| D574 | `USER_NOT_FOUND` | Không tìm thấy runner này. |
| D575 | `BLOCKED` | Hai bạn đang chặn nhau nên không làm được việc này. |
| D576 | `DM_NOT_ALLOWED` | Chỉ nhắn được khi người này theo dõi bạn, là bạn kết nối, cùng CLB hoặc đã từng nhắn cho bạn. |
| D577 | `RATE_LIMITED` | Bạn thao tác hơi nhanh. Nghỉ một chút rồi thử lại nhé. |
| D578 | `EMPTY_MESSAGE` | Tin nhắn đang trống (tối đa 2000 ký tự). |
| D579 | `NOT_AUTHOR` | Chỉ người gửi mới thu hồi được tin này. |
| D580 | `NOT_FOUND` | Tin nhắn không còn nữa. |
| D581 | `INVALID_REASON` | Hãy chọn lý do báo cáo. |
| D582 | `INVALID_EMOJI` | Cảm xúc này chưa được hỗ trợ. |

**features/system/api/systemApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D583 | `INVALID_LEVEL` | Mức thông báo không hợp lệ. |
| D584 | `INVALID_TITLE` | Tiêu đề cần 2–80 ký tự. |
| D585 | `INVALID_MESSAGE` | Nội dung tối đa 500 ký tự. |
| D586 | `INVALID_TIME_RANGE` | Thời điểm tự tắt phải ở tương lai. |
| D587 | `FORBIDDEN` | Chỉ quản trị hệ thống mới làm được việc này. |
| D588 | `INVALID_CONFIG` | Giá trị ngoài giới hạn cho phép — kiểm tra lại các ô vừa sửa. |
| D589 | `VERSION_NOT_FOUND` | Không tìm thấy phiên bản này. |

**features/victory/api/victoryApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D590 | `NOT_PARTICIPANT` | Người này chưa tham gia thử thách. |
| D591 | `NO_RESULT` | Chưa có kết quả để vinh danh — hãy chạy ít nhất một bài hợp lệ trong thử thách. |
| D592 | `NOT_ELIGIBLE` | Chưa đạt thành tích này. |
| D593 | `NOT_FOUND` | Không tìm thấy thành tích. |
| D594 | `FORBIDDEN` | Chỉ người tạo thử thách, ban quản trị CLB hoặc admin mới vinh danh người khác và đặt danh hiệu. |
| D595 | `RATE_LIMITED` | Bạn đã tạo quá nhiều ảnh hôm nay. Thử lại ngày mai. |
| D596 | `VICTORY_LOCKED` | Victory Studio dành cho runner VIP, thành viên CLB Pro hoặc doanh nghiệp. Nâng cấp để xuất ảnh. |

**features/victory/model/victory.ts**

| # | Mã | Câu báo |
|---|---|---|
| D597 | `CHALLENGE` | Thử thách |

**features/voucher/api/voucherApi.ts**

| # | Mã | Câu báo |
|---|---|---|
| D598 | `FORBIDDEN` | Chỉ Ban tổ chức thử thách hoặc admin mới làm được việc này. |
| D599 | `INVALID_URL` | Đường link / logo phải bắt đầu bằng https:// |
| D600 | `INVALID_VOUCHER_CODE` | Nhập mã chung (ít nhất 3 ký tự). |
| D601 | `INVALID_VOUCHER` | Thông tin voucher chưa hợp lệ (Top N từ 1 đến 100, chỉ áp cho thử thách). |
| D602 | `TOO_MANY_CODES` | Tối đa 5.000 mã mỗi lần dán. |
| D603 | `VOUCHER_NOT_FOUND` | Không tìm thấy voucher. |

**shared/lib/errors.ts**

| # | Mã | Câu báo |
|---|---|---|
| D604 | `AUTH_REQUIRED` | Bạn cần đăng nhập để tiếp tục. |
| D605 | `FORBIDDEN` | Bạn không có quyền thực hiện thao tác này. |
| D606 | `INSUFFICIENT_BALANCE` | Số dư Xu không đủ. |
| D607 | `INSUFFICIENT_FUNDS` | Số dư Xu không đủ. |
| D608 | `INVALID_TITLE` | Tên thử thách cần từ 3 đến 120 ký tự. |
| D609 | `INVALID_TIME_RANGE` | Thời gian kết thúc phải sau thời gian bắt đầu. |
| D610 | `INVALID_MAX_SLOTS` | Số người tham gia tối đa không hợp lệ (1 – 10.000). |
| D611 | `INVALID_DISTANCE` | Cự ly không hợp lệ. |
| D612 | `INVALID_PACE` | Khoảng pace không hợp lệ. |
| D613 | `INVALID_CHALLENGE_TYPE` | Loại thử thách không hợp lệ. |
| D614 | `IDEMPOTENCY_KEY_REQUIRED` | Yêu cầu không hợp lệ, vui lòng thử lại. |
| D615 | `ACTIVITY_DUPLICATE` | Bài chạy này đã được lưu trước đó. |
| D616 | `RATE_LIMITED` | Bạn thao tác quá nhanh, thử lại sau ít phút. |
| D617 | `NOT_A_MEMBER` | Bạn chưa là thành viên CLB này. |

## E. Thông báo nhanh (toast)

| # | Kiểu | Câu | Vị trí |
|---|---|---|---|
| E1 | success | Kết nối Strava thành công! | `app/(app)/me/page.tsx:36` |
| E2 | success | Đã nhận lời mời của ${r.referrer_name}! Chạy đủ km đầu tiên để cả hai nhận Xu 🎉 | `app/join/[code]/page.tsx:24` |
| E3 | error | Mật khẩu cần ít nhất 8 ký tự. | `app/reset-password/page.tsx:23` |
| E4 | error | Mật khẩu nhập lại không khớp. | `app/reset-password/page.tsx:24` |
| E5 | error | Không đặt được mật khẩu: | `app/reset-password/page.tsx:28` |
| E6 | success | Đã cập nhật mật khẩu | `app/reset-password/page.tsx:29` |
| E7 | success | Đã khôi phục — bài được tính Xu, XP và thử thách | `features/activity/components/RejectedRuns.tsx:17` |
| E8 | error | Không thực hiện được. Hãy thử lại. | `features/activity/components/ReviewNotice.tsx:31` |
| E9 | error | Không tạo được ảnh. Thử lại. | `features/activity/components/ShareActivity.tsx:43` |
| E10 | error | Không chia sẻ được. Hãy tải ảnh về rồi đăng. | `features/activity/components/ShareActivity.tsx:57` |
| E11 | success | Đã xóa CLB ${club.name} | `features/admin/components/ClubsProTab.tsx:109` |
| E12 | success | Đã chép | `features/admin/components/SystemTab.tsx:225` |
| E13 | success | Đã cập nhật trang Gói (chính sách vận hành bản v${v}) | `features/admin/components/commerce/FreePlansEditor.tsx:51` |
| E14 | success | Đã lưu quà | `features/admin/components/commerce/GiftsTab.tsx:40` |
| E15 | success | Đã kết thúc chương trình — giá về giá gốc | `features/admin/components/commerce/ItemPromos.tsx:48` |
| E16 | success | Đã lưu gói nạp Xu | `features/admin/components/commerce/PlansTab.tsx:149` |
| E17 | success | Đã cấp ${code} ${MONTH_LABEL[months]} cho ${target?.name} | `features/admin/components/commerce/PlansTab.tsx:191` |
| E18 | success | Đã lưu tài khoản nhận tiền | `features/admin/components/commerce/PlansTab.tsx:52` |
| E19 | success | Đã lưu ${name} | `features/admin/components/commerce/PlansTab.tsx:96` |
| E20 | success | Đã tặng cho ${formatNumber(r.recipients)} người | `features/admin/components/commerce/PromotionsTab.tsx:138` |
| E21 | success | Đã tạo mã ${code} | `features/admin/components/commerce/PromotionsTab.tsx:166` |
| E22 | success | Đã bật đợt giảm giá | `features/admin/components/commerce/PromotionsTab.tsx:201` |
| E23 | success | Đã cập nhật | `features/admin/components/commerce/PromotionsTab.tsx:241` |
| E24 | error | Hãy chọn một CLB | `features/admin/components/commerce/PromotionsTab.tsx:73` |
| E25 | success | Đã lưu nhiệm vụ | `features/admin/components/commerce/QuestsTab.tsx:32` |
| E26 | success | Đã lưu giới hạn | `features/admin/components/commerce/QuestsTab.tsx:90` |
| E27 | success | Đã lưu | `features/admin/components/commerce/ShineAdmin.tsx:25` |
| E28 | success | Đã lưu cài đặt | `features/admin/components/commerce/ShineAdmin.tsx:26` |
| E29 | success | Đã hủy thử thách và báo người tham gia | `features/admin/components/console/ChallengesTab.tsx:66` |
| E30 | error | Hãy ghi lý do (ít nhất 3 ký tự). | `features/admin/components/console/ChallengesTab.tsx:72` |
| E31 | error | Không tạo được file Excel, thử lại. | `features/admin/components/console/GpsQaTab.tsx:76` |
| E32 | success | Đã áp dụng chính sách vận hành bản v${v} | `features/admin/components/console/OpsPolicyTab.tsx:104` |
| E33 | success | Đã khôi phục — đang dùng bản v${v} | `features/admin/components/console/OpsPolicyTab.tsx:242` |
| E34 | success | Đã chuyển chính sách · ${formatNumber(r.changed)} bài Strava được cập nhật | `features/admin/components/console/StravaTab.tsx:28` |
| E35 | error | Ghi lý do (ít nhất 3 ký tự) | `features/admin/components/console/StravaTab.tsx:60` |
| E36 | info | Đã sao chép | `features/admin/components/console/TeamTab.tsx:100` |
| E37 | success | Đã phân quyền cho ${member.display_name ?? 'admin'} | `features/admin/components/console/TeamTab.tsx:114` |
| E38 | success | Đã gỡ quyền admin | `features/admin/components/console/TeamTab.tsx:147` |
| E39 | error | Hãy ghi lý do (ít nhất 3 ký tự). | `features/admin/components/console/UsersTab.tsx:145` |
| E40 | success | Đã tặng ${qty} lượt tạo cho ${target.name} | `features/admin/components/economy/PassesTab.tsx:38` |
| E41 | success | Đã thu hồi vé | `features/admin/components/economy/PassesTab.tsx:49` |
| E42 | success | Đã áp dụng chính sách phiên bản ${v} | `features/admin/components/economy/PolicyTab.tsx:79` |
| E43 | success | Đã lưu bộ sưu tập | `features/admin/components/items/CollectionsPanel.tsx:69` |
| E44 | success | Đã tạo bộ ${name.trim()} (${items.length} món) | `features/admin/components/items/KitSheet.tsx:59` |
| E45 | success | Đã duyệt ${name.trim()} | `features/admin/components/items/UniformReviewPanel.tsx:103` |
| E46 | success | Đã trả lại mẫu cho CLB | `features/admin/components/items/UniformReviewPanel.tsx:150` |
| E47 | success | Đã chép ${label.toLowerCase()} | `features/billing/components/OrderSheet.tsx:25` |
| E48 | success | Đã hủy đơn | `features/billing/components/OrderSheet.tsx:46` |
| E49 | success | Đã sao chép link mời | `features/challenge/components/detail/ChallengeDetailScreen.tsx:572` |
| E50 | error | Không sao chép được, hãy chọn và sao chép thủ công. | `features/challenge/components/detail/ChallengeDetailScreen.tsx:572` |
| E51 | success | Đã đổi hạn đăng ký | `features/challenge/components/detail/ChallengeExtras.tsx:30` |
| E52 | success | Đã lưu hạng mục của bạn | `features/challenge/components/detail/ConquestPanel.tsx:63` |
| E53 | success | Đã chia đội và báo cho mọi người | `features/challenge/components/detail/PledgePanel.tsx:209` |
| E54 | success | Đã lưu mục tiêu của bạn | `features/challenge/components/detail/PledgePanel.tsx:52` |
| E55 | success | Đã lưu thể lệ | `features/challenge/components/detail/RulesInfo.tsx:100` |
| E56 | success | Đã lưu thiết kế vinh danh | `features/challenge/components/honor/HonorDesigner.tsx:51` |
| E57 | success | Đã đổi ảnh vinh danh | `features/challenge/components/honor/HonorPanel.tsx:176` |
| E58 | success | Đã đổi ảnh | `features/challenge/components/honor/HonorPanel.tsx:228` |
| E59 | success | Đã lưu hạng mục vinh danh | `features/challenge/components/honor/HonorSetup.tsx:37` |
| E60 | success | Đã đặt làm mẫu ảnh nhóm của tab Vinh danh thử thách | `features/challenge/components/honor/HonorStudioScreen.tsx:117` |
| E61 | error | Đã tạo thử thách nhưng chưa bật được mục tiêu tự đăng ký: ${challengeErrorMessage(e)} | `features/challenge/components/wizard/CreateChallengeScreen.tsx:105` |
| E62 | error | Đã tạo thử thách nhưng chưa lưu được thể lệ (sửa lại ở tab Luật chơi): ${challengeErrorMessage(e)} | `features/challenge/components/wizard/CreateChallengeScreen.tsx:109` |
| E63 | error | Đã tạo thử thách nhưng chưa bật được tự lặp lại: ${challengeErrorMessage(e)} | `features/challenge/components/wizard/CreateChallengeScreen.tsx:113` |
| E64 | success | Đã chép luật từ "${t.title}" — kiểm tra lại rồi tạo | `features/challenge/components/wizard/CreateChallengeScreen.tsx:145` |
| E65 | error | Kiểm tra lại các ô được đánh dấu. | `features/challenge/components/wizard/CreateChallengeScreen.tsx:76` |
| E66 | error | Đã tạo thử thách nhưng chưa lưu được hạng mục: ${challengeErrorMessage(e)} | `features/challenge/components/wizard/CreateChallengeScreen.tsx:95` |
| E67 | error | Đã tạo thử thách nhưng chưa đặt được hạn đăng ký: ${challengeErrorMessage(e)} | `features/challenge/components/wizard/CreateChallengeScreen.tsx:99` |
| E68 | error | Tối đa 12 lớp in. | `features/character/components/GarmentDesigner.tsx:193` |
| E69 | error | Tối đa 12 lớp in. | `features/character/components/GarmentDesigner.tsx:198` |
| E70 | error | Ảnh tối đa 2 MB. | `features/character/components/GarmentDesigner.tsx:199` |
| E71 | error | Không tải được ảnh. Hãy thử lại. | `features/character/components/GarmentDesigner.tsx:202` |
| E72 | error | Không tìm được màu trong ảnh này. | `features/character/components/KitStudio.tsx:120` |
| E73 | success | Đã lấy màu CLB | `features/character/components/KitStudio.tsx:127` |
| E74 | error | Không đọc được ảnh. Thử ảnh PNG / JPG khác. | `features/character/components/KitStudio.tsx:129` |
| E75 | success | Đã gắn logo CLB lên ngực áo | `features/character/components/KitStudio.tsx:151` |
| E76 | error | Không lấy được logo CLB. Hãy tải ảnh logo lên. | `features/character/components/KitStudio.tsx:153` |
| E77 | error | Ảnh tối đa 2 MB. | `features/character/components/KitStudio.tsx:380` |
| E78 | error | Không tải được ảnh. Hãy thử lại. | `features/character/components/KitStudio.tsx:383` |
| E79 | error | Logo tối đa 2 MB. | `features/character/components/PrintFields.tsx:30` |
| E80 | success | Đã gửi bộ đồng phục | `features/character/components/UniformStudio.tsx:126` |
| E81 | success | Đã hủy yêu cầu | `features/character/components/UniformStudio.tsx:45` |
| E82 | success | Đã đủ bộ đồng phục | `features/character/components/Wardrobe.tsx:105` |
| E83 | success | Đã lưu bộ đồ | `features/character/components/Wardrobe.tsx:64` |
| E84 | success | Đã mua ${buying.name} | `features/character/components/Wardrobe.tsx:74` |
| E85 | success | Đang mặc thử ${it.name} tới ${new Date(r.expires_at).toLocaleDateString('vi-VN')} | `features/character/components/Wardrobe.tsx:82` |
| E86 | success | Đã nhận ${r.items} món trong ${bundle.title} | `features/character/components/Wardrobe.tsx:87` |
| E87 | success | Đã đăng tổng kết lên bảng tin | `features/club/components/admin/ClubDashboardScreen.tsx:141` |
| E88 | info | Đã sao chép | `features/club/components/chat/ClubChatScreen.tsx:122` |
| E89 | success | Đã hủy sự kiện | `features/club/components/events/ClubEventScreen.tsx:220` |
| E90 | success | Đã sao chép link tham gia | `features/club/components/events/ClubEventScreen.tsx:50` |
| E91 | error | Không sao chép được link. | `features/club/components/events/ClubEventScreen.tsx:50` |
| E92 | success | Đã sao chép link tham gia | `features/club/components/events/EventFormSheet.tsx:156` |
| E93 | error | Không sao chép được, hãy chọn và sao chép thủ công. | `features/club/components/events/EventFormSheet.tsx:156` |
| E94 | success | Đã đóng bình chọn | `features/club/components/events/Polls.tsx:68` |
| E95 | success | Đã ghi lựa chọn | `features/club/components/events/Polls.tsx:74` |
| E96 | success | Đã tạo bình chọn | `features/club/components/events/Polls.tsx:99` |
| E97 | success | Đã gửi thư mời tới ${to!.name} | `features/club/components/exchange/ExchangeScreen.tsx:184` |
| E98 | success | Đã sửa bình luận | `features/club/components/feed/CommentsSheet.tsx:37` |
| E99 | info | Tối đa ${MAX_POST_IMAGES} ảnh mỗi bài. | `features/club/components/feed/Composer.tsx:42` |
| E100 | success | Đã xóa bài | `features/club/components/feed/PostCard.tsx:223` |
| E101 | info | Đã hủy yêu cầu tham gia | `features/club/components/hub/ClubShell.tsx:230` |
| E102 | success | Đã tạo CLB. Mời mọi người vào thôi! | `features/club/components/hub/ClubsInboxScreen.tsx:150` |
| E103 | success | Đã bỏ ngày vàng | `features/club/components/leaderboard/BoostDays.tsx:23` |
| E104 | success | Đã lưu luật bản ${v} và báo cả CLB | `features/club/components/leaderboard/ClubPoints.tsx:200` |
| E105 | success | Đã sao chép ${what} | `features/club/components/members/InvitePanel.tsx:44` |
| E106 | error | Không sao chép được, hãy chọn và sao chép thủ công. | `features/club/components/members/InvitePanel.tsx:44` |
| E107 | success | Đã xoá album | `features/club/components/photos/ClubPhotosScreen.tsx:103` |
| E108 | success | Đã cập nhật tường nhà CLB | `features/club/components/settings/BrandingEditor.tsx:31` |
| E109 | success | Đã đổi logo | `features/club/components/settings/ClubSettingsScreen.tsx:100` |
| E110 | success | Đã đổi mã mời. Link và QR cũ không còn dùng được. | `features/club/components/settings/ClubSettingsScreen.tsx:157` |
| E111 | success | Đã lưu | `features/club/components/settings/ClubSettingsScreen.tsx:181` |
| E112 | success | Đã lưu cài đặt thông báo | `features/club/components/settings/ClubSettingsScreen.tsx:64` |
| E113 | success | Đã lưu thông tin CLB | `features/club/components/settings/ClubSettingsScreen.tsx:95` |
| E114 | success | Đã ghi đơn — chuyển khoản để CLB xác nhận | `features/club/components/shop/ClubShopScreen.tsx:120` |
| E115 | success | Đã sao chép ${what} | `features/club/components/shop/ClubShopScreen.tsx:150` |
| E116 | success | Đã huỷ đơn | `features/club/components/shop/ClubShopScreen.tsx:91` |
| E117 | success | Đã báo thủ quỹ. Chờ xác nhận nhé! | `features/club/components/treasury/ClubFinance.tsx:190` |
| E118 | success | Đã nhắc ${n} người chưa đóng | `features/club/components/treasury/ClubFinance.tsx:203` |
| E119 | success | Đã sao chép ${what} | `features/club/components/treasury/ClubFinance.tsx:29` |
| E120 | error | Không sao chép được | `features/club/components/treasury/ClubFinance.tsx:29` |
| E121 | success | Đã hủy khoản | `features/club/components/treasury/ClubFinance.tsx:322` |
| E122 | success | Đã tạo kỳ thu phí | `features/club/components/treasury/ClubFinance.tsx:350` |
| E123 | success | Đã ghi vào sổ | `features/club/components/treasury/ClubFinance.tsx:377` |
| E124 | error | Ảnh tối đa 5 MB | `features/club/components/treasury/ClubFinance.tsx:393` |
| E125 | error | Hãy chọn một file ảnh. | `features/club/components/treasury/ClubFinance.tsx:409` |
| E126 | error | Ảnh tối đa 5 MB | `features/club/components/treasury/ClubFinance.tsx:410` |
| E127 | success | Đã lưu ảnh QR | `features/club/components/treasury/ClubFinance.tsx:411` |
| E128 | success | Đã gỡ tài khoản | `features/club/components/treasury/ClubFinance.tsx:422` |
| E129 | success | Đã lưu tài khoản | `features/club/components/treasury/ClubFinance.tsx:424` |
| E130 | success | Đã gỡ ảnh QR | `features/club/components/treasury/ClubFinance.tsx:440` |
| E131 | success | Cảm ơn bạn đã góp ${formatCoin(value)} Xu vào quỹ! | `features/club/components/treasury/ClubTreasuryScreen.tsx:93` |
| E132 | success | Đã gửi lời thách đấu — chờ đối thủ trả lời | `features/cup/components/ClubMatches.tsx:108` |
| E133 | success | Đã bật hiện bài Strava — bài chạy sẽ được tính | `features/cup/components/MatchParts.tsx:60` |
| E134 | error | Không bật được. Vào Cài đặt → Quyền riêng tư để bật. | `features/cup/components/MatchParts.tsx:61` |
| E135 | success | Đã tạo lượt quay | `features/draw/components/DrawPanel.tsx:199` |
| E136 | success | Đã sao chép kết quả — dán vào Zalo / Facebook | `features/draw/components/DrawPanel.tsx:84` |
| E137 | error | Không sao chép được | `features/draw/components/DrawPanel.tsx:84` |
| E138 | info | ${shown.name}: vắng mặt — quay lại ${shown.prize} | `features/draw/components/DrawStage.tsx:103` |
| E139 | success | Đã công bố kết quả và báo người trúng | `features/draw/components/DrawStage.tsx:113` |
| E140 | info | Trình duyệt này không hỗ trợ toàn màn hình | `features/draw/components/DrawStage.tsx:133` |
| E141 | success | Đã tặng ${toName} ${qty > 1 ? | `features/game/components/GiftButton.tsx:98` |
| E142 | success | ${r.title ?? 'Đã nhận khuyến mãi'}${parts.length ? | `features/game/components/PromoCodeForm.tsx:19` |
| E143 | success | Đã gửi lời cảm ơn tới ${u.display_name ?? 'runner'} 💛 | `features/game/components/ShineScreen.tsx:112` |
| E144 | success | Đã đổi ${r.name} | `features/game/components/ShineScreen.tsx:138` |
| E145 | success | Đã lưu | `features/game/components/ShineScreen.tsx:160` |
| E146 | success | Đã thêm 1 khiên giữ chuỗi | `features/game/components/StreakSheet.tsx:25` |
| E147 | success | Đã lưu trang | `features/help/components/HelpAdminTab.tsx:123` |
| E148 | success | Đã xoá trang (nội dung cũ lưu trong nhật ký quản trị) | `features/help/components/HelpAdminTab.tsx:128` |
| E149 | success | Đã lưu thông tin pháp nhân | `features/help/components/HelpAdminTab.tsx:82` |
| E150 | success | Đã gửi báo cáo | `features/hub/components/HubPostCard.tsx:143` |
| E151 | success | Đã đóng bài | `features/hub/components/HubPostCard.tsx:72` |
| E152 | success | Đã báo cho người đăng | `features/hub/components/HubPostCard.tsx:82` |
| E153 | success | Đã rời Hội quán | `features/hub/components/HubScreen.tsx:195` |
| E154 | success | Đã đăng bài | `features/hub/components/HubSheets.tsx:107` |
| E155 | error | Trình duyệt chặn cửa sổ in — hãy cho phép popup. | `features/insights/components/InsightsScreen.tsx:213` |
| E156 | error | Không lưu được lựa chọn. Thử lại sau. | `features/integrations/strava/components/StravaShareCard.tsx:27` |
| E157 | success | Đã nhận ${s.imported} bài chạy mới từ Strava | `features/integrations/strava/components/StravaSyncCard.tsx:40` |
| E158 | info | Vừa đồng bộ xong — bài chạy mới nhất đã có trong app. Thử lại sau 1 phút nếu cần. | `features/integrations/strava/components/StravaSyncCard.tsx:68` |
| E159 | warning | Không nhập bài nào: ${skipped.join('; ')}. | `features/integrations/strava/components/StravaSyncCard.tsx:72` |
| E160 | info | Không có bài chạy mới trên Strava. Bài vừa chạy có thể cần vài phút để Strava xử lý xong. | `features/integrations/strava/components/StravaSyncCard.tsx:73` |
| E161 | success | Đã nhập ${s.imported} bài chạy | `features/integrations/strava/components/StravaSyncCard.tsx:75` |
| E162 | success | Cảm ơn góp ý của bạn! | `features/knowledge/components/ArticleScreen.tsx:288` |
| E163 | success | Huy hiệu mới: Runner ham học 🎓 | `features/knowledge/components/ArticleScreen.tsx:53` |
| E164 | success | Đã đọc xong bài | `features/knowledge/components/ArticleScreen.tsx:54` |
| E165 | success | Đã sao chép link bài viết | `features/knowledge/components/ArticleScreen.tsx:99` |
| E166 | success | Đã xóa bài | `features/knowledge/components/WriteScreen.tsx:97` |
| E167 | success | Đã tải ảnh | `features/knowledge/components/cms/ArticleEditor.tsx:111` |
| E168 | success | Đã gửi góp ý | `features/knowledge/components/cms/ArticleEditor.tsx:319` |
| E169 | success | Đã xoá | `features/knowledge/components/cms/ArticleEditor.tsx:326` |
| E170 | success | Đã thêm vào ban nội dung | `features/knowledge/components/cms/CmsScreen.tsx:261` |
| E171 | success | Đã lưu tác giả | `features/knowledge/components/cms/CmsScreen.tsx:283` |
| E172 | success | Đã cập nhật | `features/market/components/BibMarket.tsx:103` |
| E173 | success | Đã gửi báo cáo — quản trị viên sẽ xem xét | `features/market/components/BibMarket.tsx:173` |
| E174 | success | Đã gỡ CLB khỏi Quanh đây | `features/nearby/components/ClubPlaceSection.tsx:34` |
| E175 | success | Đã lưu khu vực CLB | `features/nearby/components/ClubPlaceSection.tsx:43` |
| E176 | success | Đã huỷ kết nối | `features/nearby/components/ConnectionsScreen.tsx:119` |
| E177 | success | Đã rút lời mời | `features/nearby/components/ConnectionsScreen.tsx:130` |
| E178 | success | Đã bỏ chặn ${name} | `features/nearby/components/ConnectionsScreen.tsx:145` |
| E179 | success | Đã bật Quanh đây | `features/nearby/components/EnableSheet.tsx:113` |
| E180 | success | Đã bật khu hay chạy tự động | `features/nearby/components/EnableSheet.tsx:90` |
| E181 | info | Đã bật — chưa đủ dữ liệu | `features/nearby/components/EnableSheet.tsx:91` |
| E182 | error | Thiết bị không hỗ trợ định vị — hãy chạm trên bản đồ. | `features/nearby/components/LocationPicker.tsx:59` |
| E183 | error | Không lấy được vị trí. Bạn có thể chạm trên bản đồ để chọn khu vực. | `features/nearby/components/LocationPicker.tsx:63` |
| E184 | success | Đã ẩn bạn khỏi Quanh đây | `features/nearby/components/NearbyScreen.tsx:128` |
| E185 | success | Đã cập nhật khu vực | `features/nearby/components/NearbyScreen.tsx:157` |
| E186 | success | Đã gửi lời mời kết nối | `features/nearby/components/NearbyScreen.tsx:335` |
| E187 | success | Đã rủ ${name} | `features/nearby/components/RunnerCard.tsx:119` |
| E188 | success | Đã gửi báo cáo | `features/nearby/components/RunnerCard.tsx:166` |
| E189 | success | Đã chặn ${name} | `features/nearby/components/RunnerCard.tsx:198` |
| E190 | success | Đã gửi. Thông báo sẽ hiện sau vài giây. | `features/notification/components/PushSettings.tsx:56` |
| E191 | success | Đã tắt thông báo trên thiết bị này | `features/notification/components/PushSettings.tsx:61` |
| E192 | success | Đã bật thông báo trên thiết bị này | `features/notification/components/PushSettings.tsx:63` |
| E193 | error | Bạn chưa cho phép thông báo. | `features/notification/components/PushSettings.tsx:64` |
| E194 | error | Chưa xóa được thông báo. Thử lại sau. | `features/notification/hooks/useNotifications.ts:39` |
| E195 | success | Đã bật thông báo | `features/onboarding/components/OnboardingScreen.tsx:289` |
| E196 | error | Bạn chưa cho phép thông báo. Có thể bật lại trong Cài đặt. | `features/onboarding/components/OnboardingScreen.tsx:290` |
| E197 | error | Không bật được thông báo. Thử lại trong Cài đặt. | `features/onboarding/components/OnboardingScreen.tsx:292` |
| E198 | error | Có lỗi, thử lại nhé. | `features/onboarding/components/OnboardingScreen.tsx:339` |
| E199 | success | Đã kết nối Strava! Bài chạy 30 ngày gần nhất đang được đồng bộ. | `features/onboarding/components/OnboardingScreen.tsx:42` |
| E200 | success | Đã huỷ chiến dịch | `features/org/components/CampaignScreen.tsx:38` |
| E201 | success | CLB đã rời tổ chức | `features/org/components/ClubOrgCard.tsx:27` |
| E202 | success | Đã vào tổ chức | `features/org/components/JoinOrgScreen.tsx:25` |
| E203 | success | Đã gửi yêu cầu — chờ quản trị tổ chức duyệt | `features/org/components/JoinOrgScreen.tsx:26` |
| E204 | success | Đã xoá tổ chức demo | `features/org/components/admin/EnterpriseAdminTab.tsx:177` |
| E205 | success | Đã tạo tổ chức · mã mời ${r.invite_code} | `features/org/components/admin/EnterpriseAdminTab.tsx:199` |
| E206 | success | Đã cập nhật gói | `features/org/components/admin/EnterpriseAdminTab.tsx:247` |
| E207 | success | Đã sửa bình luận | `features/org/components/tabs/FeedTab.tsx:158` |
| E208 | success | Đã lưu | `features/org/components/tabs/MembersTab.tsx:110` |
| E209 | error | Không tạo được file Excel, thử lại. | `features/org/components/tabs/MembersTab.tsx:177` |
| E210 | error | Không tạo được file mẫu, thử lại. | `features/org/components/tabs/MembersTab.tsx:205` |
| E211 | error | Không tạo được file Excel, thử lại. | `features/org/components/tabs/OverviewTab.tsx:56` |
| E212 | success | Đã lưu | `features/org/components/tabs/SettingsTab.tsx:129` |
| E213 | success | Đã lưu thông tin xuất hoá đơn | `features/org/components/tabs/SettingsTab.tsx:162` |
| E214 | success | Đã lưu tên miền | `features/org/components/tabs/SettingsTab.tsx:190` |
| E215 | success | Đã đổi mã mời — mã cũ hết hiệu lực | `features/org/components/tabs/SettingsTab.tsx:43` |
| E216 | error | Không sao chép được | `features/org/components/tabs/SettingsTab.tsx:47` |
| E217 | success | Đã lưu thương hiệu | `features/org/components/tabs/SettingsTab.tsx:79` |
| E218 | success | Đã gửi lời mời — chờ ban quản trị CLB đồng ý | `features/org/components/tabs/UnitsTab.tsx:160` |
| E219 | success | Đã đổi đơn vị | `features/org/components/tabs/UnitsTab.tsx:38` |
| E220 | success | Đã bỏ CLB khỏi tổ chức | `features/org/components/tabs/UnitsTab.tsx:43` |
| E221 | success | Đã đổi ảnh đại diện | `features/profile/components/AvatarPicker.tsx:50` |
| E222 | success | Đã gỡ ảnh đại diện | `features/profile/components/AvatarPicker.tsx:55` |
| E223 | error | Hãy chọn một file ảnh. | `features/profile/components/AvatarPicker.tsx:61` |
| E224 | error | Không đọc được ảnh này. Thử ảnh JPG hoặc PNG khác. | `features/profile/components/AvatarPicker.tsx:67` |
| E225 | error | Không tạo được ảnh từ nhân vật. Thử lại sau. | `features/profile/components/AvatarPicker.tsx:78` |
| E226 | error | Không hủy được kết nối Strava. Thử lại sau. | `features/profile/components/MeScreen.tsx:89` |
| E227 | success | Đã hủy kết nối Strava | `features/profile/components/MeScreen.tsx:90` |
| E228 | success | Đã xoá tài khoản. Cảm ơn bạn đã chạy cùng RaceHub. | `features/profile/components/SettingsScreen.tsx:215` |
| E229 | success | Đã cài RaceHub lên màn hình chính | `features/pwa/components/InstallApp.tsx:37` |
| E230 | success | Đã có mạng trở lại | `features/pwa/components/OfflineBanner.tsx:25` |
| E231 | success | Đã kết nối lại máy chủ | `features/pwa/components/OfflineBanner.tsx:27` |
| E232 | success | Đã lưu thiết kế BIB — VĐV thấy ngay | `features/race/components/BibDesigner.tsx:40` |
| E233 | success | Đã tạo giải | `features/race/components/CreateRaceScreen.tsx:62` |
| E234 | success | Đã hủy giải và báo cho VĐV | `features/race/components/RaceDetailScreen.tsx:283` |
| E235 | success | Đã rút tên | `features/race/components/RaceDetailScreen.tsx:92` |
| E236 | success | Đã ghi nhận lời mời của ${x.referrer_name} | `features/referral/components/InviteScreen.tsx:118` |
| E237 | success | Đã sao chép ${what} | `features/referral/components/InviteScreen.tsx:38` |
| E238 | error | Không sao chép được, hãy chọn và sao chép thủ công. | `features/referral/components/InviteScreen.tsx:38` |
| E239 | info | Đã bỏ bài chạy | `features/run/components/RunScreen.tsx:353` |
| E240 | success | Đã gửi bài chạy ${formatKm(item.payload.p_distance_m)} km lên RaceHub | `features/run/hooks/usePendingRuns.ts:55` |
| E241 | error | Không gửi được một bài chạy lưu trên máy | `features/run/hooks/usePendingRuns.ts:69` |
| E242 | info | Đã sao chép | `features/social/components/DirectChatScreen.tsx:126` |
| E243 | success | Đã theo dõi ${name} | `features/social/components/FollowPanel.tsx:33` |
| E244 | success | Đã gửi báo cáo | `features/social/components/ReportRunnerSheet.tsx:24` |
| E245 | error | Không chia sẻ được. Hãy lưu ảnh rồi đăng. | `features/victory/components/VictoryEditor.tsx:125` |
| E246 | error | Hãy chọn ảnh. | `features/victory/components/VictoryEditor.tsx:199` |
| E247 | success | Đã đăng lên bảng tin CLB | `features/victory/components/VictoryEditor.tsx:327` |
| E248 | error | Không vẽ được nhân vật. Thử ảnh đại diện nhé. | `features/victory/components/VictoryEditor.tsx:78` |
| E249 | success | Đã thu hồi mã xác thực | `features/victory/components/VictoryHome.tsx:140` |
| E250 | success | Đã thêm ${r.added} mã${r.issued ? | `features/voucher/components/VoucherForm.tsx:25` |
| E251 | success | Đã lưu voucher tài trợ | `features/voucher/components/VoucherForm.tsx:29` |
| E252 | success | Đã sao chép mã | `features/voucher/components/VoucherWallet.tsx:47` |
| E253 | error | Tối đa ${max} phần tử | `shared/design/studio/Studio.tsx:74` |
| E254 | error | Không lấy được vị trí — hãy kéo bản đồ tới chỗ bạn muốn. | `shared/ui/MapPickSheet.tsx:67` |
| E255 | error | Không lấy được vị trí. Hãy bật định vị cho ứng dụng, gõ tên hoặc chọn trên bản đồ. | `shared/ui/PlaceSearch.tsx:91` |
| E256 | success | Đã tải ảnh về máy | `shared/ui/SaveImage.tsx:21` |
| E257 | success | Đã mở bảng chia sẻ — chọn "Lưu ảnh" để lưu vào máy | `shared/ui/SaveImage.tsx:22` |
