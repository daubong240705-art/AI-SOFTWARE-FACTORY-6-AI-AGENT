# WW-2 — Thực thi công việc với OpenCode

Mục tiêu: người dùng nhập task trong app và làm việc trên source đã chọn. Tích hợp runtime vào sản phẩm trực tiếp, không xây repo/spike chứng minh riêng.

Phụ thuộc: WW-1 có cấu hình project, gateway, model và IPC/storage.

Trạng thái 04/11/2026: đã triển khai. [Evidence và giới hạn](../../windows-worker/ww2-completion.md): OpenCode/SDK 1.19.5, DeepSeek Flash `ds/deepseek-v4-flash` tạo source thật và chạy test qua chính Controller trong Electron. UI đã nối IPC, chưa visual acceptance lại do native Computer Use pipe không khả dụng. SDK headless là lựa chọn WW2-02; bảy role vẫn được chọn trực tiếp, native subagent sẽ triển khai WW-3 qua cùng adapter.

## Đầu việc

| Mã | Công việc | Điều kiện hoàn thành |
|---|---|---|
| WW2-01 | Run/task/event repositories và execution lock | Một run hoạt động toàn app, state và event lưu nhất quán |
| WW2-02 | Tích hợp giao diện OpenCode đúng phiên bản | Đọc version/help/schema tại lúc code; chọn CLI/headless phù hợp, ghi capability và pin version; không đoán SDK |
| WW2-03 | RuntimeAdapter và cấu hình riêng theo app/run | Nạp provider/model/policy; không sửa config toàn cục hoặc repo người dùng một cách ngầm định |
| WW2-04 | Process manager Windows | Khởi chạy bằng executable/argv đúng, xử lý path có khoảng trắng; lưu cây tiến trình thuộc run, không kill process khác |
| WW2-05 | Start task từ UI | Snapshot settings/baseline, cấp run ID/session ID, chuyển running khi đã khởi chạy thật |
| WW2-06 | Event normalization và activity stream | Tool/file/error/event upstream ánh xạ về schema nội bộ; giới hạn log, chống trùng, che credential |
| WW2-07 | Quyền runtime và permission dialog | Ánh xạ policy thật của runtime, ghi quyết định theo scope; không mặc định allow-all shell |
| WW2-08 | Stop/cancel/timeout | Chuyển cancelling, dừng runtime và lệnh con của run; lưu cancelled hoặc lỗi dừng rõ ràng |
| WW2-09 | Kết thúc và thu kết quả ban đầu | Final message, file thay đổi, command status nếu có; lỗi tool/upstream không bị ghi thành thành công |
| WW2-10 | Xử lý lỗi gateway và runtime | Phân biệt auth, model không tồn tại, rate limit, network/TLS, CLI crash; không lặp vô hạn |

## Luồng thao tác

1. Người dùng chọn project và nhập yêu cầu.
2. Controller kiểm tra cấu hình bắt buộc, lưu snapshot workspace/settings và tạo run.
3. Adapter chạy OpenCode trong workspace; UI hiển thị tác vụ và event thực tế.
4. Thao tác cần quyền bổ sung chuyển blocked/permission request nếu policy yêu cầu.
5. Run kết thúc hoặc bị dừng; app lưu trạng thái, tóm tắt và danh sách thay đổi.

WW-2 dùng một role thực thi đã cấu hình, chưa tuyên bố Lead tự giao đủ đội. Phần subagent được nối ở WW-3, dùng cùng adapter/event/storage.

## Giới hạn kỹ thuật

- App quản lý đúng PID/cây process; có graceful stop và thời gian chờ trước terminate.
- Không truyền API key trên argv; config sinh ra đặt ngoài repo, hạn chế quyền truy cập.
- Không suy ra một task đã thành công chỉ từ câu trả lời cuối của model.
- Model không hỗ trợ tool hoặc phiên bản runtime không tương thích phải báo rõ; không lặng lẽ chuyển model.
- Không tự tạo commit hoặc push source dự án.

## Bàn giao

- [x] Run/Stop nối runtime thật và source người dùng đã chọn.
- [x] Activity và kết quả bám event/thay đổi thực tế.
- [x] Trạng thái lỗi/cancel lưu SQLite, UI đọc lại qua IPC khi đổi màn hình.
- [x] Không có repo mẫu hoặc phase khảo sát runtime riêng; thử model ngay trên source sản phẩm.
- [x] Mã nguồn, evidence và giới hạn WW-2 được đưa vào commit bàn giao.
