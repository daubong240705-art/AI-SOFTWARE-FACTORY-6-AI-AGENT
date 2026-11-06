# Phase 3 — Dashboard sử dụng được

Phạm vi V0-P3-01…07 của [lộ trình hiện hành](archive/plan/lo-trinh-code-v0.md), ngày 04/11/2026 (Asia/Saigon).

## Hành vi đã triển khai

- Đăng nhập bằng username/password, không tài khoản mặc định/đăng ký công khai. Password scrypt, session token ngẫu nhiên; DB chỉ giữ hash token, thời hạn và user ID. Cookie HttpOnly/SameSite=Lax, Secure bắt buộc trong staging/production. CSRF và Origin allowlist áp dụng cho thao tác ghi; rate limit login qua Redis.
- Viewer chỉ đọc. Approver tạo project/run và phê duyệt/reject/retry/cancel. Admin thêm quản lý tài khoản, đổi quyền/khóa thu hồi phiên. Chặn tự khóa/hạ quyền admin hiện tại; kiểm tra lại quyền sau khóa giao dịch cho các cập nhật admin đồng thời. Bootstrap CLI hỏi mật khẩu hoặc đọc secure stdin, không lưu secret trong repo/argument.
- Project list/phân trang/tạo/chi tiết, config nhập tay gồm tên, mã, mô tả, repository URL không credential. Run list/phân trang, tạo bằng requirement và mock/live, trạng thái và lỗi thật.
- Sáu card Agent theo task/version hiện tại; bốn role chưa thực thi hiển thị “Chưa triển khai”. Mô phỏng hiển thị rõ trên run/artifact/task/event. Không có kết quả code/test/deploy giả.
- Đọc plan/spec tất cả phiên bản, SHA-256; approve/reject yêu cầu comment và xác nhận version/hash. Backend lấy actor từ phiên, lưu FK user và `authenticated_session`; idempotency gắn cả danh tính. Quyết định Phase 2 giữ nhãn `legacy_unverified_dev`.
- Timeline lấy từ PostgreSQL, SSE cursor/Last-Event-ID, reconnect/khử trùng ID, online/offline và poll dự phòng 10 giây. SSE dùng kết nối DB ngắn từng lượt, kiểm tra hết hạn/thu hồi phiên khi đang mở stream. Next proxy stream body và cookie, path allowlist, không lộ model/API key.
- Usage/call limit/token budget, input/output khi có, latency/model/error của từng call; thời gian tạo → cập nhật (gồm chờ gate), task hoàn thành/tổng task. Không tự tính tiền khi chưa có bảng giá.

## Kiểm chứng

Ruff, mypy strict, frontend lint/typecheck/build; migration `0003_auth`, `alembic check` không drift. Backend **31 tests** với PostgreSQL/Redis thật, bao gồm các bài workflow Phase 2 dùng phiên đăng nhập thật, không bypass auth production. Bộ mới kiểm tra CSRF, Origin, login sai, hash token, logout/expiry, rate limit, viewer không được thao tác, approver duyệt bằng danh tính thật, chống trường actor giả, khóa/đổi quyền thu hồi phiên và SSE reader từ chối phiên bị thu hồi.

Stack disposable `asf-phase3-check` trong `/home/lazy/asf-phase3-dev` trên `.60`. PostgreSQL/Redis/API/dashboard chỉ publish loopback `54333/56383/18003/13003`. Không triển khai `.14`. Các stack Phase 1/2 không được recreate hoặc xóa volume. Credential bootstrap và browser storage state lưu tạm ngoài repo trên máy người vận hành.

Kiểm chứng browser dùng Chromium headless riêng, không dùng profile cá nhân: đăng nhập, tạo project/run, chờ PM/BA mock, đọc plan/spec, refresh, reject v1 → retry v2 → approve có xác nhận → waiting_integration; admin tạo viewer, viewer không có nút ghi và API trả 403. Ảnh desktop/mobile được kiểm tra trực tiếp; không tràn ngang ở 1440px và 390px. Kịch bản tái chạy: [tests/dashboard-smoke.cjs](../tests/dashboard-smoke.cjs).

Chi tiết kết quả runtime/reconnect/restart được ghi tại [phase-3-evidence.json](phase-3-evidence.json). Không commit password, cookie hay private browser state.

Ảnh đã kiểm tra: đăng nhập (`phase-3-screenshots/login.png`, ảnh local), run sau restart (`phase-3-screenshots/after-restart.png`, ảnh local), mobile (`phase-3-screenshots/mobile.png`, ảnh local).

Migration cũng đã nâng 0002 → 0003 → hạ 0002 → nâng 0003 trên DB disposable khác, giữ project/approval cũ và gán đúng nguồn danh tính legacy. Toàn stack đã `down`/`up` không xóa volume; browser dùng cookie trước restart vẫn đăng nhập, còn bốn artifact v1/v2, hai quyết định, 13 event và timeline replay đầy đủ. Kiểm chứng restart có thể chạy lại bằng `tests/dashboard-restart.cjs` sau smoke và restart stack.

## Giới hạn và bước tiếp

Đây là dashboard nền tảng; BE/FE/TEST/DEVOPS và tích hợp ghi GitLab/OpenProject tiếp tục ở Phase 5. Phase 3 dùng mock cho acceptance và không gọi thêm model thật; chứng cứ gateway thật thuộc Phase 2. Template/Mini Helpdesk/bộ e2e đầy đủ ở Phase 6. Chưa triển khai HTTPS/Caddy, pipeline, backup/rollback hay nghiệm thu truy cập LAN/NetBird — đó là Phase 4.

Quyền hiện tại áp dụng toàn workspace, chưa có phân quyền theo project, SSO/MFA hoặc đổi/reset mật khẩu qua UI. Khôi phục bằng admin mới qua CLI vận hành rồi khóa tài khoản cũ; không sửa trực tiếp hash thủ công. Timeline tải toàn lịch sử từng trang 100 và giữ trong bộ nhớ; thích hợp MVP, chưa tối ưu hàng triệu event. Login peer limit tổng hợp phía sau proxy cần tinh chỉnh khi mở rộng nhiều người dùng.

Để xem stack kiểm chứng từ máy cá nhân, mở tunnel `ssh -N -L 13003:127.0.0.1:13003 lazy@192.168.1.60`, rồi truy cập `http://127.0.0.1:13003`. Dùng tài khoản bootstrap do người vận hành giữ ngoài repo; nếu mất có thể tạo admin tên mới qua CLI trên đúng stack. Không mở port DB/Redis ra LAN.
