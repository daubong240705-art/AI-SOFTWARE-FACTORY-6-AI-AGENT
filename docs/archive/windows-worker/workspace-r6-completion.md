# R6 — Lịch công việc

Ngày 05/11/2026. Baseline `a9a5a07`, checkpoint `checkpoint/r6-start-20261105`. Worker `1.3.0-alpha.8`, SQLite15 giữ nguyên. Hoàn thành U8-03–05 trên contract/storage U8-01–02; không thêm dependency, orchestrator hoặc dịch vụ Windows.

## Cách dùng

1. Chọn dự án → **Khác → Lịch → Tạo lịch**.
2. Nhập tên lịch và công việc, nội dung, tiêu chí. Chọn hằng ngày theo các ngày trong tuần, giờ và múi giờ IANA (mặc định `Asia/Ho_Chi_Minh`), hoặc một lần theo UTC được ghi rõ trên trường nhập.
3. Bấm **Xem trước** để xem thẻ sẽ tạo và tối đa năm thời điểm tới. UTC nằm trong chi tiết; preview không ghi thẻ/lịch hay gọi model. Đổi trường nhập làm preview hết hiệu lực.
4. **Lưu · mặc định tắt**, rồi **Xem trước & bật → Xem trước → Bật lịch**. Sửa lịch đang bật cũng cần preview mới. Ticket main một lần, hết hạn sau năm phút, gắn với nội dung/project/id/version; kiểm tra lại version và thời điểm khi ghi.
5. Danh sách hiển thị trạng thái, lần tới và kết quả gần nhất. **Lịch sử** tải theo yêu cầu, mỗi trang 50 biên nhận, **Mở công việc** đưa vào đúng hồ sơ. Tắt lịch không xóa lịch sử.
6. **Tạm dừng tất cả / Tiếp tục tất cả** áp dụng mọi dự án, lưu qua restart. Lịch không chạy khi app đóng hoặc máy ngủ. Khi mở app/máy thức dậy, mốc trễ tối đa năm phút được tạo một thẻ; quá năm phút ghi một biên nhận bỏ lỡ rồi chuyển tới tương lai, không chạy bù hàng loạt.

Lịch chỉ tạo backlog; không tự đưa thẻ vào hàng chờ agent, không shell/model/webhook. Giao việc dùng luồng hiện có.

## Runtime và dữ liệu

- Một timer main mỗi 30 giây, tick ngay khi khởi động và `powerMonitor.resume`. Chống reentrant, tối đa 10 lịch/tick theo index, nhường event loop giữa các lịch. Gỡ timer/listener trước đóng Store; pending tick thấy stopped trước khi dùng Store tiếp.
- Delivery giữ transaction IMMEDIATE của BoardStore: thẻ/revision/counter/receipt/cursor cùng commit hoặc rollback. Khóa occurrence unique; đồng hồ lùi không replay kết quả đã ghi.
- Lỗi tạo thẻ rollback rồi ghi receipt `failed` và tắt riêng lịch trong transaction khác, đối chiếu lại version/next_at trước ghi. Lý do cố định không lưu raw SQL/credential. Nếu không thể ghi failure hoặc đọc/ghi storage, service giữ cảnh báo và ngừng tick; cố lưu pause toàn cục. Bấm Tiếp tục sau khi sửa dung lượng/quyền dữ liệu để kiểm tra lại.
- Giữ quota 20 lịch/project, 100 toàn app. Quota receipt 1.000/lịch, 10.000 toàn app; chặn delivery/toggle sớm ở 999/9.900 để dành chỗ ghi failure. Không cho bật lại khi quota vẫn đầy.
- Retention chỉ xóa receipt có `observed_at` hơn 90 ngày và cursor đã đi qua due_at (hoặc lịch đã tắt). Không xóa thẻ, revision, run hoặc source. History phân trang bằng rowid để không mất mục có cùng due_at sau chỉnh đồng hồ/bật lại.
- IPC qua sender/frame guard hiện có; main validate project/ref/version và allowlist action. Preview ticket trong bộ nhớ, tối đa 100, không khôi phục sau restart.

## Kiểm chứng thực tế

| Kiểm tra | Kết quả |
|---|---|
| `npm test` | **260/260 đạt**, thêm bốn test service |
| `typecheck`, `format:check`, `build`, `git diff --check` | Đạt; warning annotation Zod baseline |
| `test:native` | Đạt, SQLite Electron và Windows secure storage |
| `schedules-ui` | **5 cấu hình**: 1366×768, 850×700, 620×700, zoom 125%/150%; không overflow/lỗi renderer |
| `workspace-shell-ui`, `work-items-ui`, `chat-host-ui` | **12 cấu hình hồi quy**, đều đạt |

Test service dùng SQLite thật và clock inject: preview sửa/hết hạn/sai version, 10 lịch mỗi tick, không chạy chồng, restart/pause/clock jump, delivery thất bại, lỗi lưu failure, quota/retention, lịch sử cùng due_at. Tests storage/thư viện tiếp tục kiểm transaction/migration/reopen, quota dự án, DST gap/fold, offset múi giờ và once.

Acceptance dùng production main/preload/renderer, DB/source riêng, clock main kiểm soát và sự kiện resume: tạo/preview/bật, preview hết hiệu lực khi sửa, daily delivery dedup, pause/missed/unpause, lịch sử mở đúng thẻ, conflict tải lại, múi giờ sai, custom dropdown chọn once, once tự tắt sau một thẻ, focus/Tab/Escape. Không run, hàng chờ hay provider call. Đã xem ảnh editor zoom150%; không chồng chữ hoặc tràn ngang.

Log `.cache/r6-{tests,build,ui,shell,board,chat}.log`; ảnh/SQLite fixture cuối `apps/windows-worker/.cache/schedules-ui-RYluTp/`. Bổ sung kiểm tra ticket hết hiệu lực khi mốc đầu trong preview đã qua; sáu test tập trung service/runner, typecheck, build và schedules-ui vẫn đạt sau thay đổi cuối. Không đưa cache vào Git. Chạy lại sau build: `node scripts/run-acceptance.cjs schedules-ui`.

## Giới hạn

- Không background service/catch-up khi app đóng. UTC cho lịch một lần được ghi rõ; chưa có bộ chuyển ngày giờ một lần theo timezone tùy chọn.
- Danh sách làm mới mỗi 30 giây khi trang mở; lịch sử tải khi bấm, không stream toàn bộ receipt.
- Chưa xóa lịch, export riêng, rule theo event hoặc tự thực thi; ngoài R6. Tắt lịch để giữ liên kết.
- Không nghiệm thu model thật vì R6 không dùng model. Stable/benchmark R7, WW-5 và 3D còn lại.

Đóng Worker cũ, chạy `npm start` trong `apps/windows-worker`. Không reset DB hay cấu hình lại gateway. Rollback source dừng timer/UI, giữ lịch và receipt trong schema15; không tự downgrade hoặc xóa dữ liệu. Không dùng DB/settings/key người dùng trong acceptance.
