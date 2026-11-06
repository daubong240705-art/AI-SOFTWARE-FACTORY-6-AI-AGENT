# UX-07 — Git local và diff hiện tại

Ngày: 05/11/2026. Baseline `3334c60` (UX-06), checkpoint `checkpoint/ux07-start-20261105`. Worker giữ `1.3.0-alpha.8`; **không migration SQLite**.

## Đã triển khai

- Menu **Khác → Git** mở khi người dùng yêu cầu; không chạy probe/poller khi chưa vào trang. Snapshot hiển thị branch hoặc detached HEAD, short HEAD, số file thay đổi, staged/unstaged status, lịch sử commit và thời điểm đọc.
- File thay đổi được giới hạn 200 mục; lịch sử mỗi trang 50 commit, cursor bằng offset + HEAD đã ghim. Payload giới hạn, không đọc toàn bộ diff/lịch sử. HEAD đổi giữa các lần đọc bị từ chối và yêu cầu cập nhật.
- Diff **HEAD → Index (Staged)** và **Index → Working tree (Unstaged)** chỉ đọc. Hỗ trợ file thêm/sửa/xóa/Unicode/nhị phân; file lớn hoặc binary hiển thị lý do thay vì tải nội dung. Không có nút commit, push, checkout, reset, stage hoặc sửa source.
- Đường dẫn được canonicalize, giới hạn trong project Git, chặn traversal/symlink/file đặc biệt. Git chạy native qua `execFile`, không shell; tắt pager, hook, fsmonitor, optional locks, replace objects, lazy fetch và terminal prompt. Configured filter/LFS bị từ chối trước khi đọc working tree. Không chạy textconv/external diff.
- Commit có subject chứa mã `W-xxxx` được nối tới BoardItem đúng project. Bấm mã mở hồ sơ công việc; không đổi trạng thái hoặc tự gửi Lead. Nếu project nằm trong monorepo, lịch sử/status chỉ chiếu phần thư mục project.
- UI giữ thanh điều hướng gọn, hai tab Thay đổi/Lịch sử commit, diff cuộn riêng và wrap subject/file dài. Đã kiểm tra 1366×768, 850×700, zoom 125%/150%.

## Kiểm chứng

- Typecheck, Prettier và build đạt; cảnh báo annotation Zod là cảnh báo tồn tại từ trước.
- Toàn bộ suite **206/206 đạt**.
- `git-browser.test.ts`: repository con/monorepo, branch/detached/unborn, 52 commit phân trang, 205 file thay đổi bị giới hạn, staged/unstaged/delete/rename/binary/Unicode, secret redaction, HEAD đổi giữa các trang, bảo toàn index/source, traversal, filter và non-Git.
- Electron native SQLite/Windows secure storage đạt.
- `git-ui`: Electron/main/preload/SQLite thật với Git fixture cô lập; mở Git lazy, xem hai loại diff, liên kết `W-0001`, đổi project sang non-Git, 4 layout/zoom, không gọi provider/startRun/sendChat. Renderer errors: 0.
- Chụp ảnh/DB/log chỉ trong `.cache` đã ignore.

Chạy lại:

```powershell
npm run typecheck
npm run format:check
npx tsx --test tests/git-browser.test.ts
npm test
npm run test:native
npm run build
node scripts/run-acceptance.cjs git-ui
```

## Giới hạn

Đây là lớp đọc Git local, không đồng bộ remote, PR/issue, commit/push hoặc giải quyết conflict. Git filter/LFS và repository quá lớn cần xử lý bên ngoài. Lịch sử chỉ liên kết mã công việc xuất hiện trong subject commit; không sửa commit để thêm mã. Diff hiện tại không lưu snapshot bền, nên file thay đổi giữa hai lần đọc phải cập nhật lại. Ảnh inline/Mermaid và UX-08 lịch/quy tắc chưa triển khai.
