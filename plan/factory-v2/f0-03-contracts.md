# F0-03 · Source boundaries và contracts

Ngày **06/11/2026**. Trạng thái **Done ở mức hợp đồng/source foundation**; chưa có Host/API/UI V2 hoặc adapter chạy thật. Checkpoint `checkpoint/factory-v2-f0-03-20261106` tại `864b22b`. Không sửa source V1, không mở/chuyển DB người dùng.

Đầu ra: [package contracts](../../packages/factory-contracts/README.md), [SQL reference](../../schema/factory-v2/001-core.reference.sql), [evidence](../../research/factory-v2/f0-03-validation.json). Các quyết định dưới đây chi tiết hóa [workflows](workflows.md), không thay phạm vi F1–F8.

## ADR-001 · Ranh giới source và dependency

| Đường dẫn | Owner / trách nhiệm | Trạng thái |
|---|---|---|
| `packages/factory-contracts` | Zod schemas + inferred types; DTO/API version; không fs/process/SQL/Electron | Đã tạo |
| `apps/factory-host` | Node TypeScript/Linux: transport/auth, domain transactions, SQLite/outbox, một coordinator, runtime adapters/modules | Dự kiến F1-02 |
| `apps/factory-ui` | React/TypeScript/Vite: projections, components, vi/en/theme/window store, browser transport | Dự kiến F2-01 |
| `schema/factory-v2` | Reference invariants; Host migration ledger về sau | Reference đã có |
| `design/factory-v2` | Tokens/resources/fixture; tái dùng asset/resources có chọn lọc | F0-02 |
| `apps/windows-worker`, `apps/dashboard`, Python V1 | Sản phẩm hiện hành; không runtime dependency của V2 | Giữ nguyên |

Dependency: UI → contracts; Host → contracts; adapter modules trong Host → contracts/adapter. Contracts không import consumer; UI không import adapter/process implementation. Adapters chỉ chạy process/protocol và phát callback; không trực tiếp đổi work status, tạo task hay tự dispatch. Một coordinator ghi assignments/run attempts cho cả Lead/automation/schedule/job. Chưa tạo package orchestrator/adapters/presets riêng.

Package npm riêng có lockfile, exports ESM/declarations, Node ≥22.20.0; build shared trước consumer, không dùng node_modules Windows trong WSL. Không thêm root workspace ảnh hưởng V1. Zod MIT, TypeScript Apache-2.0: dependency registry có integrity/license, không copy source ngoài. Package private, không publish trong F0.

## ADR-002 · Transport, authority và errors

F1-02 cung cấp `/api/v1/capabilities`, `/api/v1/commands`, queries theo project và `/api/v1/projects/:id/events`. Browser UI được Host serve cùng origin. Bind loopback mặc định; remote exposure là cấu hình riêng có auth/TLS, không tự bind mọi interface.

Host kiểm Host header, exact allowed Origin cho mutation, content type JSON, kích thước body (mặc định tối đa 1 MiB), session và CSRF trước handler. Session được tạo qua local bootstrap token một lần không log; đổi thành cookie HttpOnly/SameSite=Strict (Secure khi HTTPS). Không gửi bootstrap token qua URL. Không dùng wildcard CORS hoặc coi localhost là đủ authorization. SSE cùng origin dùng session cookie; không token trong query. F1 phải có tests auth/origin/CSRF/session expiry trước đánh dấu API sẵn dùng.

Client gửi `{apiVersion, commandId, projectId, type, payload}`. `actorId/sessionId/authority` do Host lấy từ trusted context; agent/automation đi vào cùng command service qua context nội bộ. Browser không được tự xưng Host/automation hay gửi effective grant. Session phải có quyền đọc/mutate project; tồn tại ID không đồng nghĩa có quyền.

API version hiện là **1 của wire V2**, không phải product V1. Major không hỗ trợ → unsupported; schema strict từ chối unknown keys. Host capabilities chỉ liệt kê handler đã có. Commands trong package là hợp đồng, không chứng minh endpoint tồn tại. Tương lai muốn thêm rule/schedule/extension command phải thêm schema/tests và negotiate capability, không nhận object tùy ý.

| Lỗi | HTTP dự kiến | Xử lý của client |
|---|---|---|
| validation | 400 | Sửa input, field errors giới hạn, không raw SQL/stack |
| needs-auth | 401 | Đăng nhập/session/runtime auth; không retry liên tục |
| forbidden | 403 | Actor không có quyền, không biến thành Bash Accept |
| not-found | 404 | Không có hoặc che resource ngoài scope |
| conflict | 409 | Refresh revision/context; không tự ghi đè |
| permission-configuration | 422 | Một blocker tổng hợp, cấu hình profile/adapter |
| resource-exhausted | 429 | Chờ budget/resource hoặc đổi cấu hình được cấp |
| runtime-unavailable | 503 | Hiển thị probe reason/freshness |
| outcome-unknown | 409 | Reconcile external effect trước retry |
| unsupported | 422 | Không expose action chưa có handler/capability |
| internal | 500 | Correlation ID, log đã redact; không lộ secrets |

Errors có `correlationId`, message/nextAction và optional currentRevision. `nextAction` là gợi ý UI, không cấp quyền retry. Receipt accepted trả 202; completed 200; rejected/unknown theo error. Receipt cho biết command đã nhận/hoàn tất, **không** có nghĩa một runtime run đã thành công. Effects là refs đã commit, không trả dữ liệu SQL/credentials. Runtime error trong run không biến chat command đã nhận thành lần gửi thất bại để browser resend.

## ADR-003 · Idempotency, revision và một queue

`commandId` UUID unique toàn Host. Fingerprint SHA-256 của JSON canonical sau validation/ID normalization (sort object keys, giữ thứ tự arrays, UTF-8), gồm actor identity + apiVersion/project/type/payload. Không hash cookie/token. Cùng ID/cùng fingerprint trả receipt cũ sau khi xác thực quyền hiện tại; khác fingerprint trả conflict, không overwrite receipt hay thực thi lại. Timeout client tra receipt/gửi lại **cùng ID và payload**, không tạo ID mới. Receipt cho rejected/create cũng durable nên bảng không FK project chưa tồn tại.

`expectedRevision` là compare-and-swap: create dùng null ở schema cho phép; update khớp revision hiện hành rồi +1. Không LWW. Conversation send dùng conversation revision để phát hiện context đổi. Foreign refs (agent/input/workflow/status/contract/asset) phải tồn tại, đúng project và đúng pinned revision trong cùng transaction. Status category lấy từ workflow revision; browser không tự gửi category/done để bỏ guards.

Một transaction `BEGIN IMMEDIATE`: kiểm receipt/revision/guards → ghi domain state/receipt → cấp sequence project → ghi event/outbox → commit. Worker consume assignment sau commit; không gọi runtime trong transaction. Sau crash, command đã accepted tiếp tục bằng queue/recovery, không gọi model lại từ receipt replay.

Coordinator claim assignment bằng CAS epoch/state và ghi run attempt + lease + reservations trong transaction trước spawn. Chỉ một live assignment/task và live attempt/assignment; không có global one_active_run. FE/BE có input contract và isolated scopes có thể chạy đồng thời. Resource capacity và canonical ancestor-path overlap kiểm ở Host; unique lock key trong SQL chỉ bảo vệ một lock đã tính, không tự phát hiện mọi path overlap. Lease hết hạn không đồng nghĩa process cũ đã chết: reconcile/quarantine scope trước giao lại.

Callback mang project/run/assignment/epoch/lease/callbackId/sequence. Host transaction kiểm attempt đang live, assignment epoch hiện hành, lease còn hiệu lực theo đồng hồ Host; dedup callback ID và sequence, sau đó apply state + inbox + outbox. Callback cũ không được ghi terminal cho run mới. Kiểm helper trong package là lớp bổ sung; chưa có implementation transaction Host. Wall-clock restart/clock jump cần recovery; không tin timestamp do runtime cung cấp để kéo dài lease.

Output mutation bên ngoài không có exactly-once tuyệt đối. Crash sau spawn/external write trước ACK → outcome unknown, kiểm owned process/session/artifact, không auto-replay prompt. Tối đa ba vòng sửa/issue, gắn identity ổn định; khóa quyền/budget/auth không là lỗi nội dung để retry ba lần. F3/F4 triển khai durable issue budget.

## ADR-004 · Adapter và quyền hiệu lực

[Interface](../../packages/factory-contracts/src/adapter.ts): `probe`, `prepareGrant`, `start`, `reconcile`; owned execution có `requestStop` và `waitForExit`. Adapter identifiers mở; model/provider ID giữ nguyên. Probe phân biệt installed/authentication/compatibility, capability unsupported bắt buộc reason. Không giả Codex/Claude/OpenCode có cùng resume/interrupt/child sessions.

Host pin snapshot agent/model/profile/skills/tools cho mỗi attempt. Trước start kiểm attestation cùng adapter/environment/profile revision/configuration digest còn tương ứng cấu hình hiện hành. Adapter phải fail closed nếu cấu hình thay đổi hoặc không enforce được, kể cả schema grant hợp lệ. Runtime session opaque gắn connection/adapter; không resume session bằng runtime khác. `emit` Promise phải hoàn thành sau xử lý/durable acknowledgement hoặc reject; backpressure/size limits và protocol parsing thuộc adapter F1-03.

`requestStop` chỉ ACK yêu cầu, không được đánh stopped. Host chuyển stopping, interrupt theo capability, chờ grace rồi kill **owned** process tree Linux; chỉ terminal sau process/protocol evidence. Nếu không xác minh exit/effects thì interrupted + unknown và reconcile. Không kill theo process name hay dùng Windows Job Object ở Linux. Probe/reconcile không resend prompt.

Profile khai báo environment, roots read/read-write, network deny/allow-list/environment, tool IDs, actions và budgets/concurrency. Root cache/temp/tool paths cần khai báo trong environment; Host resolve symlinks/realpath, kiểm ancestor theo Linux case, không `.toLowerCase()` path. Syntax validator không thay realpath authorization. Shell có thể vượt phạm vi file nếu runtime không enforce: adapter/environment phải thực sự giới hạn hoặc báo blocker, không quảng cáo sandbox giả.

`full-environment` là toàn quyền **đã khai báo** trong environment, không tự thêm root/global GUI/publish/spend/credential action. Profile do Host quản lý, không browser attestation. Skills/tools/presets không nâng quyền. Effective grant blocked gom các dimension/reason/remedy thành một lỗi cấu hình; không tạo hàng trăm Bash Accept. Hỏi quyết định nghiệp vụ (`decisions.answer`) và duyệt output (`reviews.submit`) là hai record khác grant. Đã cấp scope thì không hỏi lại từng lệnh; thay scope/quyền chưa được cấp mới cần cấu hình/ủy quyền tương ứng.

## ADR-005 · Hội thoại, nháp, window và event stream

`conversations.create` chọn agent có membership trong project. `chat.send` luôn tạo một message durable và một conversation turn qua cùng queue; **discuss không tạo/dispatch work item**, Lead trả lời/đề xuất trong hội thoại. `delegate` cho phép work service tiếp nhận kế hoạch theo quyền/guards hiện có, không cho model tự bỏ review. Alpha chỉ expose Lead; schema agent tự do để F3 mở rộng.

Send pin messageId + commandId; unique DB ngăn message trùng. Actor lấy từ session. Draft record khóa `(project, conversation, actor)`; null chỉ tạo khi chưa có, revision hiện có mới update. Tab stale nhận 409 và chọn giữ/gộp nội dung, không silent overwrite. Send chỉ clear draft nếu đúng `draftRevision`; nháp mới được gõ trong lúc run gửi vẫn giữ. Clear bằng update empty + tăng revision, không delete/recreate revision 1 gây ABA ghi đè từ tab cũ. Cập nhật draft không tăng conversation revision của transcript. Draft không là message/event công khai cho agent khác.

Window ID chỉ presentation; conversation ID mới là history durable. Layout lưu project/conversation refs, geometry/mode/order tối đa 10 windows/5 visible. Window close/minimize/restore/theme/locale không send/stop/delete. Sau restore revalidate scope và clamp geometry theo viewport; không suy đoán run đang chạy từ layout. Layout không chứa transcript/draft/secrets. Appearance và layout schemaVersion/revision riêng; trạng thái local restore không tự gọi mutation execution. Sản phẩm về sau thực hiện store/window manager; F0 chỉ contract.

Event có eventId/project/cursor/entity revision, causation/root. Cursor gồm epoch + sequence decimal string tránh mất precision JS; sequence contiguous **theo project stream**, không global SQL rowid. SSE `id` encode cursor; client replay after cursor. Không filter bỏ các sequence trong stream này; feed UI filter sau apply hoặc dùng invalidation metadata cho sự kiện không cần body. Raw token/tool debug không đẩy thành unread activity; adapter deltas đi run channel riêng, message cuối/project events durable.

Sau parse: sequence ≤ current là duplicate, previous=current thì apply, gap/epoch khác thì snapshot-required. Consumer lưu projection/cursor atomically; snapshot + cursor lấy cùng read transaction. Cursor hết retention/epoch đổi → reset rồi snapshot/resubscribe; response không được giả reconnect thành empty success. `entity.changed` dùng ref invalidate/query; message/run events có body cùng project. Quyền project phải check lúc subscribe/reconnect. Query continuation opaque được Host bind project/filter/sort/snapshot; không SQL tùy ý, mặc định 50/tối đa 100. Snapshot/probe có observedAt/staleAfter; stale activity hiển thị unknown, không giữ badge working mãi.

## ADR-006 · SQLite, files và migration

Linux XDG state mặc định `$XDG_STATE_HOME/factory-v2` hoặc `~/.local/state/factory-v2`, DB `factory-v2.sqlite`; Host fail closed nếu path trùng V1, chạy trên filesystem WSL Linux. File assets trong state riêng theo ID/hash; browser chỉ nhận asset IDs và download đã authorize, không arbitrary path. Secrets qua Host credential refs; không lưu vào DTO/preferences/export/log. Node_modules và WAL không share writable qua Windows/WSL.

[Reference SQL](../../schema/factory-v2/001-core.reference.sql) dùng STRICT + FK composite project scope, pinned workflow/status/completion contract, receipts/messages/inbox/stream dedup, partial unique assignment/attempt, indexes Board/assignee/queue/lease/outbox. F1-02 phải bổ sung WAL/busy timeout/foreign_keys mỗi connection, transactional migration/checksum ledger, immutable revision rules, recovery và file permission; không chạy reference này như migration V1.

SQL không tự đảm bảo dependency DAG/parent DAG, transition guard/review authority, assignment epoch equality, consecutive stream allocation, config snapshot authorization hoặc capacity/ancestor locks. Host transaction services phải enforce và test từng invariant. F0 tests chạy SQL thật trong memory với CAS/fencing/rollback queries, chưa chứng minh multi-process Host crash behavior. Document/output versions, decisions/reviews/handoff, issue budgets, automations/occurrences/jobs/extensions có DTO hoặc mô hình kế hoạch; bảng bền vững tương ứng nằm F3–F6, không coi JSON placeholder là đã hoàn thiện nghiệp vụ.

F8 mới import trên bản sao, mapping/version/provenance/dry-run và rollback. Imported history paused, không tự dispatch. Không constructor store V1, reset DB hay copy credentials.

## Evidence và bàn giao

Chạy `node scripts/factory-v2/verify-contracts.mjs` sau `npm ci` ở package: strict typecheck + ESM/declarations build; 15 Node boundary tests; 11 SQLite memory tests; doc links/source boundary/legacy protection. [Evidence JSON](../../research/factory-v2/f0-03-validation.json) ghi kết quả thực tế và hashes. Không gọi đây là kiểm runtime/UI/auth thật. Design verifier được thu hẹp exception duy nhất cho package contracts mới; vẫn chặn thay đổi mọi source apps và package legacy.

Tiếp theo **F1-01 preflight WSL**: Linux user/disk/toolchain/network/CA/9Router, phân biệt installed/auth/compatible. Sau đó F1-02 dùng contracts này dựng Host/storage/API thật. Chưa cài package hệ thống, đăng nhập runtime, thay credentials hoặc triển khai production ở F0-03.
