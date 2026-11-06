# WW-2 — OpenCode execution

Ngày: 04/11/2026. Phạm vi: một role được chọn trực tiếp, chưa phải Lead điều phối sáu role.

## Chức năng

- Controller lưu run/task/event và snapshot settings trong SQLite schema v2; một active run toàn app, index DB bảo vệ thêm.
- OpenCode **1.19.5**, SDK cùng version: private loopback headless server, session/prompt, SSE, permission reply một lần và abort. Không đoán schema CLI/SDK.
- Model proxy giữ provider key ở main, cấp token execution tạm cho child, pin model/endpoint, giới hạn request vật lý, TLS/CA được xác minh, redirect bị từ chối.
- Run/Stop nối IPC thật. UI poll history/detail, xem hoạt động, quyền công cụ, file thay đổi trước/sau, output/exit code và report. Không render reasoning hoặc HTML từ model.
- Kết quả cuối đối chiếu `session.messages` để không bỏ lỡ tool error khi SSE đến muộn. Lệnh lỗi, phản hồi kết thúc ở tool-calls hoặc thiếu report không bị coi là thành công.
- Stop abort session, chấm dứt cây process theo PID sở hữu; không kill theo tên. Nếu chưa xác nhận dừng, giữ slot khóa thay vì cấp task mới.
- Graceful quit chờ stop; crash được đánh dấu interrupted ở lần mở sau, không tự replay. Quản lý orphan sau crash cưỡng bức và recovery nâng cao vẫn thuộc WW-4.

## Thử thật DeepSeek Flash

Gateway đang có cả các biến thể Flash khác; theo yêu cầu dùng **`ds/deepseek-v4-flash`**, không tự chuyển sang v4.1 hoặc model khác.

Run `b7e5131b-5b36-45a5-9b7d-6d9b23a10c95`, qua chính RunController trong Electron, source là `apps/windows-worker`:

- Model đọc package/test, dùng read/glob/write, tạo đúng `src/lib/formatDuration.ts` và `tests/duration.test.ts`.
- Hàm được nối vào UI Kết quả để hiển thị thời gian run; đây là thay đổi trong sản phẩm, không phải repo mẫu.
- Chỉ cấp shell một lần cho đúng `npm test`, không cấp allow-all.
- 5 request, 6 tool completed; `npm test` exit **0**, 6 test pass tại thời điểm run. Sau khi thêm regression WW-2, suite hiện có 9 test pass.
- Không tạo commit/push bởi agent. Người triển khai review code, nối UI và tạo commit bàn giao sau.
- [Evidence run](ww2-live.json) có state, model/settings snapshot không chứa key, command result, changes và event timeline.

Run Stop `2b927be9-1a75-4ae1-86ca-debbdd312cec`: model gọi đúng `Start-Sleep -Seconds 120`; Stop hoàn tất khoảng **462 ms**, bốn process trong cây runtime kết thúc, survivor **0**, active slot trống. [Evidence Stop](ww2-stop.json). Đây là số đo một lần, không phải SLA.

Lần đầu `cade4b9c-e94f-4c2c-bfaa-95925a0e1767` không đạt: model yêu cầu shell liệt kê, bị từ chối, không tạo file. Đồng thời phát hiện race kết quả SSE làm terminal state quá sớm; đã bổ sung final-message reconciliation và ghi audit correction cho lần thử đầu thành failed. [Ghi nhận lần thử đầu](ww2-initial-attempt.json). Không dùng lượt này làm acceptance.

## Validation và giới hạn

Typecheck, 9 core tests, Electron native storage và production build đạt trên Windows. Live acceptance dùng sản phẩm Controller/SDK trong Electron, không thao tác nút UI. Computer Use không kết nối được native pipe ở phiên này nên chưa xác nhận lại hình ảnh/click luồng WW-2; không coi build là bằng chứng visual acceptance.

Một run completed nghĩa runtime kết thúc có report và không có command error đã ghi nhận; không tự chứng minh mọi AC sản phẩm đạt. UI giữ command evidence để đánh giá. Snapshot source có giới hạn, chưa có line diff. TEST/DEVOPS ở WW-2 vẫn là role chạy trực tiếp, không phải toàn bộ pipeline ASF.

Giữ các VM/ASF production nguyên trạng. Chưa tạo installer hoặc Connected Mode. Dùng `npm start` sau khi đóng cửa sổ WW-1 cũ để nạp bản WW-2.
