---
title: Dự án & Group
section: concepts
order: 1
---

Dự án có workspace, task và đội agent riêng. Group gom các dự án liên quan và có thể cung cấp thiết lập, mục thư viện dùng chung.

## Khi nào nên dùng

Dùng group khi nhiều dự án cần kế thừa cùng thiết lập. Ví dụ, đặt `Recipe Box` và một ứng dụng mẫu khác trong `Demos`, nhưng mỗi dự án vẫn có workspace và lịch sử task riêng.

![Tổng quan group với số dự án, mục chờ duyệt, run và task](/images/docs/group.png)

*Tổng quan group gộp hoạt động; mở từng dự án để làm việc trong workspace tương ứng.*

## Tạo group và dự án

1. Bấm **+** cạnh **Dự án**, chọn **Group mới** và đặt tên `Demos`.
2. Chọn **Dự án mới**, rồi chọn `Demos` ở mục **Group**. Chọn **Thư mục** để Host tạo workspace trống hoặc **Dự án Git** để dùng repo sẵn có.
3. Điền **Đường dẫn làm việc** tuyệt đối trên Host hoặc dùng **Chọn thư mục…**. Chọn **Team template** nếu cần đội có sẵn, rồi bấm **Tạo dự án**.
4. Trong **Cài đặt** của group, xem **Giá trị hiệu lực** trước khi đặt giá trị riêng. Mở **Thư viện group** để xem mục dùng chung trong phạm vi đó.

> **Lưu ý:** Team template sao chép agent vào dự án. Sửa template không tự cập nhật các agent đã sao chép.

## Lỗi thường gặp

- Điền đường dẫn trên máy chạy trình duyệt khi Host nằm trên máy khác.
- Cài cùng một giá trị ở từng dự án dù có thể kế thừa từ group.

## Bước tiếp theo

[Tạo dự án từ Software Team](./quickstart.md) hoặc [dùng lại mục thư viện](./library.md).
