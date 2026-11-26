---
title: Integration & Secret
section: concepts
order: 7
---

Integration kết nối Factory với máy chủ MCP hoặc HTTP API. Host lưu secret riêng; workflow chỉ tham chiếu kết nối và thao tác đã khai báo.

## Khi nào nên dùng

Dùng kết nối theo phạm vi khi công việc cần truy cập hệ thống ngoài. Ví dụ, chỉ cho dự án game sử dụng kết nối phát hành Portal thay vì mở kết nối cho toàn hệ thống.

![Tổng quan với mục Integration trên thanh bên](/images/docs/overview.png)

*Mở Integration từ thanh bên để quản lý kết nối và secret ở hai mục riêng.*

## Cấu hình kết nối

1. Mở **Integration** → **Secret** → **Tạo secret**. Nhập giá trị tại đây và dùng ID secret trong cấu hình kết nối.
2. Trong **Kết nối**, chọn **Tạo kết nối**. Chọn **Loại kết nối** và **Phạm vi** mà dự án truy cập được. Tham chiếu ID secret và chỉ cho phép các thao tác hoặc tool cần dùng.
3. Đặt **Approval** trước **Action** HTTP ghi ra ngoài và xác định cách đối soát nếu chưa rõ kết quả.

> **Cảnh báo:** Không dán secret vào brief, đầu vào workflow hay log. Host mã hóa giá trị, chỉ hiện ID cùng thông tin đã che và cấp quyền theo attempt.

## Lỗi thường gặp

- Tạo kết nối ngoài phạm vi của dự án cần dùng.
- Mở phạm vi toàn hệ thống hoặc bỏ qua bước duyệt chỉ để chạy thử.

## Bước tiếp theo

[Cấu hình Portal](./portal.md) hoặc [xem ranh giới bảo mật](./security.md).
