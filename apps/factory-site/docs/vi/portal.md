---
title: Portal / Web Games
section: extensions
order: 1
---

## Bật extension

Portal extension không cài máy chủ Portal. Chuẩn bị Portal đang chạy và một token có quyền publish. Đặt `FACTORY_EXTENSIONS=portal` trong `factory.env`, khởi động lại Host, rồi kiểm `D-EXT` qua `factory doctor`.

## Tạo Integration và dự án

Tạo secret cho token. Dựa vào `extensions/portal/integration.example.json`, tạo HTTP API Integration, sửa `baseUrl`, đặt ID secret vào `config.auth.bearer` và chọn phạm vi dự án truy cập được. Không dán token vào brief.

Đặt `FACTORY_PROJECTS_ROOT` trong shell cùng giá trị với Host. Từ repo Factory, tạo dự án starter:

```bash
bash extensions/portal/scripts/new-game.sh ten-game
```

Trỏ dự án vào thư mục script in ra, chọn **Web Games** và nhập workflow từ pack. Xem [hướng dẫn làm game](./web-games.md) để chạy và duyệt. Pack còn có workflow thay đổi, sửa lỗi, chơi thử, publish riêng và rollback.
