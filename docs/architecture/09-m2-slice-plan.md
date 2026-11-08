# 09 · Kế hoạch lát cắt M2 (MVP dùng hằng ngày)

Nguồn: [06 §M2](06-implementation-roadmap.md), [07 §8 MVP-lite](07-architecture-review.md), [00 §3E–3F](00-decision-register.md). Quyết định người dùng 07/11/2026: **bỏ qua dùng thử M1, bắt đầu M2**; JDK 21 đã có trong WSL; **sao lưu do tôi quyết định** (mục S1).

## Nguyên tắc

- Mỗi lát cắt: đặc tả → giao Codex qua Skill `codex-routing` → tôi review mã, chạy đột biến, chạy test Windows và Linux → commit. Lát cắt gắn cờ rủi ro (bảo mật, secrets, effect bên ngoài) cần người dùng phê duyệt riêng cho lần gọi Critical.
- Mọi thứ chạm vào hệ thống file Linux, git và tiến trình chỉ chạy thật trong WSL (ext4). Test cần thật hóa chạy bằng `scripts/factory-v2/test-host-wsl.sh`.
- Agent không bao giờ thấy key 9Router (AP-R1, AP-11); chỉ dùng token tạm của model proxy.
- Không replay: attempt bị gián đoạn thành `unknown` → `reconciling`, không tự chạy lại prompt (W-xx, ATTEMPT_TRANSITIONS).

## Tiến độ (cập nhật 08/11/2026)

| # | Trạng thái | Commit | Ghi chú kiểm chứng |
|---|---|---|---|
| S1 | Xong | 5e1373e | Sao lưu mỗi giờ + khi tắt, khôi phục, diễn tập |
| S2a–c | Xong | 3250cab, 16f75da, f22500c | Dispatcher, lease/fencing, lệnh điều phối; không replay |
| S3a–c | Xong | c1a0130, 27a08f2, 575fd7b | Process group, clone/worktree/evidence/patch; chạy thật trên bản sao BTL-LTM, repo gốc không đổi |
| S4 | Xong | 3960357 | Model proxy: token tạm, model được duyệt, ngân sách trước request; key không rời Host |
| S5a | Xong | 1d7ea76 | Sandbox bubblewrap thật (mạng chỉ còn relay tới proxy); 26/26 đột biến cô lập bị bắt |
| S5b | Xong | b19f502 | OpenCode 1.19.5 thật trong sandbox thật; chuỗi đầy đủ qua `main.js` với upstream giả |
| S6a | Xong | 27aafe3 | Kho nội dung theo hash + Artifact Version cho patch/summary |
| S6b | Xong | 05a28f7 | Review approval, `approvals.decide` áp dụng đúng một lần, Inbox, hết hạn |
| S6c-1 | Xong | 6c72acf | MCP `task.progress`, `output.register` trên listener proxy (OpenCode thật gọi được) |
| S6c-2 | Xong | b82f6d9 | `decision.request` → câu hỏi → attempt `parked` → trả lời → attempt mới có quyết định trong handoff |
| S6d | Xong | 3ebc58b | Effect `git.push-branch`: chỉ remote do bạn khai báo, ghi trước khi push, không force, `unknown` chỉ giải quyết bằng reconcile; 10 test git thật. (Hai lượt Codex đầu thất bại do 9Router 502, chạy lại được bạn duyệt)
| S7 | Xong | 485c475, 29f49f8 | Board, chi tiết Task (tiến độ, kết quả, diff an toàn), Bắt đầu/Dừng/Thử lại, Inbox + hộp thoại quyết định, push, nhập Project git. "Áp dụng patch" vào repo gốc chưa làm: dùng Download .patch + `git apply` (cần quyết định riêng vì là tác động lên repo của bạn) |
| S8 | Gần xong | (commit kế tiếp) | `npm run e2e:work`: 7 test Playwright trên Host THẬT trong WSL (OpenCode thật + sandbox + git + push, model giả) đều đạt; hướng dẫn thử BTL-LTM trong runbook. CHƯA làm: chạy với model thật (cần bạn chọn model và ngân sách) |

Số kiểm thử Host tại b82f6d9: Windows 2418 đạt (140 bỏ qua vì chỉ chạy Linux), Linux 2598 đạt; 0 lỗi. Các giới hạn đã biết: sandbox chưa có hạn mức CPU/số tiến trình/đĩa và chưa có seccomp; chi phí luôn "unknown" (chưa có bảng giá); PD-5 (tự chuyển model khi tốn kém) chưa làm; phiên đăng nhập chỉ trong bộ nhớ.

## Lát cắt

| # | Lát cắt | Nội dung | Rủi ro / ghi chú |
|---|---|---|---|
| S1 | **Sao lưu và diễn tập khôi phục** (AP-R5) | Sao lưu mỗi giờ và khi tắt bằng `VACUUM INTO`, kiểm `integrity_check`, giữ 48 bản giờ + 14 bản ngày, tên có dấu thời gian; script khôi phục; diễn tập khôi phục là test | Mặc định thư mục `/mnt/d/factory-backup` (D: của người dùng); không bao giờ ghi vào thư mục state |
| S2 | **Dispatch lõi** | Node cục bộ trong tiến trình, hàng đợi, attempt theo `ATTEMPT_TRANSITIONS`, lease cục bộ, một attempt sống mỗi Task, slot mỗi Seat, nhiều Project song song, cổng "Bắt đầu" (AP-R12), chuyển Task `ready → awaiting-go → active → in-review → done/failed`, khôi phục sau tắt Host (không replay) | Dùng Fake Runtime trước, nên test xác định và không tốn token |
| S3 | **Workspace và exec** | Clone Project vào ext4, git worktree riêng mỗi attempt, snapshot/checkpoint, diff, bằng chứng lệnh, patch; chạy tiến trình theo process group và dừng thật sự | Chỉ Linux; repo gốc không đổi tới khi người dùng áp dụng patch |
| S4 | **Model proxy** | Proxy OpenAI-compatible cục bộ cho agent: token tạm theo attempt, ép model đã duyệt, kiểm ngân sách trước mỗi request, ghi usage; key chỉ nằm ở Host | Critical (secrets) |
| S5 | **Runtime OpenCode native và cô lập** | Adapter `opencode run` (1.19.5) dưới `RuntimeAdapter`, sandbox bằng bubblewrap (workspace là thư mục ghi duy nhất, không thấy state/config/key), endpoint MCP có token tạm cho `output.register`, `task.progress`, `decision.request` | Critical (bảo mật, thực thi). User Linux `factory-agent` dùng nếu người dùng cấu hình sudoers; mặc định bubblewrap |
| S6 | **Kết quả, Approval, Inbox, Effect** | Artifact Version theo hash (kho nội dung), câu hỏi nghiệp vụ (`decision.request` → Approval → `approvals.decide` → Task tiếp tục bằng Session mới kèm handoff), nghiệm thu human-final, Inbox, Effect `git.push-branch` có Effect Record và danh sách remote cho phép | Critical (effect bên ngoài). **Không bao giờ push tới remote không do người dùng chỉ định** (ví dụ `origin` của BTL-LTM thuộc người khác) |
| S7 | **UI** | Board, hồ sơ Task (Yêu cầu / Trao đổi / Tiến độ / Kết quả với diff và bằng chứng), Kết quả, Inbox "Cần xử lý", Bắt đầu / Dừng có xác nhận, áp dụng patch | Theo thiết kế `design/factory-v2` |
| S8 | **E2E và chạy thật** | Playwright luồng chính với Fake Runtime; chạy thật OpenCode trên repo thử; chuẩn bị thử với `E:\GIT\BTL-LTM` | Ngân sách nhỏ, có xác nhận trước khi tốn token |

## Điều kiện nghiệm thu M2 (từ 06)

Checklist parity 06 §5.2 đạt; người dùng làm ít nhất một việc thật đầu-cuối mỗi ngày trong 5 ngày liên tiếp mà không phải quay lại V1 cho luồng đó; không mất dữ liệu. Phần "5 ngày" do người dùng thực hiện sau S8 (AP-5).
