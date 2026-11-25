---
title: Bảo mật
section: reference
order: 4
---

## Mạng và session

Host mặc định nghe loopback. Nếu mở LAN, dùng đăng nhập bằng token và giới hạn tường lửa cho mạng tin cậy. Các thao tác ghi từ browser được kiểm session, Origin và CSRF. Giữ token bootstrap dùng một lần ở máy của bạn.

## Ranh giới runtime

Host giữ API key upstream và secret Integration; agent dùng grant có phạm vi attempt. OpenCode chạy trong sandbox bubblewrap trên Linux. Adapter CLI cục bộ chạy với quyền bạn cấp, không tương đương sandbox.

## Tác động bên ngoài

Đặt chính sách tool và cổng duyệt trước các hiệu ứng có hậu quả. Host lưu intent và kết quả effect; đối soát kết quả chưa rõ với hệ thống đích trước khi Retry. Bảo vệ cấu hình và backup như dữ liệu riêng tư.
