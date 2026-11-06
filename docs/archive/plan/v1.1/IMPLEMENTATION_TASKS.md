# Task V1.1

1. V11-01 — Hoàn thành: phân biệt lỗi snapshot với source thay đổi đồng thời; giữ phản hồi/đề xuất để xem, dừng dispatch và hàng chờ; không dùng plan cũ sau khi source đổi.
2. V11-02 — Hoàn thành: Windows Job Object host cho runtime và local command; parent lifetime pipe, không để child sống khi host/app chết. Xác nhận job theo tên ngẫu nhiên, không nhận lại hoặc kill theo PID cũ.
3. V11-03 — Hoàn thành: checkpoint source/Git, kiểm tra baseline khi phục hồi; interrupted luôn giữ history; tiếp tục bằng attempt mới với context/checkpoint, không replay tool tự động.
4. V11-04 — Hoàn thành: project command catalog, start/stop command dài và local preview loopback; close dialog khi có công việc, giữ lock nếu chưa xác nhận dừng.
5. V11-05 — Hoàn thành: export report/events đã redaction, retention có preview và bảo vệ active/recovery/queue/reference; không xóa source.
6. V11-06 — Hoàn thành: regression, fault injection Windows/Electron thật, acceptance model đã cấu hình nếu truy cập được; cập nhật report và commit/push.

Mỗi vấn đề tối đa 3 vòng sửa tự động. Kiểm tra trọng tâm trước, full suite khi tích hợp; không build Docker/VM hoặc thay credentials.
