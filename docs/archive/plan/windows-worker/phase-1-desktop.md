# WW-1 — Desktop, project và cấu hình

Mục tiêu: có ứng dụng desktop thật, cấu hình bền vững và các màn hình nền để gắn runtime trực tiếp ở phase sau. Không tạo mock workflow báo thành công.

Trạng thái 04/11/2026: **đã triển khai WW-1** trong [apps/windows-worker](../../../../apps/windows-worker/README.md). Typecheck, ba kiểm tra core, kiểm tra Electron native storage và production build đạt; ứng dụng Electron thật đã mở trên Windows, hiển thị workspace/settings/team và đọc dữ liệu qua IPC. Native storage xác nhận SQLite chạy trong Electron, safeStorage mã hóa/giải mã được và key tổng hợp không nằm plaintext trong DB/WAL. Chưa cấu hình gateway thật hoặc gọi model. SQLite 13 dùng Node-API binary, thay yêu cầu rebuild native bằng kiểm tra binary tại postinstall. Chưa đóng gói installer (WW-5).

## Đầu việc

| Mã | Công việc | Điều kiện hoàn thành |
|---|---|---|
| WW1-01 | Tạo `apps/windows-worker`, Electron/React/TS/electron-vite, scripts dev/typecheck/build | Chạy desktop bằng script trong package; tách khỏi Next.js và pipeline ASF |
| WW1-02 | Tạo main/preload/shared DTO và IPC validation | Renderer chỉ gọi API hẹp, không truy cập Node/shell trực tiếp |
| WW1-03 | Dựng app shell theo 9Router | Sidebar, workspace, settings, history; typography gọn, không nội dung trang trí |
| WW1-04 | Folder picker và quản lý project gần đây | Canonical path, tồn tại/quyền truy cập, Git root/status, reopen/remove khỏi danh sách |
| WW1-05 | SQLite và migration đầu tiên | Projects/settings/agent settings lưu trong userData; không ghi vào source người dùng |
| WW1-06 | Cài đặt gateway | URL, API key, CA nội bộ, trạng thái cấu hình; key mã hóa và không trả lại renderer |
| WW1-07 | Catalog model và preset | Fetch models theo thao tác người dùng, loading/error/empty; giữ nguyên model ID thật, không bịa alias |
| WW1-08 | Cài đặt đội agent | Lead luôn bật; sáu toggle/model selector; preset chỉ áp dụng khi người dùng chọn |
| WW1-09 | Trang phụ thuộc cục bộ | Runtime path, Git/Node/Python path/version nếu có; thiếu công cụ có hướng dẫn ngắn, không tự cài toàn hệ thống |
| WW1-10 | Khung task/activity/result/history | Form thật và empty state; Run chưa có adapter phải hiện chưa sẵn sàng, không giả thực thi |

## Chi tiết giao diện

- Project header: tên, đường dẫn rút gọn, Git branch/status và nút mở thư mục.
- Task composer: yêu cầu nhiều dòng, Run/Stop, chọn preset; cấu hình nâng cao thu gọn.
- Team: bảy hàng, role, bật/tắt, model. Không có model thì hiện yêu cầu chọn, không tự gửi task.
- Settings: Gateway, Runtime, Giới hạn; lưu trạng thái lỗi theo từng trường.
- History chuẩn bị dữ liệu và navigation ngay; chưa có run thì chỉ hiện empty state.

## Ranh giới phase

Không gọi model sinh code, tạo repo mẫu hoặc làm spike runtime. Fetch catalog/test connection là chức năng cấu hình sử dụng hằng ngày, không phải mốc chứng minh năng lực model. Không SSH hoặc thay đổi các VM.

## Bàn giao

- [x] App desktop mở được với shell và các form thật.
- [x] Project, gateway và team settings được lưu và mở lại (persistence kiểm tra trên SQLite riêng).
- [x] Key chỉ nhập tạm trong password field và IPC; không trả từ main hoặc lưu DB plaintext/React state/log/source.
- [x] Thiếu runtime/model được thể hiện rõ; chưa tuyên bố có coding agent hoạt động.
- [x] Mã nguồn và trạng thái WW-1 được đưa vào commit bàn giao.
