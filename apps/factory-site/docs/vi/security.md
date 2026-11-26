---
title: Bảo mật
section: reference
order: 4
---

Host lưu thông tin bí mật và thực thi chính sách. Hãy xác định ai được vào Host, runtime được truy cập gì và thao tác nào cần người duyệt.

## Khi nào nên dùng

Đọc trước khi mở truy cập LAN, chọn runtime CLI cục bộ hoặc nối workflow với hệ thống ngoài.

## Giới hạn truy cập và tác động

1. Chỉ nghe trên loopback nếu không cần máy khác truy cập. Khi mở LAN, cấu hình đăng nhập bằng token và giới hạn tường lửa cho mạng tin cậy. Kiểm tra `D-LAN` trong **Hệ thống** → **Thiết lập**.
2. Giữ token khởi tạo một lần và thông tin bí mật trên Host. Yêu cầu ghi từ trình duyệt phải qua kiểm tra session, Origin và CSRF. Giới hạn **Integration** cho các dự án cần dùng.
3. Chọn runtime và tool phù hợp. Trên Linux, OpenCode dùng bubblewrap; CLI cục bộ chạy với quyền bạn cấp và không có mức cách ly tương đương.
4. Đặt phê duyệt trước thao tác ghi quan trọng ra ngoài. Xác minh trên hệ thống đích trước khi thử lại kết quả chưa rõ.

![Thiết lập trong Hệ thống có mục kiểm tra mạng](/images/docs/system.png)

*Mục Hệ thống kiểm tra đăng nhập qua LAN cùng các điều kiện sẵn sàng khác.*

> **Cảnh báo:** Bảo vệ cấu hình, log và bản sao lưu. Không dùng dữ liệu hoặc thông tin bí mật thật để thực hành.

## Lỗi thường gặp

- Cho rằng CLI cục bộ có sandbox giống OpenCode.
- Truyền khóa nhà cung cấp cho agent. Host giữ khóa và cấp quyền theo từng attempt.

## Bước tiếp theo

[Cấu hình kết nối theo phạm vi](./integrations.md) hoặc [thiết kế bước duyệt](./approvals.md).
