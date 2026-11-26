---
title: Cài đặt
section: start
order: 2
---

Cài Factory trên máy Linux x64 do bạn quản lý. Host có thể khởi động khi chưa cấu hình nhà cung cấp model, nhưng chat với Lead và agent dùng API cần model.

## Khi nào nên dùng

Dùng các bước này để cài Host mới hoặc sửa bản cài thiếu giao diện. Bạn cần Git và `sudo` để cài gói hệ thống. Bộ cài tải bản Node.js 22 đã ghim và kiểm tra mã băm.

## Cài đặt và khởi động

1. Nếu chưa có mã nguồn Factory, clone repo rồi chạy bộ cài từ thư mục gốc:

   ```bash
   git clone https://github.com/daubong240705-art/AI-SOFTWARE-FACTORY-6-AI-AGENT.git factory
   cd factory
   bash scripts/install.sh --yes
   export PATH="$HOME/.local/bin:$PATH"
   ```

2. Chạy `factory setup` để cấu hình nhà cung cấp model, cổng, địa chỉ lắng nghe và các CLI agent tùy chọn. Nhập thông tin bí mật ngay trên máy.
3. Chạy `factory doctor` và sửa lỗi bắt buộc. Chạy `factory start`, sau đó mở địa chỉ cục bộ của Host theo cổng đã cấu hình (mặc định `8787`).
4. Mở **Hệ thống** → **Thiết lập** và chọn **Kiểm tra lại** sau khi sửa lỗi.

![Mục Thiết lập trong Hệ thống với các kiểm tra bắt buộc và tùy chọn](/images/docs/system.png)

*Thiết lập liệt kê tình trạng Host, model, CLI agent và mạng.*

> **Lưu ý:** `--dry-run` xem trước các bước; `--no-service` bỏ qua đăng ký dịch vụ người dùng. Bộ cài giữ nguyên `factory.env` đã có.

## Lỗi thường gặp

- Cài trong `/mnt` khi dùng WSL2. Hãy dùng hệ thống tệp Linux cục bộ; WSL2 chưa được kiểm thử đầy đủ.
- Thấy **Sẵn sàng** rồi cho rằng mọi runtime tùy chọn đều dùng được. Hãy xem mục kiểm tra của runtime bạn định chọn.

## Bước tiếp theo

[Tạo dự án](./quickstart.md) hoặc [xử lý lỗi thiết lập](./troubleshooting.md).
