---
title: Lệnh factory
section: reference
order: 1
---

Dùng CLI `factory` trên máy chạy Host để cấu hình, chẩn đoán và vận hành mà không cần mở trình duyệt.

## Khi nào nên dùng

Dùng CLI khi giao diện không mở được hoặc khi cần kiểm tra cấu hình, quản lý tiến trình hay sao lưu.

![Thiết lập trong Hệ thống hiển thị kết quả chẩn đoán](/images/docs/system.png)

*Hệ thống → Thiết lập hiển thị các kiểm tra tương ứng với `factory doctor`.*

## Kiểm tra và vận hành Host

1. Chạy `factory status`. Dùng `factory logs -f` để theo dõi thông báo khởi động hoặc điều tra lần khởi động lại thất bại.
2. Chạy `factory doctor` để xem kết quả và cách sửa, hoặc `factory doctor --json` để dùng trong script.
3. Dùng `factory config show` để xem cấu hình và nguồn giá trị, với secret đã che. Dùng `factory setup` để cấu hình theo câu hỏi.
4. Dùng `factory start`, `factory stop` hoặc `factory restart` để điều khiển Host. Dùng `factory backup` để sao lưu SQLite, hoặc `factory restore FILE` để khôi phục một bản cụ thể.

> **Cảnh báo:** Restore không phải thao tác chẩn đoán. Kiểm tra bản sao lưu và đúng Host đích trước khi khôi phục; bảo vệ log và bản sao lưu.

## Lỗi thường gặp

- Chạy lệnh trên máy mở trình duyệt thay vì máy chạy Host.
- Cho rằng thiết lập đã có hiệu lực khi chưa kiểm tra nguồn giá trị và khởi động lại.

## Bước tiếp theo

[Tra mã doctor](./doctor.md) hoặc [kiểm tra thứ tự ưu tiên cấu hình](./config.md).
