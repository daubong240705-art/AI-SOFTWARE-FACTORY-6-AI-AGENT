# Windows Worker — Kiến trúc và hợp đồng

## 1. Cấu trúc source

```text
apps/windows-worker/
  electron/
    main.ts
    preload.ts
    ipc/                    # Các IPC được cho phép, validate input
    controller/             # Run, task, recovery, giới hạn
    runtime/                # OpenCode adapter, process manager, events
    gateway/                # 9Router, models, TLS, credentials
    workspace/              # Project, Git, diff, local commands
    storage/                # SQLite, migrations, repositories
  src/
    app/                    # Shell, navigation
    components/
    features/               # Project, task, team, activity, result, settings
    styles/
  shared/                   # DTO/schema IPC, không chứa secret
  agent-profiles/           # Lead + PM/BA/BE/FE/TEST/DEVOPS
  skills/                   # Bốn nhóm hướng dẫn cố định
  resources/                # Icon, metadata đóng gói
  package.json
  README.md
```

App data nằm trong `app.getPath('userData')`: `worker.sqlite`, ciphertext credential, cấu hình riêng theo runtime, logs và run artifacts. Không đặt tại thư mục cài đặt hoặc source dự án. Có retention theo dung lượng/tuổi; không tự xóa lịch sử chưa kết thúc.

## 2. Ranh giới trách nhiệm

| Thành phần | Trách nhiệm | Giới hạn |
|---|---|---|
| Renderer | Form, status, diff, activity | Không Node integration, không shell, không API key |
| Preload | API IPC nhỏ, typed | Không expose generic exec/readFile |
| Controller | State machine, persistence, budget, retry | Không viết lại tool đọc/sửa source của OpenCode |
| OpenCode adapter | Khởi chạy/session/event/subagent/cancel | Chỉ dùng API/CLI đúng phiên bản được pin |
| Lead | Lập kế hoạch, chọn role, đánh giá nội dung | Không tự nâng quyền hoặc thay đổi giới hạn Controller |
| Process manager | Quản lý PID/cây process/dev server | Không kill theo tên process toàn máy |
| Gateway client | Models, TLS, xác thực | Không đưa key vào renderer hoặc log |

`contextIsolation` bật, `nodeIntegration` tắt; chặn navigation/window mới ngoài dự kiến. Output và Markdown hiển thị như dữ liệu, không thực thi HTML/script từ model. Giới hạn kích thước payload IPC, log và diff.

## 3. Chiến lược điều phối

Ưu tiên một OpenCode session Lead sử dụng sáu subagent native nếu phiên bản đã cài cung cấp đủ chọn model, event, permission và cancel. Không dựng thêm planner cạnh tranh với Lead.

Nếu native subagent thiếu khả năng cần thiết, giữ cùng RuntimeAdapter và chạy session theo role tuần tự: Lead tạo plan có schema, Controller thực thi plan và đưa kết quả về Lead. Đây là nhánh triển khai dự phòng, không làm đồng thời hai engine.

Quyết định được ghi ngay trong WW2-02 khi đọc giao diện runtime; không tạo một phase thử riêng. UI và DB sử dụng hợp đồng nội bộ nên không phụ thuộc trực tiếp tên event upstream.

## 4. RuntimeAdapter nội bộ

Các tên dưới đây là API ứng dụng dự kiến, **không phải tên endpoint/SDK OpenCode đã xác minh**:

- `describeCapabilities()`: version, event/subagent/model/cancel/permission support.
- `startRun(context)`: workspace, task, role/model snapshot, giới hạn và policy.
- `subscribeEvents(runId)`: stream event chuẩn hóa.
- `respondPermission(requestId, decision)`: phản hồi quyền có phạm vi.
- `cancelRun(runId)`: yêu cầu dừng rồi kết thúc process do app sở hữu nếu cần.
- `inspectSession(sessionId)`: phục hồi metadata khi runtime hỗ trợ.

Controller chỉ đánh dấu hoàn thành sau khi đã đối chiếu kết quả runtime, trạng thái task, thay đổi file và kết quả lệnh cần thiết. Exit code 0 của CLI không tự chứng minh feature đã đạt.

## 5. Dữ liệu SQLite

| Bảng | Dữ liệu chính |
|---|---|
| `projects` | id, tên, đường dẫn chuẩn hóa, Git root, lần mở cuối |
| `settings` | gateway URL, CA path, runtime path/version, giới hạn, schema version |
| `agent_settings` | role, enabled, model ID, preset |
| `runs` | project, yêu cầu, state, workspace baseline, settings snapshot, timestamps |
| `tasks` | run, role, dependency, mục tiêu, scope, AC, state, fix round |
| `events` | sequence, run/task/session, type, timestamp, payload đã redaction |
| `command_results` | argv/display command, cwd, exit code, duration, output reference |
| `file_changes` | baseline/final reference, path, loại thay đổi, binary flag |
| `artifacts` | báo cáo, diff snapshot, output lớn; đường dẫn trong app data |
| `permission_requests` | hành động, scope, decision, thời điểm; không chứa secret |

Không lưu key trong settings hoặc model snapshot. Agent/profile/skill được snapshot bằng version/hash cho run; setting mới chỉ áp dụng cho run mới. SQLite dùng transaction cho thay đổi state và event liên quan; migrations có backup trước nâng schema.

## 6. Trạng thái và event

Run: `queued → running → completed | failed | cancelled`. Thêm `blocked` khi thiếu cấu hình/quyền/thông tin; `interrupted` khi ứng dụng hoặc runtime kết thúc ngoài dự kiến; `cancelling` trong quá trình dừng. Mỗi thời điểm chỉ có một run giữ execution lock.

Task: `queued`, `running`, `blocked`, `failed`, `completed`, `cancelled`, `skipped`. `skipped` phải có lý do, không được coi là AC đã đạt.

Event envelope: `id`, `sequence`, `run_id`, `task_id?`, `session_id?`, `role?`, `type`, `timestamp`, `payload`. Sequence do storage cấp, dùng để nối lại UI và chống hiển thị trùng.

Event chuẩn: run/task started, agent selected, tool started/completed/failed, permission requested/resolved, files changed, command completed, test passed/failed, task completed/failed, run blocked/interrupted/completed/cancelled. Chỉ lưu tóm tắt hành động/kết quả; không thu thập suy luận nội bộ của model.

## 7. Workspace, Git và quyền

- Chọn root thực tế; phát hiện Git worktree, nested repo, junction/symlink. So sánh đường dẫn theo quy tắc Windows, không chỉ kiểm tra prefix chuỗi.
- Một task có logical scope để giao việc; đây không phải ACL của hệ điều hành.
- Ghi nhận HEAD, staged/unstaged/untracked và baseline file liên quan trước run. Không tự commit, stash, reset, clean hoặc thay staging area của người dùng.
- Với repo chưa có Git, vẫn cho mở project; nêu giới hạn và chỉ khởi tạo Git qua thao tác rõ ràng của người dùng.
- Nguồn diff ở Git repo bao gồm staged, unstaged và untracked; xử lý rename/delete/binary, giới hạn file lớn, không coi ignored output là source thay đổi mặc định.
- Không tự rollback toàn repo. Thao tác khôi phục từng file phải phát hiện thay đổi ngoài app kể từ snapshot, tránh đè công việc mới.
- Tool policy chặn quyền rộng mặc định. Lệnh shell tự do không được quảng bá là đã khóa trong workspace chỉ bằng cwd hoặc lọc chuỗi.
- Không tự cấp quyền admin, sửa cấu hình Windows, lấy credential hay deploy production. Repo không tin cậy nằm ngoài MVP native.

## 8. Gateway và bí mật

TLS phải xác minh; hỗ trợ CA nội bộ bằng cấu hình trust thích hợp của client/runtime, không thêm tùy chọn tắt TLS toàn cục. Models endpoint chỉ cung cấp catalog; chưa chứng minh model hỗ trợ tool calling.

Key được mã hóa bằng safeStorage; nếu secure storage không sẵn sàng, không âm thầm lưu plaintext. Chỉ main/runtime cần thiết được nhận credential; truyền qua cơ chế runtime hỗ trợ, tránh argv và config trong repo. Nếu dùng env cho child, phải thừa nhận công cụ con có thể thừa kế key; cần thu hẹp environment và không tuyên bố cách ly bí mật tuyệt đối. Proxy giữ key ở parent là phương án tăng cường sau, không là điều kiện MVP.

Không đưa `.env`, private key và credential file vào context theo mặc định. Cảnh báo thiết lập ngắn: nội dung source được gửi làm context có thể đi qua 9Router tới provider; local source không đồng nghĩa inference offline.

## 9. Giới hạn và phục hồi

Mặc định sản phẩm: một run, một task, tối đa hai vòng sửa cho mỗi run. Timeout và hạn mức model cấu hình được; nếu runtime không hỗ trợ hard token cap thì UI ghi rõ giới hạn theo dõi, không cam kết chặn chi phí tuyệt đối. Dừng khi hết deadline/hạn mức có thể thực thi.

Không tự replay lệnh sau crash hoặc mất gateway. Khôi phục metadata/history, yêu cầu người dùng chọn tiếp tục hoặc tạo lần thử mới, kiểm tra workspace còn khớp snapshot. Mất kết nối không biến run thành completed.

## 10. Giao diện

Sidebar nhỏ: **Dự án**, **Lịch sử**, **Cài đặt**. Workspace chính gồm yêu cầu và Run/Stop, team thu gọn, task hiện tại, các tab **Hoạt động / Thay đổi / Kết quả**. Một dòng trạng thái tổng quát; chỉ mở chi tiết khi cần.

Segoe UI/system font, nội dung 14px trở lên, tương phản rõ, bảng và form gọn; màu cam theo reference 9Router. Không mô tả dài dưới mỗi field, không nhân vật hoạt hình hoặc dashboard thống kê trang trí. Lỗi có nguyên nhân và thao tác khắc phục cụ thể.
