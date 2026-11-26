---
title: Workflow v2
section: concepts
order: 4
---

Workflow v2 là một sơ đồ được kiểm tra hợp lệ. Mỗi cạnh nối một cổng ra có tên với node tiếp theo. Bạn sửa draft rồi publish khi sẵn sàng; mỗi run thông thường giữ nguyên định nghĩa và đầu vào đã dùng.

## Khi nào nên dùng

Dùng sơ đồ khi cần các nhánh khác nhau. Ví dụ, agent lập checklist chuyển kết quả đến **Approval**: `approved` đi tới kết quả đã duyệt, còn `rejected` và `timeout` đi tới kết quả riêng.

![Canvas workflow với các bước nối nhau, danh sách node và khung chi tiết](/images/docs/workflow-canvas.png)

*Chọn một node hoặc đường nối để xem chi tiết; tab Lỗi hiển thị vấn đề cần sửa.*

## Đọc sơ đồ và run

1. Mở một định nghĩa trong **Workflow**. Bắt đầu từ **Trigger** và đi theo cổng **Tiếp** (`out`). **Agent** giao việc, **Action** thực hiện thao tác đã khai báo và **Output** thu kết quả.
2. Đọc từng nhánh. **Condition** chọn đường đi, **Loop** lặp trong giới hạn và **Approval** rẽ nhánh theo quyết định hoặc hết hạn. Xem **Lỗi** để tìm node không tới được hoặc đường nối thiếu.
3. Xem **Version** để phân biệt bản đã publish với draft. Mở run để xem bản đã dùng. Khi khởi động lại, Host kiểm tra việc còn dang dở thay vì giả định attempt bị gián đoạn đã thành công.

> **Cảnh báo:** **Mock agent (không tốn token)** thay lời gọi model của agent, không tắt mọi Action. Hãy thử sơ đồ không ghi ra hệ thống ngoài trước.

## Lỗi thường gặp

- Lưu draft rồi dùng **Chạy** và mong bản sửa có hiệu lực trước khi **Publish**.
- Nối nhánh từ chối hoặc hết hạn tới cùng kết quả thành công như nhánh duyệt.

## Bước tiếp theo

[Tạo sơ đồ thử](./create-workflow.md) hoặc [theo dõi một run](./trace.md).
