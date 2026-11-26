---
title: Tự cải tiến workflow
section: guides
order: 5
---

Dùng Hiệu quả để tìm lỗi lặp lại, nhiều lần retry hoặc thời gian chờ dài. Áp dụng đề xuất sửa draft, không sửa version đã publish.

## Khi nào nên dùng

Dùng khi đã có run để đối chiếu. Ví dụ, tìm xem Software Delivery chậm ở Test hay ở bước đợi người duyệt trước khi tăng thời gian chờ.

![Trình chỉnh sửa workflow có tab Hiệu quả cạnh tab chỉnh sửa](/images/docs/workflow-canvas.png)

*Mở Hiệu quả từ trình chỉnh sửa; quay lại Chỉnh sửa để thử thay đổi trong draft.*

## Từ phát hiện đến version đã kiểm tra

1. Mở workflow, chọn **Hiệu quả**, rồi chọn **Khoảng thời gian** có run của [hướng dẫn nhanh](./quickstart.md).
2. So sánh **Số liệu theo node** và **Phát hiện**. Mở liên kết **Bằng chứng** để xem cùng một node có gặp vấn đề qua các run tương đương không.
3. Lưu hoặc bỏ thay đổi chưa lưu. Chọn **Đề xuất cải tiến**, đọc **Thay đổi đề xuất** rồi chỉ **Áp dụng** nếu đề xuất sẵn sàng và giải quyết đúng vấn đề. Nếu dùng **Nhờ AI đề xuất**, mở **Xem đề xuất AI** để xem riêng.
4. Quay lại **Chỉnh sửa**, kiểm tra cổng, đầu vào và nhánh duyệt, rồi dùng **Chạy thử**. Chỉ **Publish** sau khi xác minh version mới.

> **Lưu ý:** Run cũ giữ nguyên version. Chưa rõ token không phải bằng không; hãy xem độ đầy đủ của số liệu trước khi so sánh.

## Lỗi thường gặp

- Tăng thời gian chờ để che một bước thực ra đang đợi người quyết định.
- Áp dụng đề xuất đã cũ. Tải lại và tạo đề xuất mới từ draft hiện tại.

## Bước tiếp theo

[Lần theo bằng chứng trong run](./trace.md) hoặc [chạy version mới](./run-approve.md).
