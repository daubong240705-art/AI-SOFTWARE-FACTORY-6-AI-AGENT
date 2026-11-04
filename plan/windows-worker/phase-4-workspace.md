# WW-4 — Hoàn thiện trải nghiệm làm việc

Mục tiêu: dùng ứng dụng cho source đang phát triển mà không mất thay đổi của người dùng; xem được tiến trình, diff, lệnh và lịch sử sau khi mở lại.

## Đầu việc

| Mã | Công việc | Điều kiện hoàn thành |
|---|---|---|
| WW4-01 | Baseline đầy đủ và phát hiện thay đổi ngoài app | Giữ HEAD/index/working changes, không tự stash/reset; phân biệt pre-existing, changed-during-run và xung đột |
| WW4-02 | Git diff UI | File tree/list, unified diff, staged/unstaged/untracked, rename/delete/binary, file lớn; không đánh đồng toàn bộ dirty files với agent edits |
| WW4-03 | Snapshot kết quả theo run | Mở run cũ xem đúng diff/kết quả lúc đó, không lấy working tree hiện tại thay lịch sử |
| WW4-04 | Hành động với file | Mở thư mục/file, copy patch; restore từng file có preview và phát hiện sửa mới, không reset toàn repo |
| WW4-05 | Command result panel | Command/cwd/duration/exit code/output; lọc secret, truncate UI, lưu artifact giới hạn dung lượng |
| WW4-06 | Profile lệnh dự án | Nhận biết package scripts/toolchain, cho người dùng chọn lệnh; không tự tin chạy script từ repo không tin cậy |
| WW4-07 | Local dev server | Start/stop process app quản lý, nhận diện URL; mở browser theo thao tác, không tự expose LAN |
| WW4-08 | History và tìm kiếm | Theo project, yêu cầu, ngày/state; mở lại report/task timeline và snapshot team |
| WW4-09 | Retry và tiếp tục | Tạo attempt mới có liên kết, giữ lỗi cũ, kiểm tra baseline; không âm thầm replay lệnh side effect |
| WW4-10 | Phục hồi sau crash | Run chưa kết thúc thành interrupted, kiểm tra child process, không nhận nhầm process đã tái dùng PID |
| WW4-11 | Close window/tray | Có lựa chọn rõ khi run/dev server còn chạy; không để process mồ côi hoặc tự hủy công việc không báo |
| WW4-12 | Hoàn thiện UI | Keyboard/focus, resize panel, long path/model names, loading/empty/error, không tràn ngang cửa sổ nhỏ |
| WW4-13 | Dọn dữ liệu và xuất báo cáo | Retention, export report/log đã redaction; xóa history không xóa source, dữ liệu run đang chạy được bảo vệ |

## Cách bố trí màn hình chính

1. Header: project, branch, trạng thái task và nút Run/Stop.
2. Ô yêu cầu, team thu gọn và task hiện tại.
3. Tab **Hoạt động**: timeline tóm tắt, chi tiết tool mở theo nhu cầu.
4. Tab **Thay đổi**: danh sách file và diff; cảnh báo file có thay đổi trước run.
5. Tab **Kết quả**: tóm tắt, AC, build/test, URL/cách chạy và việc còn thiếu.

Tránh lặp tên run/role/model ở nhiều nơi; không đưa log kỹ thuật lên trang chính nếu chưa cần. Không thêm dashboard thống kê hoặc đoạn giới thiệu dài để lấp khoảng trống.

## Quy tắc phục hồi

- Mất gateway: giữ output và workspace, hiển thị lý do, không retry vô hạn.
- Crash: mở lại được history; không tự đánh dấu completed hoặc chạy lại task.
- Người dùng sửa file trong lúc agent làm: phát hiện theo baseline/hash; không khẳng định app có thể gán chính xác mọi dòng cho agent khi có chỉnh sửa đồng thời.
- Restore: chỉ phục hồi phần đã snapshot và được chọn; file có chỉnh sửa mới phải có xử lý xung đột rõ ràng.

## Bàn giao

- [ ] Diff/history/report dùng được trên project đang có thay đổi.
- [ ] Kết quả lệnh và local preview có quản lý vòng đời.
- [ ] Retry/crash không làm mất evidence hoặc tự replay thao tác nguy hiểm.
- [ ] UI gọn và đầy đủ trạng thái; không còn nút cốt lõi chỉ có hình thức.
- [ ] Commit WW-4 và cập nhật giới hạn thực tế.
