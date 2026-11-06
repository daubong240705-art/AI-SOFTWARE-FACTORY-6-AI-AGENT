# UX-02 — Hồ sơ công việc

Triển khai ngày **05/11/2026**, nhánh `feature/worker-office-v1.3d`. Checkpoint: `checkpoint/ux02-start-20261105` tại `70b2882`. Worker giữ **1.3.0-alpha.8**; SQLite tăng **7 → 8**. Đây là thay đổi source, chưa phát hành stable hoặc bộ cài mới.

## Trải nghiệm đã triển khai

- **Công việc → Board / Danh sách** dùng cùng projection, query, bộ lọc và phân trang 50 thẻ. Tìm bằng mã hoặc tiêu đề/task. Thẻ kế hoạch giữ thao tác chuyển cột; sửa yêu cầu và gửi Lead tập trung trong hồ sơ để giảm nút trên thẻ.
- BoardItem giữ UUID, có mã **W-0001** tăng riêng trong mỗi project. Bấm tiêu đề mở panel **Tổng quan / Trao đổi / Lần thực hiện**, có mở rộng toàn cửa sổ. Đóng panel trả focus về thẻ và phục hồi vị trí cuộn; bộ lọc không bị xóa.
- **Tổng quan** chứa yêu cầu, tiêu chí hoàn thành, chỉnh sửa, gửi Lead, lưu trữ/khôi phục, xuất hồ sơ và lịch sử revision. Thay title/body/criteria tạo revision mới; thay metadata không tạo revision. Optimistic version chặn ghi đè. Khi xung đột, giữ bản nháp, cho tải dữ liệu mới để đối chiếu và chủ động chọn dùng bản nháp trên version hiện tại.
- **Trao đổi** lưu ghi chú người dùng, timestamp và nội dung Markdown an toàn, không raw HTML. Gửi lại cùng client ID không tạo hai ghi chú; thất bại giữ nội dung nhập. Có đường mở hội thoại Lead của công việc.
- **Lần thực hiện** hiển thị revision đã gửi, hàng chờ, các attempt, role/model/state và thời gian. Mở yêu cầu cũ hoặc đúng run trong TaskInspector; task/attempt picker của inspector tiếp tục hoạt động. Hàng chờ có Chạy tiếp/Bỏ khỏi hàng chờ; active run có Dừng lượt chạy. Panel dùng **Cập nhật** để đọc trạng thái mới, không tạo thêm poller.
- Gửi Lead tái sử dụng conversation đã liên kết, đưa mã/revision/criteria vào prompt. Submission có key chống gửi lặp; snapshot đã gửi và prompt của run/queue cũ không đổi khi sửa yêu cầu. Khi đang chạy/chờ không gửi thêm lần mới. Sau khi kết thúc có thể chủ động gửi lại, kể cả cùng revision.
- Board hiển thị một thẻ mỗi công việc, lịch sử nằm trong panel. Retry của submission cũ không thay thế submission mới hơn. Sửa yêu cầu sau khi run kết thúc đưa thẻ về **Sẵn sàng**, không dùng bằng chứng revision cũ để đánh dấu revision mới đã xong. Runtime vẫn không được kéo đổi trạng thái.
- Lượt chạy cũ chưa có BoardItem tiếp tục được hiển thị như trước. **Lưu thành công việc** mới tạo hồ sơ, liên kết cả retry lineage và không tạo trùng khi gọi lại. Không chuyển toàn bộ lịch sử chat thành thẻ.

## Dữ liệu và vận hành

Mở rộng `board_items` bằng criteria/number/revision/conversation; thêm `work_counters`, `work_revisions`, `work_submissions`, `work_attempts`, `work_comments`. Cấp số, revision, submit và claim/remove queue nằm trong transaction. `board_links` giữ adapter liên kết đầu tiên; Board và queue dùng lịch sử mới để tìm submission hiện hành.

Mở DB schema 7 tạo **worker.schema7.pre-work-items.backup.sqlite** trong cùng thư mục dữ liệu trước migration. Giữ UUID, archive/version, run/retry và liên kết hàng chờ held. Revision được dựng từ BoardItem cũ có nhãn **dữ liệu cũ**; prompt run cũ giữ nguyên, không coi đó là bằng chứng đã có criteria chuẩn hóa từ trước. Counter tiếp tục sau số lớn nhất của từng project.

Rollback: đóng ứng dụng; giữ bản sao toàn bộ thư mục dữ liệu mới; khôi phục backup schema 7 bằng binary tương thích schema 7. Không mở DB schema 8 bằng binary cũ. Không phục hồi backup đè dữ liệu đang được app mở.

**Xuất hồ sơ** lưu JSON có format/version, timestamp, yêu cầu hiện hành, toàn bộ revisions/comments/submissions và liên kết/trạng thái attempt. Không bao gồm file source hoặc nội dung evidence; manifest ghi rõ giới hạn này. Xuất báo cáo từng run trong inspector để lấy bằng chứng hiện có; báo cáo run có liên kết đúng submission/revision. API key hiện hành được redact khi xuất.

Retention bảo vệ mọi attempt còn được hồ sơ tham chiếu, gồm lịch sử cũ và thẻ lưu trữ; prune kiểm tra lại liên kết trước khi xóa. Project còn bất kỳ BoardItem nào đều bị chặn bỏ khỏi danh sách để bảo toàn hồ sơ. Archive không xóa dữ liệu. Chưa có chức năng xóa hẳn hồ sơ/project chứa hồ sơ.

Giới hạn hiện hành:

| Dữ liệu | Giới hạn |
|---|---|
| Work item/project | 2.000 |
| Title / description | 160 / 12.000 ký tự |
| Criteria | 30 tiêu chí, tối đa 500 ký tự mỗi tiêu chí |
| Revision/item | 500; trang 20 |
| Submission/item | 100; trang 20 |
| Comment/item | 1.000, tối đa 6.000 ký tự; trang 50 |
| Attempt/submission hiển thị | 100 gần nhất; export chứa toàn bộ refs |

Summary Board không trả description, raw output, diff hoặc settings; detail tải khi mở panel. Giữ một active run toàn app, queue/Controller hiện có, Full access, evidence gate và giới hạn runtime. Không thêm dependency/service/model call, không thay credentials. Phát triển 3D tiếp tục tạm dừng.

## Kiểm chứng

- Typecheck, build, Prettier check đạt. Build còn warning annotation của Zod đã có, không gây lỗi build.
- **50/50** bài liên quan Board, Chat, queue, monitor, evidence và team đạt trước kiểm tra toàn suite; trong đó Board **12 bài**, có migration schema 7 populated, revision/comment pagination, conflict/idempotency, snapshot queue, retry không trùng thẻ, legacy materialization, export và retention.
- Toàn bộ `npm test` trên source cuối: **171/171 đạt**.
- Electron native SQLite/secure storage đạt. Acceptance UX-02 mở DB schema 7 trong main process thật, kiểm tra backup/migration rồi dùng renderer/IPC/SQLite thật: Board/List, drag planning, tạo criteria, archive/restore, conflict giữ nháp, double submit comment, snapshot trước/sau sửa, export JSON, filter/scroll/focus, materialize legacy và đúng inspector.
- Panel đạt **1366×768, 850×700, zoom 125% và 150%**, không tràn ngang hoặc vượt viewport; không lỗi renderer. Hồi quy Tổng quan **5 layout** và UI foundation **5 layout** đạt.
- Ảnh, SQLite fixture và output acceptance chỉ lưu trong `.cache` đã ignore. Không commit/push ảnh.

Chạy lại từ `apps/windows-worker`:

```powershell
npm run typecheck
npm run format:check
npx tsx --test tests/board.test.ts tests/chat.test.ts tests/follow-ups.test.ts tests/monitor.test.ts tests/evidence.test.ts tests/team.test.ts
npm run test:native
npm run build
node scripts/run-acceptance.cjs work-items-ui
node scripts/run-acceptance.cjs overview-ui
```

`board-ui` và entry cũ `scripts/acceptance-board-ui.cjs` cùng chạy acceptance UX-02 hiện tại. Các fixture không gọi provider/model; chưa tuyên bố nghiệm thu model thật cho thay đổi này.

## File chính và phần tiếp theo

- Dữ liệu: `shared/board.ts`, `electron/storage/board.ts`, `work-migration.ts`, `database.ts`, `follow-ups.ts`.
- Projection/Controller: `electron/controller/board.ts`, `runs.ts`.
- IPC: `shared/contracts.ts`, `shared/channels.ts`, `electron/main.ts`, `preload.ts`.
- UI: `src/features/WorkItemPanel.tsx`, `KanbanBoard.tsx`, `src/ui/base.css`.
- Kiểm tra: `tests/board.test.ts`, fixture migration cũ và test migration Chat/queue/evidence/monitor/team; `scripts/acceptance-work-items-ui.cjs`.

Trao đổi trong UX-02 là ghi chú lưu bền, chưa phải chat dock tự gửi ngữ cảnh cho Lead. Tiếp theo **UX-03 ChatHost và chat theo ngữ cảnh**, rồi UX-04 câu hỏi nghiệp vụ/UX-05 reports theo kế hoạch. Chưa có tự lưu bản nháp ghi chú/editor khi đóng panel hoặc đóng app, attachment, actor agent trong discussion hay xóa hẳn hồ sơ. Không coi completed là verified khi evidence gate chưa đạt.
