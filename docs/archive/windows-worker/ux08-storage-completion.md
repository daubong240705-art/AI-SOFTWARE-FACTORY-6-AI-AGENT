# UX-08 — Nền tảng và storage lịch

Ngày: 2026-11-05. Tiếp nối Mermaid `06dfe2d`, contract U8-01 `1963546`; checkpoint `checkpoint/ux08-start-20261105`. Worker giữ `1.3.0-alpha.8`; SQLite **14**. [Thiết kế/phần còn lại](../plan/experience-loops/ux08-schedules.md).

## Đã triển khai

- Contract allowlist chỉ tạo công việc backlog, preview năm mốc, lịch một lần/hằng ngày theo timezone/ngày trong tuần. Giờ DST không tồn tại bỏ qua; giờ lặp lấy lần đầu. Grace năm phút, bỏ lỡ gộp một receipt và chuyển tới tương lai.
- Store nội bộ tạo/sửa/bật/tắt, optimistic version và project scope, tối đa 20 lịch/project, 100 toàn app. Lịch mới disabled. Bật lại tính từ hiện tại; lịch một lần quá hạn không bật được. Pause toàn cục lưu bền.
- Transaction IMMEDIATE gồm `BoardStore.create` + receipt unique + cursor/version. Lỗi bất kỳ bước nào rollback thẻ, revision, mã số và cursor. Không tạo run hoặc follow-up. Receipt giữ config/version snapshot và có trigger chống update; history đọc tối đa 50 bản gần nhất.
- Migration 13→14 tạo backup `worker.schema13.pre-schedules.backup.sqlite` trước khi thêm bảng/index/trigger. Project còn lịch được giữ để bảo toàn lịch sử. Các fixture downgrade schema cũ được cập nhật để kiểm tra migration thực sự từ cấu trúc cũ.
- Sửa race phát hiện khi chạy hồi quy: `recoverOwnedJobs` chấp nhận ENOENT khi host vừa xóa metadata sau readdir hoặc trước unlink; lỗi parse/permission và kiểm chứng ownership vẫn giữ. Commit riêng `27b7e67`.

## Kiểm chứng

- 11 test mới về preview/timezone/DST/grace/schema, lưu/reopen/scope/version, rollback sau khi tạo thẻ nhưng ghi receipt thất bại, không tạo trùng, pause/missed, một lần, quota và backup migration.
- Nhóm Board/process sau sửa đã đạt 15/15.
- Typecheck, format, build và Electron native SQLite đã đạt; log build trong `.cache/ux08-storage-build-final.log`.
- Bộ hồi quy cuối **227/227 đạt**, không skip/fail; `.cache/ux08-storage-tests-final.log` dưới `apps/windows-worker`. Hai lỗi ở lần chạy trước (fixture downgrade thiếu bảng lịch và race ENOENT) đã sửa rồi kiểm tra lại thành công.

## Chưa tích hợp

Chưa có timer, IPC hoặc trang Lịch; không tự tạo thẻ trong ứng dụng hiện tại. Chỉ store nội bộ/test gọi delivery. U8-03 cần ghi failed và tắt lịch khi lỗi, giới hạn history/retention, query due có limit, timer/resume/quit. U8-04 cần preview token/version, IPC, cursor pagination và UI. Chưa chạy model, không đổi credentials/settings/source người dùng. Không nâng thành bản stable.

Backup rollback cần app tương thích schema 13 và phục hồi có chủ đích sau khi đóng app; không mở binary cũ trên DB 14. Ảnh/log/test data ở cache local, không commit.

## File chính

`shared/schedules.ts`, `electron/storage/schedules.ts`, `schedules-migration.ts`, `database.ts`, `tests/schedules.test.ts`, `schedule-storage.test.ts`, các fixture migration cũ, README và kế hoạch. Sửa runtime ownership ở commit riêng như trên.
