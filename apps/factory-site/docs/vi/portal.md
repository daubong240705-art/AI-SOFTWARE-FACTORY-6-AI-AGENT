---
title: Portal / Web Games
section: extensions
order: 1
---

Tiện ích Portal tùy chọn bổ sung đội và workflow **Web Games**. Tiện ích cần một Portal đang chạy và không tự cài Portal.

## Khi nào nên dùng

Dùng khi muốn Factory gửi bản phát hành game tới một Portal có sẵn qua kết nối HTTP được duyệt.

## Bật pack và kết nối dự án

1. Đặt `FACTORY_EXTENSIONS=portal` trong `factory.env`. Khởi động lại Host rồi chạy `factory doctor`. Nếu thiếu pack, xem `D-EXT`.
2. Lưu token phát hành trong **Integration** → **Secret**. Trong **Kết nối**, tạo HTTP API dựa trên `extensions/portal/integration.example.json`. Đặt `baseUrl`, tham chiếu ID secret ở `config.auth.bearer` và chọn phạm vi dự án truy cập được.
3. Đặt `FACTORY_PROJECTS_ROOT` trong shell giống Host. Từ thư mục mã nguồn Factory, chạy `bash extensions/portal/scripts/new-game.sh sample-game`. Trong **Dự án mới**, chọn **Dự án Git**, trỏ tới thư mục vừa in và chọn team template **Web Games**.
4. Mở **Workflow** → **Nhập từ template**, chọn **Web Games** ở **Pack nguồn**. Kiểm tra workflow đã nhập trước khi **Publish**.

![Danh sách workflow của Web Games và các run gần đây](/images/docs/workflow-list.png)

*Pack cung cấp template tạo game, thay đổi, sửa lỗi, playtest, phát hành và quay về bản trước.*

> **Cảnh báo:** Truyền `portalIntegrationId` vào workflow, không truyền token phát hành.

## Lỗi thường gặp

- Bật pack nhưng dự án không có quyền truy cập kết nối.
- Thử lại khi gặp `bundle-outcome-unknown`. Kiểm tra `versions` trên Portal theo ID game và commit, rồi đối soát thao tác HTTP đã ghi nhận.

## Bước tiếp theo

[Tạo và duyệt bản phát hành game](./web-games.md) hoặc [xử lý lỗi tải tiện ích](./troubleshooting.md).
