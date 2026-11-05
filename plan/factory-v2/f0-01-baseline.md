# F0-01 — Baseline source và bản đồ chuyển sang V2

Ngày bàn giao: **06/11/2026, Asia/Saigon**. Trạng thái: **hoàn thành kiểm kê F0-01**, chưa triển khai Host/UI V2. Baseline `968d44601555bed24af3db6bf0de7e78f8288405`, checkpoint `checkpoint/factory-v2-f0-01-20261106`, nhánh thực hiện `feature/factory-v2-foundation`.

Đầu ra: [reuse map](../../research/factory-v2/reuse-map.json), [snapshot kiểm kê](../../research/factory-v2/f0-01-inventory.json), [kiểm chứng bàn giao](../../research/factory-v2/f0-01-validation.json), [công cụ kiểm kê](../../scripts/factory-v2/README.md). Những đợt trước vẫn là kế hoạch; F0-01 không đồng nghĩa F0 hoàn thành.

## 1. Baseline được bảo vệ

| Nội dung | Quan sát / quyết định |
|---|---|
| Source V1 | `apps/windows-worker/`, version `1.3.0-alpha.8`, 273 file tracked tại baseline |
| Dirty tracked files khi bắt đầu | Không có; hai nhóm untracked ban đầu là `bao-cao/` và `docs/reports/`, không thuộc phạm vi thay đổi/stage |
| Checkpoint | Nhánh checkpoint trỏ đúng baseline trước khi tạo tài liệu/tool F0-01; checkpoint Git không sao lưu untracked hoặc DB |
| Source V2 | Chưa có `apps/factory-host`, `apps/factory-ui`, `packages/factory-contracts`; sẽ tạo riêng theo F0-03/F1/F2 |
| Node dùng cho inventory | `v22.20.0` trên Windows; không chứng minh Node hoặc runtime Linux đã sẵn sàng |
| Nền tảng cũ khác | `apps/api`, `apps/dashboard`, Python `pyproject.toml`, orchestrator/workers/integrations và pipeline cũ giữ nguyên |

Source nền tảng self-hosted cũ còn dependency LangGraph/PostgreSQL/Redis và hướng dẫn Docker trong README. Đây không là dependency của Host V2. Không xóa chúng để “dọn” trong F0-01; có thể vẫn phục vụ deployment cũ. Không thêm root workspace/package manager khiến scripts V1 đổi hành vi.

## 2. Bản đồ giữ / chuyển / viết mới

Đã đối chiếu **19 nhóm module, 96 đường dẫn source/test**. Mỗi mục có source hash theo commit, finding, target và required check trong JSON; không coi việc file test tồn tại là test đã pass.

| Nhóm | Quyết định | Lý do / cách đưa sang V2 |
|---|---|---|
| Chat receipts | Chuyển | Giữ request ID/fingerprint và transaction; thay role/mode bằng agent/context/command contracts |
| Chat UI | Chuyển | Giữ kinh nghiệm draft/images/paging/IME, tách `window.worker` và Run V1, dựng dock CrewHub |
| Evidence | Chuyển | Giữ run/attempt/session/source/hash identity; bỏ suy luận criteria theo tên role |
| Snapshot/checkpoint | Chuyển | Giữ completeness/content hash và bounded scanning; sửa assumptions path/case cho Linux |
| Process ownership | Viết mới | Win32 Job Object/C#/PowerShell không dùng làm Linux ownership; non-Windows spawn hiện tại chưa đủ recovery |
| Worktrees/integration | Chuyển | Giữ manifests, source checks, no-hooks và isolated integration; tách khỏi Run/TeamTask, Git optional |
| Handoff/task presentation | Chuyển | Giữ bounded context và BA dependencies; chuyển sang input/output revision refs, agent ID tự do |
| Coordinator/scheduler | Viết mới | Gỡ global active-run, tối đa hai execution và nhánh theo role; một queue/claims/fencing |
| OpenCode runtime | Chuyển | Học stream/session/error/stop; đặt dưới adapter interface và thêm Codex/Claude |
| Permission policy | Viết mới | Bỏ quyền theo tên role, cấu hình effective grants theo project/environment; review/decision độc lập |
| BA docs/reports | Chuyển | Đã có readable output/evidence; mở thành versioned documents/output registry |
| Questions/review/inbox | Chuyển | Giữ context/revision và một nơi ghi câu trả lời; loại tool events khỏi việc cần người dùng |
| Schedules | Chuyển | Đã có timer/preview/version/occurrence/history; nối event→rule→dispatch, không chỉ tạo backlog |
| UI primitives | Chuyển | Custom select/popover đã có; style lại palette/font và kiểm browser keyboard/collision |
| Format utilities | Giữ có chọn lọc | Format duration/request usage thuần; chỉ copy khi có consumer, không import source V1 lúc runtime |
| Electron transport/shell | Viết mới | Browser API/events thay IPC/native dialogs/safeStorage coupling; không copy App.tsx nguyên khối |
| DB/migrations/image boundary | Viết mới | Store tự migrate schema V1, image decoder dùng Electron; V2 có storage và credentials refs riêng |
| Skills catalog | Viết mới | Catalog nội bộ theo role không đáp ứng pinned skill/tool registry tự do |
| 3D office | Hoãn | Giữ source cũ, không đưa three/fiber vào V2 local |

Tổng: **11 chuyển, 6 viết mới, 1 giữ chọn lọc, 1 hoãn**. Đây là quyết định ở mức boundary; không phải 11 module đã port hoặc 6 module bị xóa.

## 3. Các phát hiện quan trọng để tránh mang lỗi thiết kế sang V2

1. `shared/contracts.ts` bắt agents length 7 và enum roles; `shared/team.ts` có worker roles cố định. Không dùng lại contracts này làm API public V2.
2. `storage/database.ts` tạo unique index `one_active_run` toàn app. `team/dispatch.ts` và `runtime/executions.ts` thêm trần hai execution. Chỉ thay UI không mở được concurrency mới.
3. Quyền Bash V1 **đã tự allow khi context cho shell**; không kết luận tất cả lệnh V1 đều phải Accept. Vấn đề còn lại là role policy và phạm vi runtime, cần effective-grants probe; WSL không tự sửa quyền.
4. `owned-process.ts` dùng Windows Job Object và C#; nhánh Linux chỉ `spawn()`. Không coi việc có nhánh Linux là đã quản lý được process tree/crash recovery trong WSL.
5. `workspace/files.ts` so root bằng `toLowerCase()`; đưa nguyên sang Linux có thể đánh đồng hai path khác nhau. Worktree manager có một số nhánh platform-aware nhưng vẫn cần kiểm symlink/case/ownership thực tế.
6. OpenCode pin `1.19.5`, model qua `nine_router`, external skills tắt, `mcp: {}`, native task tool tắt. Model/runtime/skills tự do cần adapter và registry thật, không chỉ dropdown.
7. Schedules tạo item `planningState: "backlog"`; chưa phải automation tự giao model/job. Giữ cơ chế dedup, mở rộng delivery qua cùng coordinator.
8. Chat request receipts, command identity và source/hash evidence đã có. Đây là cơ chế hữu ích để giữ, thay vì viết lại không có dedup hoặc dùng câu trả lời model đánh dấu pass.
9. React features gọi `window.worker`; chuyển sang web không thể chỉ bỏ Electron dependency. Cần API client và contracts độc lập, cursor/reconnect thay polling khi phù hợp.

## 4. Dữ liệu và credentials — vị trí, không migrate

| Vị trí | Xử lý trong F0-01 |
|---|---|
| `%APPDATA%\ASF Windows Worker\worker.sqlite` | Chỉ đọc filesystem metadata: tồn tại, 2.076.672 bytes tại snapshot; **không mở SQLite hoặc đọc bảng/log** |
| `worker.sqlite-wal`, `worker.sqlite-shm` | Không tồn tại tại thời điểm snapshot; không suy ra DB sẽ luôn đóng/an toàn để copy |
| Cùng data root: `owned-jobs/`, `runtime/`, `workspaces/` | Chỉ kiểm metadata thư mục; không chạy recovery, không đọc runtime credentials hoặc manifests người dùng |
| Credentials V1 | Source cho thấy encrypted BLOB và Electron `safeStorage`; không giải mã, không xuất/copy sang WSL |
| Evidence/files V1 | Source cho thấy blob/command artifacts trong SQLite; export/import phải bảo toàn refs/hash về sau |
| DB schema | Source hỗ trợ tối đa schema 15; **chưa đọc schema thực tế từ DB máy này** |

Không khởi tạo `new Store(livePath)` để khảo sát: constructor có `mkdir`, WAL, foreign keys và migrations. Backup DB/artifacts là việc F8 trên bản sao; Git checkpoint không thay thế backup dữ liệu. Snapshot metadata không phải bằng chứng DB không thay đổi bởi ứng dụng khác.

Đích V2 dự kiến: Linux source/workspaces/state riêng theo XDG; không fallback sang AppData V1, không dùng DB WAL chung hai OS, không chia sẻ node_modules. Không có Linux path hoặc thư mục state nào được tạo trong F0-01.

## 5. Quyết định tách source và stack

Theo hướng đã trao đổi với người dùng: **tách ứng dụng, giữ chung repo**, TypeScript cho Host/contracts, React+TypeScript cho UI, SQLite/file storage cho local. FFmpeg hoặc Python chuyên môn là job/process riêng khi cần; không đưa Python/LangGraph stack cũ vào dependency Host V2.

```text
apps/windows-worker/       V1 giữ chạy độc lập
apps/factory-host/         Host/API/runtime/queue/storage V2
apps/factory-ui/           Browser UI và API client V2
packages/factory-contracts/Schema/commands/events dùng chung V2
```

Runtime adapters trước mắt là module trong Host; chỉ tách package khi có nhu cầu. Source cũ được dùng để tham khảo hoặc copy utility có chọn lọc, **không import xuyên vào `apps/windows-worker`** vì sẽ kéo lại Electron/schema/role assumptions. Chưa cài dependencies hoặc đổi package lock trong bước này. F0-03 ghi ADR/build boundaries trước scaffold.

## 6. Kiểm chứng đã thực hiện và giới hạn

- `node --check scripts/factory-v2/inventory.mjs`: kiểm cú pháp công cụ inventory.
- Chạy inventory trên commit `968d446`, validate 19 module/96 source-test refs; lưu hashes của blob trong Git, không thực thi file được đọc.
- So working tree và Git tree V1 với baseline: file tracked V1/lockfiles và source nền tảng cũ giữ nguyên.
- Kiểm JSON, link tài liệu, số nhóm/quyết định, source hashes, checkpoint/branch và `git diff --check`; evidence ở [validation](../../research/factory-v2/f0-01-validation.json).

Chưa chạy app build/tests, chưa gọi model, chưa khởi động/cài WSL, chưa đánh giá auth Linux. Đây là ticket inventory, không thay ứng dụng nên không chạy smoke scripts có thể mở DB/giải mã key/gọi model. Không stage ảnh, reports người dùng, DB hoặc `.cache`.

## 7. Bàn giao công việc tiếp theo

**F0-02** là bước kế tiếp: checklist chín màn, states/seed data và style guide theo CrewHub, ưu tiên Board/Chat, Dashboard và Team. **F0-03** chốt ADR/contracts/schema/adapter/grants; sau đó F1 bootstrap Host và F2 dựng UI. F0-01 không mở lại câu hỏi đã chốt về repo/ngôn ngữ và không bắt người dùng duyệt lại từng thao tác trong phạm vi.
