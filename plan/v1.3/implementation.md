# V1.3 — Backlog triển khai và nghiệm thu

**V1.3A–C đã triển khai; hiện tại `1.3.0-alpha.3`. D–E chưa triển khai.** [Bàn giao A](../../docs/windows-worker/v1.3a-completion.md), [B](../../docs/windows-worker/v1.3b-completion.md), [C và giới hạn](../../docs/windows-worker/v1.3c-completion.md). Phụ thuộc, phạm vi và baseline: [README](README.md).

## 0. Chuẩn bị trước thay đổi lớn

- Xem `git status`/HEAD, đọc AGENTS áp dụng tại thời điểm code. Giữ nguyên file người dùng đang sửa và roadmap đầu vào chưa tracked.
- Tạo branch triển khai từ HEAD đã thống nhất và checkpoint `checkpoint/v13-start-<date>`; không tự merge nhánh khác hoặc reset source.
- Ghi baseline phiên bản app, schema và bằng chứng V1.2 đang có; không đánh dấu V1.2 stable chỉ vì bắt đầu V1.3.
- Chưa cần VM, external service hoặc API key mới. Model/9Router hiện có dùng cho nghiệm thu các luồng bị ảnh hưởng.

## V1.3A — Trạng thái thật và Agent Monitor

| Mã | Công việc | Phụ thuộc | Kết quả nghiệm thu |
|---|---|---|---|
| A-01 | Chốt identity role/logical task/attempt/execution và DTO/Zod schema | 0 | Hai task cùng role không đè trạng thái nhau; direct run có identity |
| A-02 | Thu activity theo execution lane: request/tool/permission/start/stop/finish | A-01 | Mỗi transition đúng owner, tool finish không làm lane khác idle |
| A-03 | Projection availability/activity/workflow/progress từ state hiện có | A-02 | Không coi task completed là verified; unknown khác idle |
| A-04 | Snapshot có epoch/revision, IPC whitelist, bounded payload, poller dùng chung | A-03 | Không request overlap; bỏ response cũ, project đổi không lẫn dữ liệu |
| A-05 | Agent Monitor 2D, bộ lọc và trạng thái chờ/không cấu hình | A-04 | Nhìn được cả 7 role, số execution thực tế, active run ở project khác |
| A-06 | Migration nền schema mới: metadata nullable, board schema dùng ở B | A-01 | Backup/migrate DB6 giữ nguyên runs/chat/evidence/credentials |

**Kiểm tra tập trung:** pure projection tests cho sequential, isolated-pair khác/cùng role, direct, queued dependency, permission, disabled/unconfigured, stop/interrupted/stale. Kiểm tra replay event trùng/đảo thứ tự và revision khi log chạm cap. Test IPC reject input sai và không trả settings/secret.

**Mốc bàn giao:** người dùng xem ai rảnh/bận đúng bằng bảng 2D; chưa cần 3D hoặc thao tác Kanban. Commit riêng A, cập nhật bằng chứng và giới hạn. Không gắn animation giả để che nguồn trạng thái chưa đủ.

## V1.3B — Kanban và backlog local

**Đã triển khai B-01–07** ở `1.3.0-alpha.2`. Card là yêu cầu cha; task con mở qua kết quả hiện có, inspector mới ở C. Editor dùng dialog native thay drawer, hỗ trợ Escape và focus. [Bằng chứng và giới hạn](../../docs/windows-worker/v1.3b-completion.md).

| Mã | Công việc | Phụ thuộc | Kết quả nghiệm thu |
|---|---|---|---|
| B-01 | Board store CRUD, optimistic version, order, archive, project scoping | A-06 | Restart giữ thứ tự; conflict sửa không ghi đè; archive không xóa run |
| B-02 | Project task projection, gom attempt thành logical card và child tasks | A-03 | Retry/fix không tạo tiến độ gấp đôi; dependency badge rõ |
| B-03 | Sáu cột, filter/search, cards gọn, drawer editor, empty/error/loading | B-01, B-02 | Hiển thị card runtime đúng workflow và backlog đã lưu |
| B-04 | Drag Chưa làm ↔ Sẵn sàng, menu di chuyển bằng bàn phím | B-03 | Runtime card không bị drag đổi lifecycle; focus không mất |
| B-05 | Gửi card tới Lead qua startRun/follow-up; chống double submit và link thật | B-01, A-04 | Click lặp chỉ tạo một link; chờ queue khi đang có run |
| B-06 | Progress task/criteria và lifecycle needs_input/failed/cancelled/review | B-02, B-05 | Done không vượt evidence gate; replan đổi mẫu số đúng |
| B-07 | Retention/project removal/export tương tác với board links | B-01 | Không orphan ngầm hoặc mất backlog khi prune; export có provenance link |

**Kiểm tra tập trung:** DB thật tạm trong workspace cho migration 6→mới; CRUD/version/transaction failure; submit/queue resume idempotency; pruning khi còn link; regression unique active run. UI: card runtime từ chối mutation ngay cả IPC thủ công, backlog được sửa khi run đang chạy, Lead chỉ trả lời chat không tự trở thành Done.

**Mốc bàn giao:** bản Kanban dùng được hằng ngày, theo dõi đầy đủ bằng 2D. Một commit tính năng và bằng chứng B; không cần chạy build ASF gốc.

## V1.3C — Inspector, timeline và Chat gọn

**Đã triển khai C-01–05** ở `1.3.0-alpha.3`: dialog native dùng chung, bốn tab gọn, feed chi tiết chia sẻ giữa các view và task diff immutable. Nghiệm thu model thật và đo hiệu năng tổng thể giữ ở E. [Bằng chứng và giới hạn](../../docs/windows-worker/v1.3c-completion.md).

| Mã | Công việc | Phụ thuộc | Kết quả nghiệm thu |
|---|---|---|---|
| C-01 | Inspector chung: task/model/scope/acceptance/dependency/workspace | A, B | Card và agent mở đúng task/attempt; model đang chạy không đổi khi sửa settings |
| C-02 | Tái sử dụng diff/command/evidence/result có lazy load | C-01 | Xem đúng task source và integration source, không tải output toàn cục |
| C-03 | Timeline ngắn, gộp hoạt động lặp, lọc theo agent/task | A-02, A-06 | Có start/handoff/error/stop/finish; token/step log không tràn feed mặc định |
| C-04 | Chat link sang board/agent/inspector; chia sẻ cache và selection | A-04, C-01 | Không fetch runDetail trùng cùng run; đổi tab giữ hội thoại/draft |
| C-05 | Nút thao tác có capabilities: dừng run, quyền, retry/recovery | C-01 | Gọi Controller hiện có; không có pause hoặc stop-agent giả |

**Kiểm tra tập trung:** selection sai project/run, attempt superseded, sourceVersion đổi làm cache invalid; timeline thiếu legacy metadata có nhãn phù hợp; Full access không bị thêm chấp thuận. Verify stop/recovery không tự replay tool hoặc merge source gốc.

**Mốc bàn giao:** alpha 2D đầy đủ A–C; có thể dùng trong lúc triển khai D. Chưa gọi V1.3 đầy đủ nếu thiếu 3D/fallback.

## V1.3D — Văn phòng 3D

| Mã | Công việc | Phụ thuộc | Kết quả nghiệm thu |
|---|---|---|---|
| D-01 | Chọn/pin Three.js/R3F và kiểm tra license/React19/Electron | A, C | Lockfile rõ; không thêm physics, game engine hoặc backend |
| D-02 | Một phòng, bảy bàn/nhân vật đơn giản, orthographic camera | D-01 | Pan/zoom/reset được; nhãn không bị che, scene đủ nhẹ |
| D-03 | Scene đọc selector từ monitor store; badge activity/multiple executions | D-02, A-05 | Không hardcode cả bảy agent cùng làm việc; không sinh scheduler |
| D-04 | Click/hover chọn task và inspector, highlight đồng bộ Kanban | D-03, C-01 | Role có hai execution cho chọn đúng một; không nhầm workspace |
| D-05 | Animation thấp, reduced motion, chất lượng thấp, lazy mount/unmount | D-03 | Tắt scene không dừng run; hidden scene ngừng frame loop |

**Asset:** ưu tiên hình học tự tạo, material phẳng và cùng một skeleton/avatar đơn giản; chỉ lấy model ngoài sau khi kiểm tra giấy phép đúng gói tải. Ảnh tham khảo trong [design](design.md) không dùng làm texture hoặc asset runtime. Không chạy script từ repo asset.

**Kiểm tra tập trung:** selector/state mapping bằng test pure; Electron UI kiểm tra click/keyboard fallback/resize/context loss. Không pixel-test hoạt ảnh hoặc test bám chi tiết geometry không có giá trị bảo vệ behavior.

**Mốc bàn giao:** 3D có thể dùng để quan sát run thật, không chỉ demo animation. Kèm ảnh app thực tế và số đo, tách rõ ảnh tham khảo với ảnh đã triển khai.

## V1.3E — Hoàn thiện chất lượng và bàn giao

| Mã | Công việc | Phụ thuộc | Kết quả nghiệm thu |
|---|---|---|---|
| E-01 | Low GPU/WebGL fallback, accessibility, resize/minimize/focus | B, C, D | Không 3D vẫn dùng đủ agent/board/inspector bằng bàn phím |
| E-02 | Đo poll/payload/frame/CPU/memory; coalesce/caching khi có nút thắt | E-01 | Có baseline cùng máy và chênh lệch, không cam kết số đo chưa chạy |
| E-03 | Nghiệm thu lifecycle thật bằng 9Router/model cấu hình hiện có | B, C, D | Agent/board/3D đồng bộ với lệnh, diff, stop, review và recovery |
| E-04 | Tổng hợp build/test/UI/migration/perf và chức năng còn thiếu | E-02, E-03 | Checklist có link bằng chứng, không tick theo mock |
| E-05 | Cập nhật hướng dẫn, version và commit bàn giao | E-04 | Có cách chạy dev hiện có, rollback DB, giới hạn rõ |

### Ngân sách hiệu năng mục tiêu, cần đo

- Snapshot ≤ 100 KB cho trang 50 card và 7 role, không gồm output/diff; phân trang hơn khi vượt.
- Độ trễ event đã Controller nhận → view foreground đổi trạng thái p95 ≤ 1 giây trong run local thông thường, không tính thời gian model phản hồi.
- Một poller; tối đa một request snapshot đang bay; số call chi tiết cùng run giảm so với Chat hiện tại.
- Mục tiêu 30 FPS khi có animation trên máy Windows khảo sát; render on-demand khi cảnh yên, tắt frame loop khi tab 3D ẩn/minimize.
- 3D không tăng thời gian cùng workload local quá 10% so với 2D trong phép đo đủ lặp và cùng điều kiện; nếu vượt, mặc định chất lượng thấp/2D và ghi giới hạn. Không dùng thời gian model qua mạng đơn lẻ để kết luận GPU gây chậm.
- Ghi mức RAM/CPU/GPU tăng thêm của renderer sau 10 phút chuyển tab; kiểm tra leak listener/canvas/context. Con số nghiệm thu dựa máy thực tế, chưa có số đo ở giai đoạn plan.

## Ma trận kiểm tra tối thiểu

| Tình huống | Kỳ vọng |
|---|---|
| Chưa cấu hình model; role tắt | Chưa sẵn sàng/Đã tắt, không hiển thị Rảnh |
| Run direct; team tuần tự | Có card và agent đúng role, không rơi mất direct |
| Hai lane độc lập, cả cùng role lẫn khác role | Đúng execution/task/command; finish một lane không đóng lane kia |
| Pending permission/needs_input; Full access | Nêu đúng việc cần làm, giữ policy hiện có |
| Dependency bình thường/lỗi; integration conflict | Chờ rõ nguyên nhân, không báo task đang code khi thực tế chờ |
| Work completed nhưng TEST/Lead chưa verify | Chờ review, verified progress chưa tăng |
| TEST fail → fix tối đa vòng hiện có → review | Attempt liên kết đúng, không đếm trùng hoặc nới gate |
| Stop trong lúc có hai task; retry/recovery | Run/tasks đúng kết quả, không nút dừng riêng giả |
| App đóng bất thường, reopen | Interrupted đúng, backlog giữ nguyên, không tự chạy lại |
| Response đảo thứ tự/project đổi/epoch mới | Không xuất hiện trạng thái cũ hoặc lẫn project |
| Log chạm cap/legacy event/retention | State vẫn đúng, timeline báo giới hạn, bằng chứng không bị xóa ngầm |
| WebGL mất context/tắt 3D/minimize | Run tiếp tục, 2D dùng được, không leak poller/canvas |
| Board double click/drag trái phép/IPC sửa state | Một lần gửi; main từ chối mutation runtime |
| DB6 thật có chat/history/evidence | Migration giữ dữ liệu, backup có thể phục hồi |

## Cách chạy kiểm tra khi code

Chạy test liên quan sau mỗi slice có thay đổi logic. Khi chốt từng đợt, chạy từ `apps/windows-worker/`: `npm run typecheck`, `npm test`, `npm run format:check`, `npm run build`. `npm run test:native` khi chạm database/native/lifecycle hoặc ở nghiệm thu cuối. Hiện package chưa có script lint riêng; không báo “lint pass” thay cho kiểm tra thực tế.

Tối đa ba vòng sửa tự động cho một vấn đề theo yêu cầu đã có. Hết ba vòng còn lỗi: giữ bằng chứng, báo điều còn chặn, không đánh dấu phase hoàn thành hoặc nới assertion/gate để pass.

Không build image/pipeline ứng dụng ASF gốc cho thay đổi desktop đơn thuần. Nếu bổ sung CI desktop, filter path liên quan; các bước build installer/release vẫn theo yêu cầu phát hành riêng.

## Hồ sơ bàn giao cần tạo trong quá trình thực hiện

`docs/windows-worker/v1.3/` sẽ có report từng đợt, checks JSON/log, UI screenshot thật và đo hiệu năng cùng thông số máy. Report phải phân biệt **đã code**, **đã kiểm tra**, **còn thiếu**. Ảnh tham khảo đã tìm ở giai đoạn lập kế hoạch không phải bằng chứng nghiệm thu.
