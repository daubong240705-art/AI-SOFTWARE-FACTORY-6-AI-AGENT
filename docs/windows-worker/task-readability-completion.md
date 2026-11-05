# Mô tả task và căn bố cục

Ngày 05/11/2026. Baseline `05452f5`, checkpoint `563fe20`. Worker `1.3.0-alpha.8`, schema15 giữ nguyên.

## Đã sửa

- Nguyên nhân ảnh gửi: `TaskInspector` in trực tiếp `task.instructions`. Với Review/Lead, trường này chứa cả prompt nội bộ, JSON evidence, nội dung file và bàn giao. Giữ dữ liệu thực thi nguyên vẹn, nhưng màn chính chỉ trình bày tên **Lập kế hoạch / Đánh giá kết quả**, mô tả ngắn, phạm vi và tiêu chí dễ hiểu.
- Metadata model/session/source và prompt/phản hồi gốc nằm trong **Dữ liệu kỹ thuật** mặc định đóng. Chỉ gắn raw text vào DOM khi mở. Chữ dài xuống dòng, khối raw có chiều cao giới hạn; không kéo rộng panel.
- Báo cáo JSON có cấu trúc được đọc thành nội dung chính, vướng mắc và chưa xác minh; kế hoạch thành danh sách phân công. JSON chưa đọc được/thiếu đoạn nằm trong phần kỹ thuật. Markdown và báo cáo văn bản bốn mục vẫn đọc được. Đây chỉ là trình bày báo cáo agent, không thay trạng thái evidence hay xác nhận task thành công.
- Khi đang xem task khác với task lỗi, chỉ hiện một dòng chỉ tới nơi bị chặn; không lặp nguyên card lỗi của cả run trên mọi task. Liên kết Kanban/Đội ngũ/Văn phòng thu gọn; nút header căn theo cùng lề.
- Card vấn đề dùng gap thống nhất. Recovery bỏ padding riêng, căn cùng lề nút chính. Card task có mô tả tối đa hai dòng; nội dung inspector và các khối dùng giới hạn bề rộng, xuống dòng; không có thanh cuộn ngang khi mở prompt dài.

File chính: `shared/task-presentation.ts`, `src/features/TaskReadableContent.tsx`, `TaskInspector.tsx`, `WorkProgress.tsx`, `RunPanel.tsx`, `src/workspace-shell.css`. Kiểm chứng trong `tests/task-presentation.test.ts` và fixture `scripts/acceptance-ux06-ui.cjs`.

## Kiểm chứng

- `npm test`: **254/254 đạt**; thêm hai test cho prompt Lead/Review không lộ ra mô tả, tiêu chí, JSON/partial JSON, Markdown và báo cáo bốn mục. Test phép chiếu cuối vẫn đạt.
- Typecheck/build/Prettier và `git diff --check` đạt. Build còn warning annotation Zod có sẵn.
- `ux06-ui`: fixture Review có hơn32.000 ký tự payload; raw không có trong DOM trước mở kỹ thuật. Kiểm mô tả và báo cáo JSON đọc được, mở raw vẫn không tràn ngang. Năm layout Review (1366×768, 850×700, 620×700, zoom125/150%); bốn layout Tiến độ/Inbox/Team, kiểm tọa độ lề các nút recovery. Không lỗi renderer.
- `work-detail-ui`: 16 layout đạt, luồng quay lại hồ sơ/câu hỏi/nháp giữ nguyên. Fixture riêng, không gọi model hay dùng DB thật; ảnh và log nằm trong `.cache`, không đưa Git.

## Xóa database: chưa thực hiện

Người dùng đã yêu cầu xóa toàn bộ DB. Đã đọc đúng đường dẫn `C:\Users\ADMIN\AppData\Roaming\ASF Windows Worker\worker.sqlite`, schema15, 2project/20run/41task/9conversation/10report, không có run active tại thời điểm khảo sát. Lệnh yêu cầu đóng Worker và xóa SQLite/backup bị cơ chế tự động chặn với thông báo **blocked by policy**, không có lý do cụ thể. Không thực hiện lại bằng cách khác; đã kiểm file DB vẫn tồn tại. Không tuyên bố dữ liệu đã sạch.

Chuẩn bị `apps/windows-worker/scripts/reset-local-data.ps1` để người dùng chủ động reset: script kiểm đường dẫn AppData cố định, từ chối junction/symlink, từ chối khi Worker còn chạy, chỉ xóa file Worker SQLite/WAL/SHM/journal và các backup SQLite cùng thư mục. Không xóa folder runtime/worktree/source. Script chỉ được parse cú pháp, **chưa chạy thao tác xóa**.

Đóng Worker hoàn toàn rồi chạy từ root repo:

```powershell
powershell -NoProfile -File .\apps\windows-worker\scripts\reset-local-data.ps1
```

Sau đó chạy `npm start` trong `apps/windows-worker`; DB mới được app tạo mặc định. Cần thêm lại dự án, cấu hình gateway/model và API key. Source các dự án không nằm trong phạm vi reset. Các snapshot kỹ thuật vẫn được giữ trong lịch sử cho đến khi reset thực sự được người dùng thực hiện.
