# R3B — Trạng thái chờ và tiến độ giữa các màn hình

Cập nhật: [R3C đã hoàn thiện trạng thái kết quả/capability](workspace-r3c-completion.md); [Bash tự động](bash-autonomy-completion.md) đã thay Ask/Full access. Các mục chưa hoàn thành bên dưới ghi trạng thái tại thời điểm bàn giao R3B.

Ngày 05/11/2026. Baseline `7ef1179`, checkpoint `63fceae`. Worker alpha.8 / SQLite14. [Kế hoạch](workspace-r3b-plan.md), [đề xuất Bash](bash-autonomy-proposal.md).

## Đã thay đổi

- `WorkStateView` nhận facts gọn, dùng được cả detail và summary. Một bộ nhãn cho chờ quyền, câu hỏi, nghiệm thu, lỗi và hàng chờ; Inbox dùng chung nhãn với Overview. Không thêm model call hoặc bảng trạng thái.
- Board lấy số quyền, số command và question state trong query projection, không load toàn bộ output/config của từng run. Lý do bị chặn nêu rõ chờ quyền/cần bổ sung/xung đột; giữ quy tắc cột và evidence gate hiện có. Revision mới không mang projection chờ của revision cũ.
- Tổng quan và Đội ngũ nhận projection run chung. Vẫn giữ activity riêng từng execution/lane và phân biệt role rảnh, đã tắt, chưa cấu hình. Nhãn tổng của lượt không thay trạng thái từng agent.
- Controller đối chiếu hiệu lực câu hỏi trước khi dựng các view. Câu hỏi pending hiện Cần trả lời; answered/superseded không yêu cầu trả lời lại, phân biệt đã xử lý với hết hiệu lực. Cần xử lý đã xem vẫn có thể còn actionable.
- `blocked` không có ticket quyền hiện Cần xử lý thay vì Đang làm. Giữ đồng thời nhiều blocker/action khi có câu hỏi/quyền/xung đột, không mất blocker phụ.
- Mất đồng bộ feed chỉ báo Chưa đồng bộ; không tự gán Kết quả phiên bản trước. Nhãn phiên bản trước cần report freshness tương ứng. `completed` thiếu report xác minh không tự thành hoàn thành tại projection chung.
- Chuyển acceptance Đội ngũ/Inbox từ sidebar cũ sang shell hiện tại; kiểm scope toàn app khi mở run dự án khác, chọn đúng dialog đang mở khi có Board cache. Fixture Lead chờ project sẵn sàng trước click để tránh race khi khởi động.

## File

Trong `apps/windows-worker/`: `shared/work-state.ts`, `board.ts`, `overview.ts`, `monitor.ts`, `inbox.ts`; `electron/controller/board.ts`, `monitor.ts`, `overview.ts`, `runs.ts`; `electron/storage/database.ts`; `src/features/AgentMonitor.tsx`, `ProjectOverview.tsx`; `tests/board.test.ts`, `overview.test.ts`, `questions.test.ts`; `scripts/acceptance-ux06-ui.cjs`, `acceptance-lead-access-ui.cjs`.

Tài liệu: bàn giao này, kế hoạch/đề xuất đã checkpoint, README Worker/experience-loops và phương án tổng thể. Không dependency, migration hoặc thay cấu hình/credentials/DB người dùng.

## Kiểm chứng

SQLite và runtime fixture riêng, không model thật.

| Kiểm tra | Kết quả |
|---|---|
| `npm test` | 236/236 đạt |
| `npx tsx --test tests/board.test.ts tests/overview.test.ts tests/questions.test.ts` sau chỉnh nhãn superseded cuối cùng | 30/30 đạt |
| `npm run typecheck`, `npm run build` | Đạt; cảnh báo annotation Zod baseline |
| Prettier source/script thay đổi, `git diff --check` | Đạt |
| `overview-ui` | 5 layout đạt |
| `work-items-ui` | 4 layout đạt |
| `ux06-ui` | 4 layout đạt, Đội ngũ/Inbox/template/readiness, không thực thi mutation thay câu hỏi/quyền |
| `lead-access-ui` | 4 layout đạt, không thay hành vi Full access hiện có |
| `work-detail-ui` | 16 layout đạt |

Tổng 33 cấu hình UI; không lỗi renderer ở các lần đạt. Acceptance UX06 cũ ban đầu lỗi selector/scope của shell trước R1; đã chuyển sang điều hướng và scope hiện hành. Một lần Lead fixture click project khi nút chưa sẵn sàng; thêm chờ đúng điều kiện rồi chạy lại đạt. Không dùng các lần thất bại làm bằng chứng sản phẩm đã đạt.

Artifact chỉ cache local, không commit ảnh/DB: `r3b-unit-tests.log`, `r3b-focused-tests.log`, `r3b-build.log`, `overview-ui-seVsB6/`, `work-items-ui-YVMdIp/`, `ux06-ui-xSs5WU/`, `lead-access-ui-HBwcEP/`, `work-detail-ui-4GfcXu/` trong `apps/windows-worker/.cache/`. Đã xem ảnh Đội ngũ ở 150% và ảnh lỗi fixture để đối chiếu scope.

## Giới hạn và phần kế tiếp

- Hoàn thành phần **trạng thái chờ/tiến độ của R3B**, chưa toàn bộ R3. Cần nối report freshness và capability nghiệm thu vào mọi view trong lượt tiếp theo. Board Done và số task xác minh hiện vẫn dựa bằng chứng review đã ghi; không phải cam kết source hiện tại không đổi. Mở report vẫn đối chiếu source theo yêu cầu và Controller xác thực mutation.
- Không hash toàn source mỗi lần poll, không khẳng định benchmark 500 item/2.000 run hoặc đã đánh giá usability/model thật.
- Chưa bỏ cơ chế hỏi Bash hoặc đổi default Ask. Phương án đề xuất là tự chạy Bash theo role và xử lý doom-loop riêng; chi tiết/giới hạn OS ở tài liệu liên kết. Đây là lựa chọn chính sách độc lập với projection.
- R4 summary/index/Team toàn app và R6 lịch còn ngoài phạm vi. Rollback bằng revert source; không cần phục hồi schema.
