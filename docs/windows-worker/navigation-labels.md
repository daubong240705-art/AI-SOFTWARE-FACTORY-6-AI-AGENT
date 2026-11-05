# Tên gọi trong giao diện

Cập nhật 05/11/2026. Đổi tên hiển thị, không đổi route, dữ liệu hay hành vi.

| Vị trí | Tên hiện hành | Ý nghĩa |
|---|---|---|
| Sidebar và màn mở đầu | Tổng quan | Tình hình mọi dự án, việc cần xử lý và thay đổi mới |
| Menu phụ dự án | Thêm | Mở các màn phụ của dự án |
| Màn tổng hợp riêng dự án | Tổng quan dự án | Phân biệt với Tổng quan toàn ứng dụng |
| Mục kết quả trên Tổng quan | Thay đổi mới | Lượt hoàn tất có thay đổi file, không đồng nghĩa đã nghiệm thu |
| Nút mở hội thoại | Mở trao đổi | Cùng thuật ngữ với tab Trao đổi |
| Nút từ task về Board | Xem bảng công việc | Chỉ rõ màn đích cho người không quen thuật ngữ Kanban |
| Tiêu chí trong chi tiết nhiệm vụ | Tiêu chí hoàn thành | Giữ cùng nghĩa với hồ sơ công việc |

Giữ Công việc, Trao đổi, Kết quả, Cần xử lý, Đội ngũ, Lịch và Cài đặt vì đang mô tả đúng chức năng. Git local giữ tên để thể hiện phạm vi chỉ đọc repository trên máy. Tài liệu bàn giao cũ giữ nhãn theo thời điểm; bảng này là tên hiện hành.

Kiểm chứng: typecheck, format:check, build và diff check đạt. `workspace-shell-ui` đạt 4 cấu hình; `workspace-summary-ui` đạt 12 cấu hình Tổng quan/Đội ngũ/Kết quả, gồm màn hẹp và zoom125–150%; không overflow/lỗi renderer/provider call. Fixture/ảnh/log chỉ ở cache local. Không đổi DB hoặc settings.
