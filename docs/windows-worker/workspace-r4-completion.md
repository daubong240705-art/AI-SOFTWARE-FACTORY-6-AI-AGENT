# R4 — Trang chính, Đội ngũ và Kết quả

Ngày 05/11/2026. Baseline `67717c2`, checkpoint `ad5103b`. Worker `1.3.0-alpha.8`, SQLite14. [Kế hoạch](workspace-r4-plan.md). Hoàn thành lát cắt R4; R5 thiết lập và R6 lịch chưa triển khai.

## Thay đổi

- Trang chính có năm mục cần xử lý, năm kết quả mới, lượt đang chạy thật và điểm vào Lead. Chọn rõ dự án rồi mở ChatHost hiện có; mở lại dùng cùng hội thoại trong phiên, giữ nháp theo dự án. Không có composer hoặc cơ chế gửi thứ hai.
- Sidebar có Đội ngũ toàn ứng dụng và badge actionable. Badge đếm trực tiếp SQLite, không giới hạn ở 50 run hay 50 mục đầu; đã xem không làm giảm số việc chưa giải quyết.
- Một shared feed cho Home/badge/Team, coalesce request, cập nhật 900ms khi active và 2.500ms khi idle. Lỗi hoặc quá 3 giây chưa phản hồi giữ dữ liệu lần cuối với cảnh báo chưa đồng bộ; khóa thao tác mở từ dữ liệu stale. Không polling từng dự án để ghép tổng.
- Đội ngũ tái dùng projection/runtime hiện có: role đang làm đứng trước, hiển thị execution/task/model/hoạt động và dự án active. Rảnh là khả năng nhận việc theo cấu hình, không xác nhận runtime online. Một Controller/active run như kiến trúc hiện hành.
- Tab Kết quả theo dự án: report đã lưu mới nhất theo công việc hoặc lineage, 20 mục/trang với cursor `(at,id)`, tìm tiêu đề/mã/tóm tắt tiếng Việt không dấu và lọc kiểm chứng. Summary tối đa 320 ký tự; không trả output/diff/settings/source. Chat tư vấn thuần không vào danh sách. Lượt chưa liên kết mở inspector; lượt đã liên kết mở thẳng Kết quả trong hồ sơ đúng dự án. Chuyển dự án qua report dùng cùng cơ chế chọn hội thoại, tránh giữ chat của dự án trước dưới tên dự án mới.
- Kết quả tải lại khi mở, đổi bộ lọc, hồ sơ phát thay đổi hoặc bấm Cập nhật. Reply cũ sau đổi phạm vi/filter bị bỏ. Khi tải lỗi, dữ liệu cũ không mở được cho tới khi đọc lại thành công.
- Giữ R3: report metadata không khẳng định source current. Đổi revision/attempt liên kết làm kết quả cũ hết hiệu lực; detail và Controller tiếp tục kiểm source/artifact khi cần. Không hash source trong polling.
- Sửa căn trái các dòng Home và chia cột tìm/lọc có kích thước rõ ràng ở zoom cao; tiếp tục dùng dropdown riêng.

Không thêm dependency, migration, orchestrator, model call; không đổi DB/settings/credentials người dùng. Git/tools và Team theo dự án vẫn qua menu Khác.

## File chính

Trong `apps/windows-worker/`:

- `shared/workspace.ts`, `channels.ts`, `contracts.ts`, `electron/main.ts`, `preload.ts`: summary/result contract và IPC.
- `electron/storage/inbox.ts`, `reports.ts`, `electron/controller/runs.ts`: count chính xác, index metadata và projection active.
- `src/lib/workspace-store.ts`, `use-workspace.ts`: feed dùng chung và xử lý stale.
- `src/features/WorkspaceHome.tsx`, `WorkspaceTeam.tsx`, `ProjectResults.tsx`, `WorkspaceShell.tsx`, `AgentMonitor.tsx`, `src/App.tsx`, `workspace-shell.css`: giao diện/điều hướng dùng chung.
- `tests/workspace.test.ts`, `scripts/acceptance-workspace-summary-ui.cjs`, `run-acceptance.cjs`: unit/SQLite/feed và production Electron fixture.

README Worker, experience-loops và phương án redesign được cập nhật trạng thái.

## Kiểm chứng thực tế

| Kiểm tra | Kết quả |
|---|---|
| `npm test` | 243/243 đạt, gồm bốn test R4 |
| `npm run typecheck`, `npm run build` | Đạt; cảnh báo annotation Zod đã có từ trước |
| Prettier các file code thay đổi, `git diff --check` | Đạt |
| `workspace-summary-ui` | 12 layout: Home/Team/Kết quả ở 1366×768, 850×700, zoom 125%/150% |
| `workspace-shell-ui` | 4 layout; điều hướng, nháp/ảnh và project scope |
| `work-detail-ui` | 16 layout; hồ sơ bốn tab |
| `reports-ui` | 4 layout; report và quyết định |
| `ux06-ui` | 4 layout; Team/Inbox/template/readiness |

Tổng 40 cấu hình UI, các lần đạt không có lỗi renderer. R4 fixture kiểm 53 actionable kể cả đã xem, 24 kết quả qua hai trang, tìm không dấu, filter, lỗi/thử lại, mở report liên kết khác dự án và run-only, Team trước khi chọn dự án, không fan-out monitor, mở Lead hai lần không tạo hội thoại trùng và phục hồi nháp Alpha/Beta. Unit kiểm active task/execution thật qua Controller projection; fixture UI dùng đội ngũ idle, không tạo execution model thật.

Đã xem ảnh Home và Kết quả zoom 150%; sửa lỗi ô tìm bị co do Select rộng 100% và căn giữa do button style chung, rồi chạy lại đủ 12 layout R4. Hai lỗi fixture ban đầu: giả định sáu role thay vì bảy và click tab trước khi project selection hoàn tất; đã sửa fixture, không tính các lần đó là đạt.

Log local ở `.cache/r4-*.log` tại repo root. Fixture cuối R4 ở `apps/windows-worker/.cache/workspace-summary-ui-Pqtn7W/`; ảnh đã xem sau sửa CSS ở `workspace-summary-ui-F695tG/`; regression ở `workspace-shell-ui-QNkBwy/`, `work-detail-ui-KBDQW5/`, `reports-ui-buMOwa/`, `ux06-ui-GTJWEc/`. Ảnh/DB không đưa vào Git.

## Giới hạn và tiếp theo

- Chưa gọi model/OpenCode thật, chưa usability test với người dùng hoặc benchmark 500 item/2.000 run. Chưa tuyên bố đạt mốc mở hồ sơ ≤300ms.
- Index là report đã lưu mới nhất, không phải mọi message/task attempt. Report run-only giữ source freshness unknown cho tới đối chiếu; chưa bổ sung watcher hoặc đánh dấu superseded cho lineage run-only đang chạy chưa có report.
- Cursor ổn định khi dữ liệu không đổi; có kết quả mới/đổi phiên bản trong lúc phân trang thì bấm Cập nhật để lấy lại từ đầu. Không tạo item hoặc sửa report lịch sử khi chỉ đọc.
- Shared feed treo vô hạn sẽ giữ stale và chờ request đó hoàn tất, không tạo request chồng; khởi động lại app nếu IPC không hồi phục. Chưa thêm tự hủy IPC.
- R5 tiếp theo: rút gọn thiết lập gateway/model/role và kiểm môi trường theo yêu cầu. R6 mới nối timer/IPC/UI lịch từ storage hiện có. 3D vẫn tạm dừng.

Đóng Worker cũ, chạy `npm start` trong `apps/windows-worker` để nạp bản build. Không cần migration; rollback bằng revert source.
