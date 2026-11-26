---
title: Thư viện
section: concepts
order: 3
---

Thư viện lưu skill và template agent dùng lại được. Skill đóng gói chỉ dẫn; template đóng gói cấu hình agent và có thể tham chiếu các skill đó.

## Khi nào nên dùng

Tạo skill khi nhiều agent cần cùng một danh sách kiểm tra. Ví dụ, `release-checklist` yêu cầu người duyệt ghi commit đã kiểm thử, các kiểm tra đã chạy và những điểm chưa xác minh.

![Thư viện với danh sách skill, tab template agent và nút nhập SKILL.md](/images/docs/library.png)

*Chọn một skill để xem nội dung và các phiên bản của nó.*

## Dùng lại skill và template

1. Mở **Thư viện** → **Skill**. Tìm mục đã có hoặc dùng **Tạo skill** hay **Nhập SKILL.md**. Đặt tên chữ thường có dấu gạch ngang và kiểm tra nội dung.
2. Mở **Agent template** để xem các version. Để dùng lại cấu hình một agent, mở menu của agent trong dự án và chọn **Lưu làm template**.
3. Trong **Agent & Team**, chọn **Tạo từ template** và xem lại cấu hình. Với agent đã liên kết template, đối chiếu version trước khi chọn **Nâng cấp theo template**.

> **Cảnh báo:** Nâng cấp theo template thay thế cấu hình; chỉnh sửa riêng của agent không được giữ. Đọc chỉ dẫn vừa nhập trước khi cấp tool.

## Lỗi thường gặp

- Coi skill là quyền dùng tool hoặc là cách bỏ qua bước duyệt.
- Mong agent đang có tự cập nhật ngay khi template thay đổi.

## Bước tiếp theo

[Gắn skill cho agent](./create-agent.md) hoặc [viết pack](./write-pack.md).
