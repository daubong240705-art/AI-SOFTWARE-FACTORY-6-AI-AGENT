# UX-06 — Mẫu công việc, môi trường, Team và hộp thư

Ngày: 05/11/2026. Baseline `1ea657b`, checkpoint `checkpoint/ux06-start-20261105`. Worker giữ `1.3.0-alpha.8`; SQLite **11 → 12**. Thay đổi source và build local, chưa phát hành bộ cài/stable.

## Đã triển khai

- **Công việc → Thêm việc → Mẫu công việc**: Tính năng, Sửa lỗi, Review và Tài liệu. Chọn mẫu điền yêu cầu/tiêu chí; không tạo run, gọi model hoặc chạy lệnh. Tiêu đề/role/ưu tiên giữ nguyên. Có thể đổi mẫu khi chưa sửa nội dung; sau khi sửa, selector khóa để bảo vệ bản nháp. Metadata work type/skill tham chiếu catalog đóng gói; mẫu không ép chọn skill hay thay policy, model/settings. Lead tiếp tục lập kế hoạch bằng cơ chế hiện có. Review chỉ đọc là chỉ dẫn trong yêu cầu, không thêm chế độ sandbox mới.
- **Tổng quan → Môi trường** thu gọn mặc định. Khi mở mới kiểm tra thư mục, URL gateway, model Lead, OpenCode native đúng phiên bản, khả năng đọc CA/key, Git, Node.js/Python và slot hiện tại. Có mức bắt buộc/khuyến nghị, timestamp và Kiểm tra lại. Probe dùng executable native, timeout hiện có, cache tool 30 giây và gộp truy vấn đồng thời. Chế độ hai lane yêu cầu Git sạch/có commit; tuần tự giữ Git là khuyến nghị. Không gọi provider, không đổi credentials hoặc tự cài tool.
- **Đội ngũ** mặc định danh sách, tùy chọn thẻ. Giữ dữ liệu execution/task/model và lý do chờ từ monitor hiện có. Thông tin lần gần nhất thu gọn. Disabled/unconfigured/stale tiếp tục có nhãn riêng; không tạo thêm worker thường trực hoặc poller.
- **Hộp thư** dùng chung nhiều dự án: quyền đang chờ, câu hỏi pending, báo cáo có policy nghiệm thu bắt buộc, lỗi/gián đoạn hiện hành và hàng chờ held. Truy vấn SQL tổng hợp, trả tối đa 50 mục/trang với cursor thời gian + key; không lấy monitor của từng dự án. Có Tất cả/Chưa đọc, đánh dấu đã đọc, cập nhật và xem thêm.
- “Đã đọc” là thao tác riêng: mở mục chỉ điều hướng. Đọc không cấp quyền, trả lời, nghiệm thu, resume queue hoặc đổi trạng thái run. Token băm theo nội dung/trạng thái giúp mục thay đổi trở lại chưa đọc và từ chối thao tác trên bản cũ. Payload permission không truyền trong token. Tombstone giới hạn 10.000. Failure cũ được ẩn khi có attempt mới cùng lineage; câu hỏi/report cũ không áp cho revision mới.
- Điều hướng hộp thư mở đúng project/run/tab Kết quả/hội thoại câu hỏi/hàng chờ. Có thể đọc lịch sử ngay cả khi thư mục source không còn truy cập được. Tiêu đề dài wrap trong container; Team và inbox hỗ trợ cửa sổ hẹp/zoom.

## Dữ liệu

Schema 12 thêm `inbox_seen` cùng index tìm lineage/state của run. Nâng trực tiếp schema 11 tự tạo `worker.schema11.pre-inbox.backup.sqlite` trước migration. Không sửa nội dung yêu cầu, evidence, report hoặc credentials. Fixture migration schema cũ đã bỏ bảng inbox trước khi hạ schema giả lập.

DB người dùng đang mở không bị thao tác trong đợt này. Khi mở build mới, migration chạy tự động. Rollback cần đóng app, giữ bản sao dữ liệu mới, khôi phục backup schema 11 và dùng binary tương thích. Không mở binary cũ trên schema 12.

## Kiểm chứng

- Typecheck, Prettier và build đạt. Build chỉ còn cảnh báo annotation Zod đã có.
- Toàn suite **201/201 đạt**; phần inbox/readiness/overview được chạy lại sau thay đổi cuối.
- Native Electron SQLite/Windows secure storage đạt.
- `ux06-ui` đạt với renderer/preload/main/SQLite thật trong dữ liệu cô lập: mẫu tạo bản nháp/thẻ nhưng không chạy agent; readiness lazy; Team 7 role và hai chế độ; đọc/lọc inbox; mở inspector khác project, câu hỏi và queue đúng; không gọi provider/cấp quyền/ghi nghiệm thu.
- Layout đạt 1366×768, 850×700, zoom 125% và 150%; kiểm tra cả scroll container và text dài. Không lỗi renderer. Đã xem ảnh và sửa wrap tiêu đề dài, độ rộng nút Team.
- Hồi quy `overview-ui` đạt 5 layout. Toàn bộ ảnh/DB/log acceptance chỉ nằm trong `.cache` đã ignore, không đưa vào Git.

Chạy lại từ `apps/windows-worker`:

```powershell
npm run typecheck
npm run format:check
npm test
npm run test:native
npm run build
node scripts/run-acceptance.cjs ux06-ui
node scripts/run-acceptance.cjs overview-ui
```

## File chính và giới hạn

- Dữ liệu/IPC: `shared/inbox.ts`, `electron/storage/inbox.ts`, `database.ts`, contracts/channels/main/preload.
- Môi trường/mẫu: `shared/readiness.ts`, `shared/templates.ts`, `electron/workspace/readiness.ts`.
- UI: `GlobalInbox.tsx`, `ProjectReadiness.tsx`, `App.tsx`, `ProjectOverview.tsx`, `AgentMonitor.tsx`, `KanbanBoard.tsx`, `readiness-inbox.css`.
- Kiểm tra: `tests/inbox.test.ts`, `tests/readiness.test.ts`, fixture migration và `scripts/acceptance-ux06-ui.cjs`.

Readiness xác nhận cấu hình local, chưa chứng minh kết nối gateway, quyền model, tính hợp lệ nội dung CA, toolchain riêng của từng repository hoặc clean Git đầy đủ cho mọi cấu hình đặc biệt. Runtime vẫn kiểm tra lại trước khi chạy. Inbox cập nhật khi mở hoặc bấm Cập nhật, chưa có thông báo hệ điều hành, badge toàn cục hoặc chế độ lịch sử các mục đã xử lý. Không thêm project preset, Marketplace, dependency/service hoặc model call. Model/skill của execution cũ giữ snapshot hiện có. 3D và WW-5 tiếp tục tạm dừng.

UX-01–06 đã có vòng làm việc chính. Phần kế tiếp theo kế hoạch là **UX-07 — Git local và nội dung phong phú**, cần tách thành lát cắt Git local trước; ảnh/Mermaid và UX-08 lịch/quy tắc vẫn là phạm vi tùy chọn.
