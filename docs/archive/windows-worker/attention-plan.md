# Cần xử lý — kế hoạch giảm nhiễu

Ngày 05/11/2026. Baseline `3be8055`. Ưu tiên trước R6.

## Mục tiêu

Mở danh sách phải hiểu công việc nào bị ảnh hưởng, nguyên nhân và bước tiếp theo. Không lấy số lần chạy lỗi làm số công việc cần người dùng xử lý.

1. Lọc lần chạy bị thay thế theo work item/revision và retry lineage; bỏ yêu cầu bổ sung cũ không có công việc hoặc câu hỏi thực sự. Giữ lỗi kỹ thuật có thật của trao đổi độc lập.
2. Hiển thị tên công việc, mã, nguyên nhân, task liên quan và hướng xử lý. Dùng cùng phép chiếu vấn đề ở danh sách và tiến độ.
3. Lọc dự án, cần quyết định, bị chặn; phân biệt đọc/chưa đọc với đóng cảnh báo. Chỉ cho đóng cảnh báo lỗi đã dừng; không xác nhận thành công, duyệt báo cáo hay công cụ. Có danh sách đóng để mở lại. Token thay đổi làm cảnh báo xuất hiện lại.
4. Tiến độ ưu tiên vấn đề, task lỗi/review và tiêu chí chưa đạt. Dùng đường recovery có checkpoint hiện có; không tự retry.
5. Kết quả mặc định chỉ lấy lượt hoàn tất có thay đổi bàn giao; tài liệu có thay đổi file vẫn được tính. Trang kết quả có lịch sử mở rộng cho phân tích/lỗi. Hồ sơ từng công việc giữ nguyên.
6. SQLite15 thêm metadata đóng cảnh báo, backup schema14 trước migration. Không chỉnh DB/credential thật trong quá trình phát triển.
7. Kiểm type/build/test và UI fixture Electron bằng dữ liệu tách biệt; không gọi model.

## Tham khảo

- [Jira status, priority, resolution](https://support.atlassian.com/jira-cloud-administration/docs/what-are-issue-statuses-priorities-and-resolutions/): trạng thái và cách kết thúc công việc là hai thông tin khác nhau. ASF giữ đóng cảnh báo riêng với kết quả công việc.
- [OpenProject notifications](https://www.openproject.org/docs/user-guide/notifications/): mở ngữ cảnh work package, lọc và đánh dấu đọc theo công việc. ASF không dùng đã đọc để thay đổi trạng thái thực thi.
- [CrewHub Loops](https://crewhub.dev/loops/): việc cần người dùng phản hồi đứng trước hoạt động; câu hỏi và review gắn ticket, báo cáo tách khỏi công việc. Chỉ tham khảo tài liệu công khai, không khẳng định đã kiểm source/runtime beta.

Không tích hợp dịch vụ, sao chép mã hoặc thêm orchestrator/dependency. Giữ Factory Lite + Windows Worker và Bash tự động theo role.
