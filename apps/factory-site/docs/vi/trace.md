---
title: Trace / Monitor / Hiệu quả
section: concepts
order: 8
---

**Monitor** giúp tìm công việc đang chạy hoặc đang chờ. Run và dấu vết thực thi cho biết chuyện gì đã xảy ra; **Hiệu quả** cho biết xu hướng giữa các run.

## Khi nào nên dùng

Dùng khi run có vẻ bị kẹt hoặc cần bằng chứng để ra quyết định. Nếu `Recipe Box` đang đợi người duyệt, tìm đúng câu hỏi thay vì tạo run mới.

![Run có sơ đồ workflow, trạng thái và khung chi tiết thực thi node](/images/docs/workflow-run.png)

*Chọn node để kiểm tra thực thi thay vì suy đoán từ trạng thái chung.*

## Lần theo bằng chứng

1. Mở **Monitor** để xem việc hiện tại, hoặc tìm run cụ thể trong **Workflow** → **Run gần đây**. Chọn node đang chờ hoặc gặp lỗi trên sơ đồ.
2. Lần theo yêu cầu → run → node → task → attempt → lời gọi tool hoặc artifact. Kiểm tra attempt nào sinh ra kết quả; lần thử lại có thể có bản ghi riêng.
3. Nếu run chờ bạn, mở **Cần xử lý** và đối chiếu mục với đúng run. Để xem xu hướng, mở **Hiệu quả** trong workflow và chọn **Khoảng thời gian**.

![Cần xử lý với một câu hỏi xuất bản Portal và một mục chờ duyệt](/images/docs/monitor.png)

*Khi run đợi người quyết định, đọc và gửi quyết định trong Cần xử lý.*

> **Lưu ý:** Chưa rõ token hoặc chi phí không có nghĩa là bằng không. Xem mức độ đầy đủ của số liệu trước khi so sánh tổng.

## Lỗi thường gặp

- Coi trạng thái chờ là lỗi runtime khi chưa kiểm tra cổng duyệt hoặc điều kiện chờ khác.
- Kết luận node có lỗi chỉ từ số liệu tổng hợp mà không mở bằng chứng.

## Bước tiếp theo

[Xử lý phê duyệt](./run-approve.md) hoặc [dùng Hiệu quả để cải tiến](./improve-workflow.md).
