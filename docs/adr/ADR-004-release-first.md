# ADR-004 — Code và triển khai ASF trước thực nghiệm template

Ngày: 04/11/2026. Trạng thái: được người dùng yêu cầu điều chỉnh phạm vi và thứ tự.

Người dùng muốn bắt đầu code ngay, để phần kiểm thử với template sau khi triển khai được bản đầu tiên. Chọn lộ trình [code v0](../../plan/lo-trinh-code-v0.md) thay thứ tự phase cũ.

v0.1 gồm scaffold API/dashboard, project/run/data, orchestration/approval và deployment chính ASF lên `.14`. PM/BA dùng gateway khi được cấu hình; BE/FE/TEST/DEVOPS chưa thực thi thật phải hiện rõ, không giả lập evidence thành kết quả thật.

v0.2 triển khai adapters, worker protocol và sáu role thực thi. v0.3 mới đưa template, Mini Helpdesk/dự án thực nghiệm và bộ nghiệm thu toàn luồng vào vận hành. ADR-001 vẫn là lựa chọn module ứng viên nhưng việc tạo repo/demo stack được lùi; lựa chọn cuối có thể rà lại ở Phase 6.

Không yêu cầu đóng toàn bộ M0 cũ trước code nền tảng. GitLab repo/runner cho chính nền tảng chuẩn bị cùng quá trình phát triển và phải đủ trước deploy pipeline. Kiểm tra cơ bản về build/startup/data/auth/approval/migration/smoke và rollback không bị lùi vì cần để biết bản triển khai đầu hoạt động đúng.

Không đổi phân bố hạ tầng: `.14` control plane, `.60` coding/build một slot, `.12/.13/.51` giữ dịch vụ hiện hữu, có thể bổ sung worker cá nhân. Không tuyên bố demo song song hoặc CI end-to-end đã đạt khi chưa có evidence.
