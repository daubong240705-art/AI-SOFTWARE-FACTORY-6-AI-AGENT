# AU-4A — Lỗi, model và metrics có nguồn

Ngày: 04/11/2026. Baseline `e758167` (AU-3); checkpoint `checkpoint/au4a-20261104`; branch `feature/agent-upgrade-au4a`.

**AU-4A hoàn thành. AU-4B chưa triển khai**, chờ phần lifecycle WW-4D liên quan. Giữ Factory Lite + Windows Worker, một Controller, một run, task tuần tự. Không thêm dependency, orchestrator, tích hợp server hoặc thay cấu hình VM/credential.

## Vấn đề và thay đổi

- Lỗi dạng chuỗi khó phân biệt auth, budget, schema, quyền và test. Thêm failure code cùng message đã redaction trên run/task; các điểm lỗi đã biết tạo mã trực tiếp, adapter dùng phân loại fallback. Giữ nguyên nhân đầu tiên khi Stop hoặc lỗi runtime đến sau. Từ chối quyền đặt trạng thái dừng trước khi trả lời runtime, rồi đóng execution.
- Runtime có retry nội bộ nhưng Controller trước đây chưa có latch lỗi tại proxy. Proxy nay giữ lỗi đầu tiên, báo Controller dừng và từ chối request tiếp theo trước khi gửi upstream. 401/403, 429, 5xx/redirect, mạng/TLS, budget và model mismatch có mã riêng. Không lưu raw error body từ provider. Token execution sai không làm hỏng execution hợp lệ.
- Trước khi chạy, model task/direct phải đúng role đang bật trong settings snapshot. Không fallback model hoặc tăng budget. Hết budget và lỗi an toàn không đi vào schema repair hoặc task sau.
- Metrics gắn vào record run/task đã có role/model/attempt/fixRound/state: số request thử gửi qua proxy, thời gian, lệnh đạt/lỗi/chưa hoàn tất, input/output token quan sát từ `step-finish` và số bước đã ghi nhận. Lọc session và chống đếm trùng event/reconciliation. Request lỗi vẫn tính vào budget; request bị chặn trước upstream không tính thêm.
- Token chưa nhận là `null`, không phải 0; usage quan sát được không cam kết đầy đủ hay khớp billing. Chi phí luôn `null`, không suy giá từ tên model. UI gọn trong panel hiện có, lịch sử cũ ghi chưa có metrics chi tiết. Lệnh direct chỉ được coi đạt khi completed và exit 0.
- Store giữ schema6, thêm field optional trong JSON record. Reopen vẫn interrupted, không tự replay; run mới có mã interrupted, duration để unknown vì thời điểm mở lại không chứng minh thời điểm runtime kết thúc. Legacy không bị điền số liệu giả.

## Source đã đọc và quyết định retry

Đã đọc `packages/opencode/src/session/retry.ts` và `session/processor.ts` tại OpenCode **1.19.5**, commit `810c0eba1a7348036f8bdf61e6632d0c36c6876c` từ checkout cache. Retry policy có tối đa 5 lần retry, delay đầu 2 giây cùng exponential backoff/jitter cho các lỗi transient; processor dùng policy này. Nguồn/revision và license MIT được lưu trong [manifest](../../research/agent-upgrade/sources.json).

Không chứng minh được một task lỗi bất kỳ chưa gây tool side effect, nên không thêm retry tự động. Proxy latch chặn request upstream tiếp theo của execution đã lỗi; Controller đóng runtime sở hữu. Trường `retry: manual` chỉ là metadata cho lỗi phù hợp thử lại có chủ đích, không kích hoạt replay. Gateway/provider có thể có retry riêng ngoài phạm vi quan sát của Worker. Không chép source hoặc chạy script từ repo ngoài trong đợt này.

## Kiểm chứng thực tế

| Kiểm tra | Kết quả |
|---|---|
| `npm test` | 71/71 đạt, không fail/skip/cancel |
| `npm run typecheck` | Đạt |
| `npm run build` | Main/preload/renderer đạt |
| `npm run format:check` | Đạt |
| `npm run test:native` | Electron SQLite/safeStorage đạt; failure/metrics giữ sau cancel/reopen, key tổng hợp không lộ plaintext |
| Sau sửa nhỏ cuối ở error adapter | 20/20 test execution/runtime/team, typecheck/build/format đạt |
| `git diff --check` | Đạt |

Repo không có script lint; không thêm công cụ chỉ để tạo lệnh lint.

Chín test mới trong `tests/execution.test.ts` kiểm tra taxonomy/redaction; proxy 401/429/503 và model pin; quota đồng thời; usage/session/dedup/task attribution/persistence/legacy UI; permission denial; proxy thật nối `Controller.step` với runtime mock; budget/model chặn schema repair và task sau; lock khi close chưa xác nhận; reopen interrupted không replay.

Các ca HTTP dùng server loopback thật, request upstream được đếm trực tiếp. Ca Controller dùng runtime mock, không spawn OpenCode/model. Native test dùng Electron thật cho storage và cancel/reopen. Hai lỗi kiểm tra lúc phát triển đã sửa: type inference review metadata; expectation proxy cũ cho phép request sau lỗi terminal. Không nới policy để làm test đạt.

**Không gọi model thật, không nghiệm thu crash/kill cây tiến trình thật và không đo tốc độ/cost trong AU-4A.** Không dùng các ca mock để tuyên bố ownership/recovery mới đã hoàn thành.

## File thay đổi

Tính từ `apps/windows-worker/`:

- Mới: `shared/execution.ts`, `electron/runtime/failure.ts`, `electron/runtime/metrics.ts`, `src/features/ExecutionFacts.tsx`, `tests/execution.test.ts`.
- Controller/runtime/proxy: `electron/controller/runs.ts`, `electron/gateway/model-proxy.ts`, `electron/runtime/opencode.ts`, `electron/runtime/stopped.ts`.
- Team/storage/contracts: `electron/team/coordinator.ts`, `electron/storage/database.ts`, `shared/runs.ts`, `shared/team.ts`.
- UI/regression/docs: `src/features/RunPanel.tsx`, `tests/runtime.test.ts`, `tests/native-storage.cjs`, `README.md`.
- Ngoài app: báo cáo này và `plan/agent-upgrade/{README,implementation-plan,current-state}.md`.

## Còn lại và rollback

Tiếp theo: lifecycle WW-4D liên quan, rồi **AU-4B ownership/process/crash recovery**, sau đó AU-5 acceptance có model thật và so sánh cùng fixture. Preview, retention/export và installer WW-5 vẫn chưa hoàn thành. Không thêm daemon, process manager hoặc tự resume session trong AU-4A.

Rollback bằng revert commit AU-4A hoặc checkout checkpoint trên branch riêng. Không có migration/downgrade DB; giữ database và history. Bản cũ có thể bỏ qua field optional mới, nhưng không cung cấp nhãn/metrics mới hoặc latch lỗi này. Chạy lại acceptance recovery khi triển khai AU-4B; không nhận lại process chỉ dựa vào PID.
