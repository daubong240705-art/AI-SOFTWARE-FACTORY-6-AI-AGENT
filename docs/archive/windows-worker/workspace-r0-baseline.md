# R0 — Baseline và phạm vi shell

Ngày: 05/11/2026. Source trước refactor: `5624560`, nhánh `feature/worker-office-v1.3d`. Windows Worker `1.3.0-alpha.8`, SQLite 14.

## Baseline đã chạy

- `npm run typecheck`: đạt.
- `npm test`: 227/227 đạt, không gọi model thật.
- `npm run build`: đạt; có cảnh báo annotation của dependency Zod, không lỗi build.
- `node scripts/run-acceptance.cjs overview-ui`: đạt, 5 cấu hình layout, không lỗi renderer, DB fixture riêng. Ảnh và JSON tại `apps/windows-worker/.cache/overview-ui-ZfcvNE/` (Git ignore).

## Mapping R1

| Phạm vi | Điểm vào | Nội dung / mapping nội bộ |
|---|---|---|
| Toàn app | Trang chính | `home`: danh sách project và active run từ runtime hiện có; chưa có summary/inbox count toàn app R4 |
| Toàn app | Cần xử lý | `inbox`: GlobalInbox hiện có, đổi nhãn; unread không phải resolved |
| Dự án | Chọn tên project | Mở `board`; không tự điều hướng về Tổng quan |
| Dự án | Công việc / Trao đổi | `board` / `project`; giữ ChatHost writer và Kanban mounted khi đổi view |
| Dự án | Khác | `overview` Tổng quan dự án, `monitor` Đội ngũ, `git`, `office` thử nghiệm |
| Toàn app | Công cụ nâng cao | `history` lịch sử gần nhất hiện có; không giả là lịch sử đầy đủ |
| Toàn app | Cài đặt | `settings`; secret input không tồn tại qua điều hướng |

Đội ngũ hiện chỉ monitor theo project. R1 giữ phạm vi đó và ghi rõ tên project; summary toàn app, Kết quả index và badge actionable tiếp tục R4. Không dựng tab chức năng chưa có.

## Các điều kiện phải giữ

- Không thay Controller, queue, schema, credentials, permission, model/profile hoặc policy execution.
- Trước điều hướng/chuyển project phải flush draft; lỗi lưu thì giữ nguyên view/context. Chỉ một ChatHost, không key theo page.
- Board giữ filter/view/scroll khi đổi tab và project rồi quay lại; không bắt đầu polling nhiều project.
- Nội dung project không lẫn với Cần xử lý/Cài đặt/Trang chính; context và đường Back rõ ràng cho R2.
- Tên dài, empty/error/stale, compact sidebar, cửa sổ 850px và zoom 125/150% có bằng chứng UI.
- Không thêm dependency/router; không gọi model để kiểm layout. Không commit ảnh hoặc dữ liệu fixture.

## Git và rollback

Chỉ stage tài liệu của đợt này để tạo checkpoint trước source refactor. Giữ các file chưa track của người dùng (`crewhub/`, roadmap, cache) nguyên trạng. Không `git add .`.

R1 không migration; có thể revert commit source R1 để trở về baseline. Không cần phục hồi DB. Không sửa dữ liệu app thật trong quá trình kiểm chứng.
