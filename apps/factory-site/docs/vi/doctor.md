---
title: Mã doctor
section: reference
order: 3
---

`factory doctor` kiểm tra thành phần bắt buộc và khả năng tùy chọn của Host. Mã chẩn đoán giúp xác định phần cấu hình cần xem.

## Khi nào nên dùng

Chạy sau khi cài hoặc đổi cấu hình, hoặc khi model, runtime hay tiện ích không hoạt động.

![Thiết lập liệt kê mã doctor và trạng thái từng mục](/images/docs/system.png)

*Giao diện hiển thị giải thích và cách sửa cạnh mã lỗi.*

## Đọc kết quả

1. Chạy `factory doctor` hoặc mở **Hệ thống** → **Thiết lập**.
2. Đọc lý do kèm mã. Sửa lỗi bắt buộc trước; xử lý mục tùy chọn khi cần dùng khả năng tương ứng.
3. Chạy lại `factory doctor` hoặc chọn **Kiểm tra lại**. Với script, dùng `factory doctor --json`.

| Mã | Kiểm tra gì |
| --- | --- |
| `D-NODE`, `D-UI` | Node từ 22.20 trở lên; có bản build giao diện. |
| `D-STATE` | State ghi được và hỗ trợ SQLite WAL. |
| `D-GIT`, `D-PORT` | Đã cài Git; cổng cấu hình còn trống. |
| `D-MODEL`, `D-CA` | Gateway, khóa, DNS, TLS và tệp CA. |
| `D-CODEX`, `D-CLAUDE`, `D-BWRAP` | Đăng nhập CLI hoặc bubblewrap cho khả năng đang dùng. |
| `D-LAN`, `D-BACKUP` | Đăng nhập qua LAN và bản sao lưu gần đây. |
| `D-EXT` | Tiện ích đã bật, manifest và pack. |

> **Lưu ý:** `factory doctor --model` gửi một yêu cầu thật nhỏ. Lệnh này có thể kiểm tra model không xuất hiện trong `GET /models`.

## Lỗi thường gặp

- Coi mọi lỗi tùy chọn là lý do không thể khởi động Host.
- Gọi thử model nhiều lần khi chẩn đoán đã chỉ ra lỗi tệp CA hoặc cấu hình cục bộ.

## Bước tiếp theo

[Xem cách sửa theo mã](./troubleshooting.md) hoặc [tra lệnh CLI](./cli.md).
