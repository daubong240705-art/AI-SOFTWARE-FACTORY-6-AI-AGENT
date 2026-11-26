---
title: Chạy workflow và duyệt
section: guides
order: 3
---

Theo dõi `Recipe Box` từ bản chốt đến quyết định của người vận hành. Software Delivery chỉ chuyển bản đã qua kiểm thử đến bước duyệt và không deploy.

## Khi nào nên dùng

Dùng cho workflow đã publish có bước người duyệt. Nếu chỉ muốn kiểm tra sơ đồ mới, hãy [chạy thử draft](./create-workflow.md).

## Theo dõi và quyết định

1. Mở liên kết run từ **Hỏi Lead** hoặc tìm trong **Workflow** → **Run gần đây**. Nếu chưa có run và muốn chạy thủ công, mở workflow đã publish, chọn **Chạy** và điền `brief` đã chốt. Không làm cả hai cho một yêu cầu.
2. Chọn node hiện tại trên sơ đồ run để xem thực thi. Dùng **Monitor** để tìm công việc đang chạy hoặc đang chờ. **Bảng việc** hiện từng task, không phải cả run.
3. Trong **Cần xử lý**, mở **Operator sign-off**. Kiểm tra bằng chứng cho danh sách trống và danh sách có dữ liệu. Chọn **Duyệt** nếu cả hai đạt hoặc chọn phương án từ chối, rồi bấm **Trả lời**.
4. Quay lại run để kiểm tra nhánh và kết quả cuối. Mở **Hiệu quả** để so với các run khác.

![Cần xử lý hiển thị câu hỏi phát hành và nút trả lời](/images/docs/approvals.png)

*Đọc câu hỏi thuộc đúng run trước khi chọn và gửi quyết định.*

> **Cảnh báo:** Nếu chưa rõ kết quả của thao tác ghi ra ngoài, xác minh và đối soát trước khi thử lại hoặc tạo run mới.

## Lỗi thường gặp

- Duyệt chỉ vì một task đã xong mà không đọc kết quả kiểm thử.
- Chạy lại khi run chỉ đang đợi bạn quyết định.

## Bước tiếp theo

[Điều tra run](./trace.md) hoặc [so sánh kết quả trong Hiệu quả](./improve-workflow.md).
