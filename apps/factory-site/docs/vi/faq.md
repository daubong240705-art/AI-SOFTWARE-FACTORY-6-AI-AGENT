---
title: Câu hỏi thường gặp (FAQ)
section: reference
order: 5
---

Giải đáp các câu hỏi khi chọn workspace, làm việc với Lead hoặc theo dõi một run.

## Khi nào nên dùng

Đọc khi chưa rõ có cần model không, tìm task ở đâu hoặc vì sao chat hay draft chưa tạo run.

## Có thể thử workflow mà không gọi model không?

1. Mở **Workflow** và tạo hoặc mở draft không có thao tác ghi bên ngoài.
2. Chọn **Lưu draft**, rồi **Chạy thử**. Bật **Mock agent (không tốn token)**, nhập đầu vào bắt buộc và mở run để xem đường đi.

> **Cảnh báo:** Mock agent không tắt mọi Action. Demo chỉ truy cập được trong mạng nội bộ trừ khi người vận hành công bố; không nhập dữ liệu thật hoặc secret.

## Dự án và group có giống nhau không?

Không. Dự án có workspace và lịch sử công việc riêng. Group gom các dự án và có thể cho chúng kế thừa thiết lập. Chọn **Thư mục** cho workspace trống hoặc **Dự án Git** để gắn repo có sẵn.

## Vì sao chat hoặc draft chưa chạy?

Trao đổi không phải xác nhận. Hãy chốt kế hoạch rõ ràng và yêu cầu Lead chạy workflow đã publish. Nhập hay lưu draft không tự publish; chọn **Publish** để dùng version đó cho lần chạy thông thường.

## Xem quyết định và task ở đâu?

Dùng **Cần xử lý** cho quyết định của người vận hành, **Bảng việc** cho từng task và sơ đồ run cho tiến trình workflow.

![Bảng việc với các thẻ task chia theo trạng thái](/images/docs/board.png)

*Bảng việc theo dõi từng task, không thay thế sơ đồ run hay danh sách chờ duyệt.*

## Lỗi thường gặp

- Mong Web Games tự cài Portal. Cần có Portal chạy riêng.
- Coi số liệu chưa rõ là bằng không hoặc task xong là run đã được duyệt.

## Bước tiếp theo

[Làm theo hướng dẫn nhanh](./quickstart.md) hoặc [chẩn đoán lỗi thiết lập](./troubleshooting.md).
