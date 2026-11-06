# Bash tự động — kế hoạch triển khai

Ngày 05/11/2026, baseline `b608a7b`. Người dùng đã yêu cầu tiếp tục phương án Bash tự động sau khi đọc đánh giá; áp dụng cho các execution khởi chạy bằng bản app mới, kể cả queue/retry cũ được chủ động chạy tiếp. Không tự chạy lại công việc khi nâng cấp.

- Runtime và Controller dùng role policy: BE/FE/TEST/DEVOPS tự chạy Bash; Lead/PM/BA bị từ chối. Bỏ selector Ask/Full access và API nâng quyền theo run; giữ dữ liệu `permissionMode`/audit lịch sử để đọc tương thích, không migration hoặc ghi lại report cũ.
- Runtime giữ `doom_loop: ask` để Controller nhận tín hiệu, từ chối và kết thúc run bằng lỗi vòng lặp riêng. Không treo xin Accept hoặc coi đây là Bash bình thường.
- Giữ ticket UI cho các loại quyền khác, giới hạn request/deadline, Stop/process tree, role/edit/secret tool policy và evidence. Shell không phải sandbox OS.
- Kiểm role matrix, ticket trùng/lane/stale/cancelling, lỗi auto-approve, doom-loop/role deny, snapshot legacy/queue/restart và UI không còn duyệt Bash. Production fixture không thay thế bằng chứng model/OpenCode thật.
- Checkpoint trước code; commit sau unit/typecheck/build/format và Electron UI liên quan. Không dùng DB, credentials hoặc source ngoài workspace người dùng.
