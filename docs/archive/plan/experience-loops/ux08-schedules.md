# UX-08 — Lịch và quy tắc đơn giản

> Cập nhật 05/11/2026: **U8-01–05 hoàn thành qua R6**, Worker alpha.8/SQLite15. [Bàn giao, cách dùng và kiểm chứng](../../../windows-worker/workspace-r6-completion.md). Các mục “phải bổ sung” bên dưới lưu thiết kế thời điểm U8-02; đã thực hiện ở R6.

Ngày: 2026-11-05. Baseline `06dfe2d`; checkpoint `checkpoint/ux08-start-20261105`. Worker `1.3.0-alpha.8`, SQLite **14** sau U8-02. Giữ Factory Lite + Windows Worker, một Controller và một active run toàn app. 3D, remote PR/issues và WW-5 tiếp tục ngoài phạm vi.

## 1. Phạm vi sản phẩm

Người dùng đặt lịch để tạo công việc vào backlog của project. Preview cho biết nội dung thẻ và năm thời điểm tới theo múi giờ đã chọn. Đến lịch, app tạo thẻ một lần và lưu biên nhận; không tự gửi thẻ cho agent. Thực thi dùng nút và Controller hiện có.

Hai kiểu thời gian: một lần theo UTC, hoặc hằng ngày vào giờ/phút trong các ngày được chọn theo timezone IANA. Chỉ một hành động `create_work_item`; không cron tự do, shell, model/permission override, webhook hoặc chuỗi rule. Tóm tắt bằng model và trigger theo kết quả run để lại sau khi có thiết kế ngân sách/chống vòng lặp.

App đóng hoặc máy ngủ thì lịch không chạy. Lần kiểm tra sau chỉ ghi một biên nhận bỏ lỡ cho mốc cũ nhất và chuyển tới mốc tương lai; không tạo backlog cho từng mốc trong thời gian vắng. Độ trễ tối đa năm phút được coi là đến hạn, quá năm phút là bỏ lỡ. Resume phải kiểm tra ngay theo đồng hồ thực.

## 2. Khảo sát source và điểm tích hợp

- `electron/storage/database.ts`: schema tối đa 13, migration tuần tự. `BoardStore.create` validate project, cấp mã và ghi revision trong transaction, giới hạn 2.000 thẻ/project. Dùng API này cho delivery, không insert thẻ trực tiếp.
- `electron/storage/follow-ups.ts` và `RunController.enqueue/resume/advance`: queue theo hội thoại, settings snapshot và held/restart. Không thêm queue agent. Lát cắt đầu chỉ tạo backlog; tự thực thi sau này phải dùng cùng Controller/admission gate.
- `shared/channels.ts`, `shared/contracts.ts`, `electron/preload.ts`, `electron/main.ts`: đường IPC hiện có. Main validate schema/project/version; renderer chỉ nhận DTO.
- `Store.removeProject`: sau khi thêm lịch phải chặn bỏ project còn lịch hoặc delivery, bảo toàn lịch sử. Không cascade xóa âm thầm.
- `src/App.tsx`: đặt **Lịch** trong phần phụ của project. Dùng select/menu/dialog và token layout hiện có, không thêm nút trên mọi trang.

## 3. Các lát cắt

| Mã | Phạm vi | Trạng thái | Bằng chứng bắt buộc |
|---|---|---|---|
| U8-01 | Contract allowlist, preview, timezone, occurrence/key, missed policy | **Đã triển khai thư viện thuần** | Giờ Việt Nam, offset lẻ, đổi năm, DST gap/fold, grace, không catch-up, từ chối shell/override |
| U8-02 | SQLite create/read/update/toggle/version + delivery nguyên tử với BoardStore | **Đã triển khai storage** | Upgrade schema 13 có backup; rollback/reopen; không tạo trùng; chặn sai project/version |
| U8-03 | Tick main, resume, pause toàn cục, backpressure | **Hoàn thành R6** | Một timer không reentrant; pause/restart/clock jump; không model/shell |
| U8-04 | Danh sách/editor/preview/toggle/history/mở thẻ | **Hoàn thành R6** | Empty/error/conflict; keyboard/narrow/zoom; preview không tạo thẻ, mặc định tắt |
| U8-05 | Kiểm chứng tích hợp và bàn giao | **Hoàn thành R6** | Electron + native SQLite, regression Board/Chat; không dùng dữ liệu thật |

U8-01–02 chưa có màn hình, IPC hoặc timer. Schedule đã lưu được qua store nội bộ; delivery chỉ chạy khi có caller gọi store, chưa tự chạy trong app. Không đánh dấu UX-08 hoàn thành trước U8-05. Xem [bàn giao storage](../../../windows-worker/ux08-storage-completion.md).

## 4. Dữ liệu và transaction cho U8-02

Migration **13 → 14** đã triển khai, backup `worker.schema13.pre-schedules.backup.sqlite` trước upgrade. Cấu trúc đã có:

- `schedules`: UUID, project FK, tên/config JSON đã validate, enabled, version, next_at UTC nullable, timestamps. Tối đa 20 lịch/project và 100 toàn app. Tạo mới disabled; bật/sửa tính mốc **sau hiện tại**, không kích hoạt bù.
- `schedule_deliveries`: occurrence key unique, schedule FK, config/version snapshot, due_at/observed_at UTC, state (`created`, `missed`, `failed`), work_item_id FK nullable, lý do có giới hạn. Biên nhận không sửa lại; thẻ vẫn là BoardItem.
- `schedule_control`: một hàng global pause bền vững. Unpause áp dụng missed policy; không đổi settings/credentials.

Khóa là `scheduleId:version:dueAt`; U8-02 đã có unique constraint và transaction IMMEDIATE, cùng BoardStore/receipt/cursor. Mỗi thay đổi hoặc lần advance tăng version; config/version cũ được giữ trong receipt bất biến.

1. Đọc lịch enabled đến hạn, tính `planScheduleTick`.
2. Trong transaction kiểm tra lại enabled/version/next_at/pause và occurrence key. Có receipt rồi thì không tạo thẻ nữa.
3. `due`: gọi `BoardStore.create`, insert receipt, advance next_at trong cùng transaction. `missed`: chỉ ghi receipt và advance. Lịch một lần kết thúc thì disable.
4. Hiện tại lỗi tạo thẻ/receipt rollback toàn bộ và trả lỗi. **U8-03 phải bổ sung** transaction riêng kiểm tra version/next_at, ghi `failed` và tắt lịch trước khi nối timer; không retry vô hạn. Crash trước commit giữ lịch cũ để thử lại an toàn.
5. **U8-03 phải bổ sung retention/backpressure trước khi bật timer**: mục tiêu 1.000 receipt/lịch, 10.000 toàn app; chỉ prune hơn 90 ngày sau khi cursor đi qua. Bật lại luôn tính mốc tương lai, không replay vì receipt đã prune. Không xóa thẻ/run theo lịch sử lịch.

CRUD yêu cầu projectId + scheduleId + version, scope query theo project và optimistic update trong transaction. V1 dùng bật/tắt/sửa; xóa hẳn để lại sau khi có export/policy.

## 5. Thời gian và tài nguyên cho U8-03

U8-01 dùng `Intl.DateTimeFormat` với timezone lưu rõ. DST gap bỏ qua, DST fold chỉ lấy lần đầu. Tìm tối đa 16 ngày địa phương để vượt tuần có DST gap, giới hạn năm 2000–2100; không thêm dependency cron/timezone.

Một timer main mỗi 30 giây, thêm tick khởi động và `powerMonitor.resume`. Tối đa 10 schedule/tick với query/index enabled+next_at, nhường event loop và chống chồng tick; quit gỡ timer/listener trước đóng Store. Ngân sách model bằng 0, không chiếm active run. Trigger event sau này phải có debounce/causal root/depth/limit trước khi bật.

Đồng hồ lùi không replay receipt cũ; nhảy tới tương lai áp dụng missed policy. Đổi timezone hệ điều hành không đổi lịch đã lưu. Không đăng ký Windows service/task scheduler.

## 6. Giao diện cho U8-04

Danh sách gọn: tên, lịch/timezone, thời điểm tới, toggle, kết quả gần nhất. Header chỉ có `Tạo lịch` và `Tạm dừng tất cả`/`Tiếp tục`. Editor dùng dialog với tên, loại lịch, giờ/ngày/timezone và nội dung công việc. Mặc định `Asia/Ho_Chi_Minh` nhưng luôn hiển thị rõ.

Preview dùng cùng `previewSchedule` trong main; hiển thị giờ địa phương, UTC trong chi tiết. Preview không lưu/gọi model. Lưu tạo lịch disabled; người dùng bật sau khi xem preview. Lưu/bật phải khớp config/version đã preview; đổi field làm preview hết hiệu lực. Không graph editor/dropdown native mới.

History tải theo yêu cầu, phân trang 50 receipt, trạng thái tạo thẻ/bỏ lỡ/lỗi và mở đúng thẻ. Store U8-02 mới trả tối đa 50 receipt gần nhất; cursor pagination bổ sung cùng IPC/UI U8-04. Trang lịch hiển thị điều kiện app đang mở; không lặp mô tả trên chat/card. Tick không tự điều hướng/giật focus.

## 7. Kiểm chứng và bàn giao

U8-01: **5/5 test behavior đạt** qua `npx tsx --test tests/schedules.test.ts`; `npm run typecheck`, `npm run format:check` và `npm run build` đều đạt. Build log local: `apps/windows-worker/.cache/ux08-foundation-build.log`. Chưa đổi UI/DB nên không chạy lại Electron cho thư viện này. Baseline Mermaid trước đó đã đạt 216/216 test, native SQLite và ba lượt Electron Mermaid/ảnh/ChatHost.

U8-02–05: clock inject, SQLite thật cho unique/transaction/reopen/migration/quota. Electron fixture trong `.cache`: tạo lịch → preview → bật → tick → đúng một thẻ → pause → missed sau resume → mở thẻ. Layout 1366×768, 850×700 và zoom 125–150%. Không model cho tính năng không dùng model; ảnh/log cache không commit. Handoff ghi schema, giới hạn và kết quả thực tế.
