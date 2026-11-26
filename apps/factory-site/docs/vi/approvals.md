---
title: Phê duyệt & chính sách
section: concepts
order: 6
---

Approval ghi nhận quyết định của người vận hành và chọn nhánh cho run. Phê duyệt không cấp thêm tool hay mở rộng chính sách cho thao tác bên ngoài.

## Khi nào nên dùng

Thêm cổng duyệt khi cần người chịu trách nhiệm về quyết định, ví dụ xác nhận kết quả kiểm thử hoặc cho phép phát hành lên Portal. Chỉ nối `approved` tới node phát hành, không nối nhánh từ chối hoặc hết hạn vào đó.

![Cần xử lý hiển thị câu hỏi phát hành Portal, các lựa chọn và ô ghi chú](/images/docs/approvals.png)

*Đọc kỹ câu hỏi đang chọn và các phương án trước khi trả lời.*

## Xem xét một quyết định

1. Mở **Cần xử lý** và chọn mục thuộc dự án của bạn. Kiểm tra câu hỏi và workflow liên quan.
2. Xem bản thay đổi hoặc commit, kết quả kiểm tra và tác động dự kiến. Mở **Chi tiết kỹ thuật** nếu cần đối chiếu mã mục.
3. Với câu hỏi, chọn phương án rồi bấm **Trả lời**. Với mục review, dùng thao tác tương ứng, ví dụ **Yêu cầu sửa**. Quay lại run để kiểm tra nhánh đã chạy.

> **Cảnh báo:** Nếu chưa rõ thao tác ghi bên ngoài đã thành công hay chưa, xác minh trên hệ thống đích trước khi thử lại. Phê duyệt không phải bằng chứng thao tác đã thành công.

## Lỗi thường gặp

- Duyệt nhầm run vì hai câu hỏi trùng tiêu đề.
- Coi hết hạn hoặc thiếu bằng chứng là đồng ý.

## Bước tiếp theo

[Theo dõi một run đến bước duyệt](./run-approve.md) hoặc [giới hạn phạm vi kết nối](./integrations.md).
