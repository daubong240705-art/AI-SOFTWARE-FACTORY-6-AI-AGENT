# ADR-001 — Module mẫu và stack

Ngày: 03/11/2026. Trạng thái: quyết định cho MVP.

Chọn **Mini Helpdesk độc lập**: tạo ticket, danh sách/phân trang, chi tiết, cập nhật trạng thái và lọc trạng thái/ưu tiên. Backend FastAPI/Python 3.12, PostgreSQL 17; frontend Next.js/TypeScript, Node 22 LTS. Pin patch version/image digest trong bước bootstrap.

Nền tảng ASF dùng FastAPI + LangGraph + PostgreSQL + Redis/RQ, Next.js dashboard. Hai repo GitLab và hai stack DB/volume riêng: `ai-software-factory`, `mini-helpdesk`.

ITCare-2026 là **mẫu tổ chức work package/workflow**. Không sao chép SRS, dữ liệu, ngày synthetic, tiến độ hay mã Spring Boot của ITCare sang sản phẩm demo. Điều này giới hạn phạm vi thực nghiệm và giữ đồng nhất toolchain cho worker.

BA freeze API contract trước fan-out BE/FE. Người dùng duyệt spec và deployment; một vòng test fail → fix → pass phải có bằng chứng trên commit thật. Thay module mẫu sau này cần cập nhật ADR và backlog trước coding.
