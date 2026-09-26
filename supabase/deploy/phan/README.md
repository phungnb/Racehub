# Chạy database theo từng phần nhỏ

Mỗi phần: Supabase → **SQL Editor** → New query → dán toàn bộ → **Run**. Chạy lại vẫn an toàn.
Không nhớ đã chạy tới đâu: xem **Quản trị → Hệ thống → Kiểm tra hệ thống**, bắt đầu từ phần chứa migration đầu tiên bị ✗; **luôn chạy phần cuối**.

| Phần | Gồm migration | Dung lượng |
|---|---|---|
| [phan_01.sql](phan_01.sql) | 003700, 003800, 003900 | 86 KB |
| [phan_02.sql](phan_02.sql) | 004000, 004100, 004200, 004300, 004400, 004500 | 74 KB |
| [phan_03.sql](phan_03.sql) | 004600, 004700, 004800 | 89 KB |
| [phan_04.sql](phan_04.sql) | 004900, 005000, 005100, 005200 | 84 KB |
| [phan_05.sql](phan_05.sql) | 005300, 005400, 005500, 005600, 005700, 005800 | 88 KB |
| [phan_06.sql](phan_06.sql) | 005900, 006000, 006100 | 82 KB |
| [phan_07.sql](phan_07.sql) | 006200, 006300 | 83 KB |
| [phan_08.sql](phan_08.sql) | 006400, 006500, 006600, 006700, 006800, 006900 | 58 KB |
| [phan_09.sql](phan_09.sql) | 007000, 007100, 007200, 007300, 007400, 007500 | 88 KB |
| [phan_10.sql](phan_10.sql) | 007600, 007700, 007800, 007900, 008000, 008100, 008200 | 90 KB |
| [phan_11.sql](phan_11.sql) | 003500 | 20 KB |
