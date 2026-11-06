# UX-01 — Tổng quan và điều hướng công việc

> Bàn giao ban đầu. [Đợt tinh gọn UI tiếp theo](ux01-ui-refinement.md) thay thế bố cục header/sidebar và cách trình bày Tổng quan trong tài liệu này.

Hoàn thành ngày **05/11/2026** trên `feature/worker-office-v1.3d`. Checkpoint trước thay đổi: `checkpoint/ux01-start-20261105` tại `0663233`. Worker giữ `1.3.0-alpha.8`, SQLite schema **7**; đây là feature commit, chưa phát hành stable.

## Hành vi đã triển khai

- Mở dự án vào **Tổng quan** với bốn phần: **Cần bạn xử lý**, **Đang làm**, **Kết quả gần đây**, **Hoạt động gần đây**. Không cần gọi model để tóm tắt.
- Header dùng chung có dropdown chọn dự án tự vẽ, branch, nhãn slot đang chạy, quyền mặc định, **Hỏi Lead** và **Tạo công việc**. Chuyển dự án bằng bàn phím được cả khi sidebar thu gọn.
- Hỏi Lead mở composer hiện có ở chế độ team, giữ draft. Tạo công việc mở editor Kanban hiện có, không tự chạy agent; token được tiêu thụ để không mở lại editor khi quay lại Board.
- Inbox dẫn đúng quyền/inspector, hội thoại needs_input hoặc hàng đợi held. Mở mục không tự đánh dấu đã giải quyết. Quyền được ưu tiên và mỗi run chỉ có một mục; bỏ quyền sót của run terminal.
- Đang làm dùng execution/task thật từ monitor; slot ở dự án khác được ghi rõ, không đưa task của dự án khác vào danh sách.
- Kết quả phân biệt **đã kết thúc** và **đã xác minh** bằng gate evidence/review hiện có. Direct run completed không tự được xác minh.
- Timeline Tổng quan dùng các mốc quan trọng của lượt hiện tại/gần nhất; Chat/Inspector ẩn TOOL_STARTED khỏi timeline gọn. Lỗi, dừng, kết thúc và chi tiết kỹ thuật vẫn có đường xem.
- Có loading/empty/error/stale và cập nhật lại. Liên kết thao tác từ dữ liệu cũ bị khóa khi mất đồng bộ; đổi dự án bỏ dữ liệu trước đó.

## Dữ liệu và phạm vi

Tái sử dụng monitor IPC đã validate, thêm tùy chọn `overview`. DTO giới hạn **12 lượt logic gần nhất** (lấy attempt mới nhất mỗi lineage), tối đa **50 yêu cầu chờ** và **12 mốc**. Kết quả hiển thị tối đa 5 lượt completed trong phạm vi đó. Đây là inbox dự án gần đây, không phải toàn bộ lịch sử hoặc inbox nhiều dự án.

Query milestone lọc trước LIMIT nên 350 tool events không che mất mốc cũ còn được lưu. Không thay retention hiện có: event chưa được lưu do cap không thể khôi phục; log chi tiết vẫn theo giới hạn hiện tại. Summary không trả settings, raw event text, command output hoặc diff; prompt/summary/error/model được redact và giới hạn chiều dài. Test snapshot fixture dưới 100KB, chưa coi đó là benchmark mọi dữ liệu thực tế.

Renderer tái sử dụng một MonitorStore theo project/query, không tạo poller theo widget. Cache revision tách roster/Board/Tổng quan để các query không vô hiệu hóa lẫn nhau; cache main giới hạn 128 entry. Snapshot cũ được đánh stale khi đăng ký lại.

Giữ Factory Lite + Windows Worker, một Controller, một active run toàn app và policy Full access/evidence hiện có. Không thêm dependency, service, migration hoặc đổi credentials/model. Văn phòng hiện có vẫn truy cập được; phát triển 3D tiếp tục tạm dừng.

## Kiểm chứng thực tế

| Kiểm tra | Kết quả |
|---|---|
| `npm test` trên source cuối | **166/166 đạt**, gồm 5 bài mới cho overview và timeline |
| Overview/interaction/monitor | Kiểm tra riêng đạt; nằm trong full suite cuối |
| `npm run typecheck` | Đạt trên source cuối |
| `npm run format:check` | Đạt |
| `npm run build` | Đạt main/preload/renderer; còn warning annotation từ Zod hiện có |
| `npm run test:native` | Đạt SQLite trên Electron, lưu/đọc sau restart và secure storage |
| Electron Tổng quan | Đạt: SQLite/IPC thật trong dữ liệu cô lập, không gọi provider, không lỗi renderer |
| Electron Đội ngũ | Đạt hồi quy điều hướng, bộ lọc, save settings, strict IPC và cửa sổ hẹp |

Acceptance Tổng quan kiểm tra: đúng project, needs_input/held, giữ draft tiếng Việt, tạo BoardItem thật từ header, mở đúng inspector, khóa khi offline và phục hồi, **không đọc runDetail để dựng Tổng quan**. Các lần đọc detail sau đó chỉ phục vụ Chat/Inspector. Kiểm tra cửa sổ 1440×900, 1366×768, 850×700 và zoom 125–150%; không tràn ngang hoặc nút header bị che. Menu dự án kiểm tra bằng Space/End/Enter tại cửa sổ hẹp. Run đang chạy/chờ quyền và slot dự án khác có bài render từ production projection; không tuyên bố đã chạy model thật.

Lệnh chạy lại sau build trong `apps/windows-worker`:

```powershell
npm run typecheck
npm run format:check
npx tsx --test tests/overview.test.ts tests/interaction.test.ts tests/monitor.test.ts
npm run test:native
npm run build
node scripts/run-acceptance.cjs overview-ui
```

[Kết quả acceptance Tổng quan](ux01-ui.json). Ảnh kiểm tra chỉ ở `.cache` local, không commit/push. Bài Electron Đội ngũ ở `scripts/acceptance-monitor-ui.cjs` dùng dữ liệu cô lập; kết quả lần chạy được in ra stdout.

## File chính

- Projection/DTO: `electron/controller/overview.ts`, `shared/overview.ts`, monitor/controller/store và query milestone trong `electron/storage/database.ts`.
- UI: `src/features/ProjectOverview.tsx`, `src/overview.css`, `src/App.tsx`, ChatWorkspace, KanbanBoard và TaskTimeline.
- Đồng bộ: `src/lib/use-monitor.ts`, `monitor-store.ts`, `electron/controller/monitor.ts`.
- Kiểm tra: `tests/overview.test.ts`, `tests/interaction.test.ts`, `scripts/acceptance-overview-ui.cjs`, cập nhật điều hướng harness Đội ngũ và entry `overview-ui`.

## Phần tiếp theo

**UX-02 — Hồ sơ công việc bền vững**: mở rộng BoardItem, mã công việc, revision yêu cầu, discussion và lịch sử submissions/attempts; cần migration được kiểm tra riêng. Chat dock, QuestionSet, report immutable và inbox toàn dự án chưa triển khai trong UX-01. Chi tiết ở [kế hoạch](../archive/plan/experience-loops/implementation.md).
