---
title: Tạo workflow trên canvas
section: guides
order: 2
---

Tạo một draft chuyển brief ngắn thành checklist mà không sửa tệp hay gọi dịch vụ ngoài.

## Khi nào nên dùng

Bắt đầu từ sơ đồ trống để học cách nối cổng hoặc thử một nhánh mới. Dùng **Nhập từ template** nếu muốn bắt đầu từ định nghĩa trong pack.

![Trình chỉnh sửa workflow với danh sách thêm node, lỗi và nút chạy thử](/images/docs/workflow-canvas.png)

*Thêm node rồi kiểm tra và chạy thử các đường nối trước khi publish.*

## Tạo, chạy thử và publish

1. Trong **Workflow**, chọn **Tạo workflow**. Dùng key như `checklist-preview`. Draft có sẵn **Trigger** thủ công và **Output**.
2. Trong **Cài đặt workflow** → **Đầu vào workflow**, thêm `brief` kiểu văn bản và đánh dấu **Bắt buộc**. Dùng **Thêm node** để thêm **Agent** và gán [agent kiểm tra](./create-agent.md). Trong chỉ dẫn task, dùng **Chèn đường dẫn mẫu** để tham chiếu `brief` và yêu cầu checklist kèm yêu cầu bằng chứng.
3. Thay đường nối thẳng từ Trigger tới Output bằng **Trigger** → **Agent** → **Output**, qua cổng **Tiếp** (`out`) của hai node nguồn. Kiểm tra **Lỗi** rồi chọn **Lưu draft**.
4. Chọn **Chạy thử**, bật **Mock agent (không tốn token)** và nhập `brief` mẫu. Mở run để kiểm tra sơ đồ đã qua Agent và đến Output.
5. Nếu cần kiểm tra chất lượng nội dung agent trả về, chạy thật với đầu vào nhỏ. Chọn **Publish** khi sơ đồ sẵn sàng.

> **Cảnh báo:** Mock không biến mọi Action thành chạy thử không tác động. Đừng thêm thao tác ghi bên ngoài vào bài tập; nếu thêm về sau, đặt phê duyệt trước thao tác đó.

## Lỗi thường gặp

- Để đường nối thẳng làm run đến Output mà không qua Agent.
- Dùng **Chạy** để thử thay đổi chưa publish hoặc bỏ trống đầu vào bắt buộc.

## Bước tiếp theo

[Chạy workflow đã publish và xử lý duyệt](./run-approve.md).
