---
title: Agent, Team & quan hệ
section: concepts
order: 2
---

Agent là một thành viên có vai trò, chỉ dẫn, runtime và giới hạn riêng. Team tập hợp các agent; quan hệ giữa họ cho biết ai bàn giao hoặc kiểm tra công việc của ai.

## Khi nào nên dùng

Tách vai trò khi người làm và người kiểm tra cần chỉ dẫn khác nhau. Trong Software Team, kỹ sư thực hiện thay đổi còn Test đối chiếu bản đã tích hợp với brief.

![Agent và Team hiển thị Lead cùng các vai trò triển khai và kiểm tra](/images/docs/agents.png)

*Danh sách hiển thị vai trò, runtime, trạng thái và attempt đang chạy của mỗi agent.*

## Xem một đội

1. Mở **Agent & Team**. Xác định agent có nhãn **Lead** và các vai trò được workflow sử dụng.
2. Mở agent và xem **Hồ sơ**, **Runtime** và **Cộng tác**. Khi cần kiểm tra độc lập, chọn agent khác và xem chiều của quan hệ `reviews`.
3. Mở **Văn phòng** để xem một dự án hoặc **Thế giới** để xem hoạt động qua nhiều dự án. Mở **Bảng việc** để xem trạng thái task.

![Thế giới với bộ lọc dự án, khu làm việc của các đội và hoạt động gần đây](/images/docs/world.png)

*Thế giới cho phép xem qua nhiều dự án; vào dự án tương ứng để sửa cấu hình agent.*

> **Lưu ý:** Vai trò mô tả trách nhiệm, runtime thực thi công việc, còn skill cung cấp chỉ dẫn dùng lại. Các mục này không vượt qua chính sách tool.

## Lỗi thường gặp

- Giao cả việc triển khai và việc kiểm tra độc lập cho cùng một agent.
- Thêm agent nhưng không gán task hay node cho agent đó.

## Bước tiếp theo

[Tạo agent](./create-agent.md) hoặc [dùng lại template](./library.md).
