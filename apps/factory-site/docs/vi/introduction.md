---
title: Giới thiệu
section: start
order: 1
---

Factory điều phối một đội AI trên máy của bạn. Bạn thống nhất kế hoạch với Lead, theo dõi workflow và tự quyết định ở những bước cần người duyệt.

## Khi nào nên dùng

Dùng Factory khi công việc có nhiều lần bàn giao hoặc cần kiểm tra trước khi chốt. Ví dụ, Software Team chuyển brief thành tiêu chí nghiệm thu, triển khai và kiểm thử thay đổi, rồi đợi bạn duyệt mà không deploy.

![Tổng quan với ô gửi yêu cầu, các mục cần quyết định và danh sách dự án](/images/docs/overview.png)

*Từ Tổng quan, bạn có thể gửi yêu cầu, mở dự án hoặc xem việc cần quyết định.*

## Làm quen với giao diện

1. Mở **Tổng quan** để chọn dự án hoặc gửi yêu cầu trong ngữ cảnh dự án đó.
2. Trong dự án, mở **Văn phòng** để xem Lead và công việc đang diễn ra hoặc **Bảng việc** để xem trạng thái từng task.
3. Mở **Workflow** để xem sơ đồ và các run gần đây. Xem **Cần xử lý** để trả lời những mục cần người quyết định.

![Văn phòng dự án với bàn Lead và các workflow đang hoạt động](/images/docs/office.png)

*Văn phòng hiển thị đội và công việc của một dự án.*

> **Lưu ý:** Host kiểm tra lệnh, lưu trạng thái vào SQLite và điều phối công việc. Giao diện hiển thị trạng thái và sự kiện từ Host. Attempt sửa mã có thể dùng Git worktree riêng.

## Lỗi thường gặp

- Nhầm một task với cả run. Một run có thể tạo nhiều task.
- Coi lời nhắn trong chat là phê duyệt. Host kiểm tra lệnh và chính sách riêng.

## Bước tiếp theo

[Cài Factory](./install.md), rồi [tạo dự án đầu tiên](./quickstart.md).
