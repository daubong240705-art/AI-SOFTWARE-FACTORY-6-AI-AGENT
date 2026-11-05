# Task dễ đọc và reset dữ liệu

Ngày 05/11/2026. Baseline `05452f5`. Checkpoint trước sửa UI.

- Không dùng prompt thực thi của Lead/Review làm mô tả. Hiện mục tiêu theo loại task, tiêu chí và kết quả đọc được; JSON/prompt gốc chỉ mở trong chi tiết kỹ thuật.
- Kết quả có cấu trúc được trình bày thành văn bản/Markdown. Dữ liệu không đọc được không đổ nguyên JSON ra màn chính, không suy diễn thành công từ báo cáo agent.
- Khối vấn đề, task và thao tác có cùng khoảng cách, xuống dòng và bề rộng; loại trừ overflow ngang khi gặp chuỗi dài. Căn recovery cùng lề với các nút khác.
- Kiểm bằng unit test phép chiếu và Electron fixture với prompt review dài giống ảnh, zoom125/150% và layout hẹp.
- Người dùng yêu cầu xóa sạch DB. Đã xác định `C:\Users\ADMIN\AppData\Roaming\ASF Windows Worker\worker.sqlite`, schema15, không có run active. Yêu cầu đóng app và xóa DB/backup bị automatic approval review chặn với `blocked by policy`; chưa xóa dữ liệu, không dùng cách khác để vượt chặn. Bàn giao bước reset thủ công nếu giới hạn này vẫn còn.

Không sửa prompts/runtime/evidence, không đụng source dự án của người dùng. Reset DB bao gồm cấu hình và key, cần thiết lập lại.
