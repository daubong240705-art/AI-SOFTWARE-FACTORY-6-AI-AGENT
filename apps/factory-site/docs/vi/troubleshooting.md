---
title: Khắc phục sự cố
section: reference
order: 6
---

Dựa vào mã `factory doctor` để chọn cách sửa nhỏ nhất, rồi chạy lại phép kiểm tra. CLI vẫn dùng được trên máy chạy Host khi giao diện không mở.

## Khi nào nên dùng

Dùng khi Host không khởi động, model hoặc runtime không dùng được, hay thiếu template của tiện ích.

![Thiết lập trong Hệ thống với các mục kiểm tra bắt buộc và tùy chọn](/images/docs/system.png)

*Đọc lý do cụ thể kèm theo mã kiểm tra.*

## Sửa theo mã kiểm tra

1. Chạy `factory doctor` hoặc mở **Hệ thống** → **Thiết lập** và chọn **Kiểm tra lại**.
2. Đối chiếu lý do với bảng dưới đây. Nếu đã sửa tệp cấu hình, dùng `factory config show` để xem biến ghi đè.
3. Chạy lại `factory doctor`. Nếu Host vẫn không khởi động, kiểm tra `factory status` và `factory logs -f` để tìm lỗi khởi động.

| Mã | Cách sửa |
| --- | --- |
| `D-NODE`, `D-UI` | Chạy lại `scripts/install.sh` để lấy Node đã ghim hoặc build lại giao diện bị thiếu. |
| `D-STATE` | Dùng ổ cục bộ có quyền ghi và hỗ trợ SQLite WAL, không dùng ổ mạng hay `/mnt`. Kiểm tra quyền của tài khoản chạy Host. |
| `D-GIT` | Cài Git. Factory tự đặt danh tính khi tạo commit. |
| `D-PORT` | Nếu phù hợp, dừng tiến trình Factory cũ bằng `factory stop`, hoặc chọn `FACTORY_PORT` còn trống. |
| `D-MODEL`, `D-CA` | Kiểm tra URL gateway, xác thực, hạn mức, DNS và mạng. Nếu dùng CA nội bộ, đặt `NODE_EXTRA_CA_CERTS` trỏ đến tệp CA đọc được. |
| `D-CODEX`, `D-CLAUDE` | Nếu cần dùng CLI tương ứng, cài và đăng nhập trên máy Host. |
| `D-BWRAP` | Cài hoặc sửa `bubblewrap` cho OpenCode hoặc xử lý tài liệu. |
| `D-LAN` | Khi nghe trên LAN, đặt `FACTORY_LOGIN_TOKEN` ít nhất 24 ký tự. |
| `D-BACKUP` | Chạy `factory backup` và kiểm tra lịch nếu chưa có bản sao lưu trong 24 giờ. |
| `D-EXT` | Kiểm tra `FACTORY_EXTENSIONS` và `FACTORY_EXTENSIONS_DIR` nếu có, khởi động lại và sửa lỗi manifest hoặc pack. Kiểm tra lại **Pack nguồn** trong **Workflow** → **Nhập từ template**. |

> **Lưu ý:** `factory doctor --model` gửi một yêu cầu thật nhỏ. Dùng khi gateway có phục vụ model đã cấu hình nhưng không liệt kê model đó.

## Lỗi thường gặp

- Đổi URL trình duyệt mà không kiểm tra Host đang nghe cổng nào.
- Tắt xác thực TLS để né lỗi CA thay vì cung cấp đúng tệp CA.

## Bước tiếp theo

[Kiểm tra cấu hình có hiệu lực](./config.md) hoặc [quay lại phần cài đặt](./install.md).
