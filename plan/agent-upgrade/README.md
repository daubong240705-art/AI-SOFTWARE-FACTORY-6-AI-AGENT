# Kế hoạch nâng cấp AI Software Factory

Ngày chốt khảo sát ban đầu: 04/11/2026. **AU-0 hoàn thành: source tham khảo đã clone và kế hoạch đã lập. AU-1 đến AU-5 chưa triển khai.**

| Tài liệu | Nội dung |
|---|---|
| [Hiện trạng](current-state.md) | Kiến trúc thực tế, chức năng có sẵn và khoảng trống |
| [Nghiên cứu và lựa chọn](research-findings.md) | Source cụ thể, cách áp dụng, giấy phép, rủi ro |
| [Các đợt triển khai](implementation-plan.md) | Task, file, vai trò, dependency, nghiệm thu và rollback |
| [Source manifest](../../research/agent-upgrade/sources.json) | Revision cố định và nguồn có thể kiểm tra lại |
| [Hướng dẫn source](../../research/agent-upgrade/README.md) | Clone/cache và điều kiện tái sử dụng |

Giữ Factory Lite + Windows Worker; Controller hiện tại là nơi duy nhất điều phối. Không thêm orchestrator, marketplace, Jira, OpenProject hoặc GitLab Server. Không thay đổi dịch vụ ASF/VM đang chạy. Các tích hợp legacy đang tồn tại không thuộc phạm vi sửa hoặc xóa.

Thứ tự ưu tiên: **AU-1 → AU-2 → AU-3 → AU-4 → AU-5**. AU-1 có thể bắt đầu trên baseline WW-4C; không cần đợi WW-4D. Các công việc tự nâng cấp kéo dài hoặc cần preview/process recovery chỉ bắt đầu sau khi phần lifecycle tương ứng của WW-4D được nghiệm thu. WW-5 vẫn là kế hoạch đóng gói riêng.

Đợt code đầu tiên là **AU-1: thống nhất profile và quyền của direct/team, chuẩn hóa prompt bàn giao**. Chưa bật cơ chế app tự sửa source của chính nó liên tục.
