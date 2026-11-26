---
title: Lead chat
section: concepts
order: 5
---

Chat với Lead theo trình tự “chốt trước, chạy sau”: trao đổi, xác nhận rõ ràng, lưu bản chốt có version rồi mới chạy. Host kiểm tra thao tác, dự án, workflow và đầu vào được đề xuất.

## Khi nào nên dùng

Dùng chat khi cần làm rõ mục tiêu trước khi giao việc. Với `Recipe Box`, hãy chốt câu thông báo khi danh sách trống, hai trường hợp kiểm thử và yêu cầu không deploy.

![Ô gửi yêu cầu trên Tổng quan với phần chọn dự án](/images/docs/overview.png)

*Kiểm tra ngữ cảnh dự án trước khi gửi; trong dự án, dùng Hỏi Lead.*

## Từ trao đổi đến run

1. Mở **Hỏi Lead**. Bảo đảm đã cấu hình model cho Lead và đã publish **Software Delivery** nếu làm theo [hướng dẫn nhanh](./quickstart.md).
2. Hỏi: “Đề xuất thay đổi nhỏ nhất để hiện ‘Chưa có công thức’ khi danh sách trống. Giữ nguyên danh sách có dữ liệu và kiểm thử cả hai trường hợp. Chưa chạy.” Trao đổi tới khi phạm vi rõ ràng.
3. Chốt bằng lời của bạn: “Tôi đồng ý. Chạy Software Delivery với các tiêu chí vừa thống nhất. Không deploy.” Xem version trong **Bản chốt** và mở run từ câu trả lời.
4. Nếu chưa thấy liên kết run, kiểm tra dự án, bản publish và đầu vào bắt buộc trước khi xác nhận lại. Đối chiếu kết quả với đúng bản chốt run đã dùng.

> **Lưu ý:** Trong **Cách làm việc với Lead**, chế độ cổ điển tách trao đổi và thao tác giao việc có thể đề xuất task lên **Bảng việc**. Đổi chế độ không bỏ qua phê duyệt.

## Lỗi thường gặp

- Nói “được đấy” khi vẫn đang so sánh lựa chọn mà không chỉ rõ phương án cần chạy.
- Dùng lời chốt trong chat để thay phê duyệt ở một node sau đó.

## Bước tiếp theo

[Theo dõi run và duyệt kết quả](./run-approve.md).
