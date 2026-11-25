---
title: Mã doctor
section: reference
order: 3
---

## Kiểm môi trường

| Mã | Việc cần kiểm |
| --- | --- |
| `D-NODE` / `D-UI` | Chạy lại bộ cài nếu Node dưới 22.20 hoặc thiếu build UI. |
| `D-STATE` | Dùng ổ cục bộ có quyền ghi và hỗ trợ SQLite WAL. |
| `D-GIT` / `D-PORT` | Cài Git hoặc giải phóng/đổi cổng đang dùng. |
| `D-MODEL` / `D-CA` | Kiểm gateway, API key, mạng, TLS và đường dẫn file CA. |
| `D-CODEX` / `D-CLAUDE` | Nếu dùng CLI tùy chọn, kiểm cài đặt và đăng nhập. |
| `D-BWRAP` | Kiểm bubblewrap nếu chạy OpenCode hoặc xử lý tài liệu. |
| `D-LAN` / `D-BACKUP` | Kiểm token đăng nhập LAN hoặc lịch backup. |
| `D-EXT` | Kiểm đường dẫn, manifest và pack của extension. |

## Kiểm model thật

`factory doctor --model` gửi một request nhỏ đến model provider. Dùng khi gateway hỗ trợ một model không liệt kê qua `GET /models` hoặc khi cần xác minh kết nối thực tế.
