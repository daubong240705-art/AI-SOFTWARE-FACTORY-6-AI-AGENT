# WW-4 — Hoàn thiện trải nghiệm làm việc

Mục tiêu: trải nghiệm làm việc bằng hội thoại như Codex app/Claude, kết hợp thao tác với source thật, diff, lệnh và preview. Giữ giao diện gọn, chữ rõ và không mất thay đổi của người dùng.

Điều chỉnh theo yêu cầu ngày 04/11/2026: chat trở thành màn hình chính của WW-4, thay bố cục ô yêu cầu phía trên và các bảng kết quả phía dưới. Giữ phong cách tối giản 9Router đã chọn; tham khảo cách tổ chức hội thoại của Codex/Claude.

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
| WW4-14 | Hội thoại theo project | Tạo/đổi tên/tìm kiếm/mở lại phiên; nhiều lượt user/assistant lưu SQLite, liên kết run và attempt; bản nháp riêng mỗi phiên |
| WW4-15 | Chat streaming và follow-up | Hiển thị nội dung phản hồi cùng hoạt động thu gọn; gửi yêu cầu tiếp có context; đang chạy thì follow-up vào hàng chờ có thể sửa/xóa, không tạo run song song |
| WW4-16 | Trình bày nội dung chat | Markdown/code block/copy, link file mở đúng panel, cuộn thông minh; không render HTML tùy ý hoặc reasoning; output quá dài có giới hạn |
| WW4-17 | Shell hội thoại và panel chi tiết | Sidebar phiên, chat trung tâm, panel phải resize/đóng mở cho diff/task/terminal/preview; composer cố định dưới, keyboard/IME và layout cửa sổ nhỏ |

## Cách bố trí màn hình chính

1. **Sidebar trái**: project, nút cuộc trò chuyện mới, tìm kiếm và danh sách phiên gần đây. Cài đặt ở cuối. Có thể thu gọn.
2. **Header nhỏ**: tên cuộc trò chuyện, project/branch và nút mở thay đổi/chi tiết. Không lặp một dãy thông số kỹ thuật.
3. **Chat ở giữa**: tin nhắn người dùng, phản hồi của Lead/agent và các khối hoạt động thu gọn như “Đang sửa 2 file”, “Đang chạy kiểm thử”. Kết quả cuối nằm trong hội thoại; chọn file/lệnh để mở chi tiết bên phải.
4. **Composer cố định dưới**: nhập yêu cầu, chế độ Lead tự phân công/Một agent, model phù hợp chế độ, nút gửi/dừng. Team/model theo role và giới hạn mở trong popover/cài đặt thay vì chiếm cột cố định. Enter gửi, Shift+Enter xuống dòng; không gửi khi IME đang composition. Bản nháp theo phiên được lưu.
5. **Panel phải theo nhu cầu**: Thay đổi (file list + diff), Nhiệm vụ (role/state/AC), Lệnh (output/exit code), Preview. Chỉ mở khi chọn nội dung hoặc thao tác; không buộc người dùng xem log trong cuộc trò chuyện.

Trên cửa sổ rộng: sidebar khoảng 240px, vùng nội dung tin nhắn tối đa khoảng 860px, panel chi tiết khoảng 420px và có thể resize. Trên cửa sổ nhỏ: sidebar/panel chuyển thành drawer, giữ composer và chat đủ rộng. Dùng Segoe UI/system font, nội dung chính 14–15px, khoảng cách nhất quán, màu nhấn hiện tại.

## Hành vi hội thoại và dữ liệu

- Một conversation thuộc một project, chứa nhiều message và nhiều run. Run vẫn là đơn vị thực thi có baseline, budget, task/session và evidence riêng; không biến toàn bộ hội thoại thành một runtime OpenCode sống vô hạn.
- Tin nhắn tiếp theo chuyển mục tiêu mới, tóm tắt lượt trước, AC/file/command refs liên quan và trạng thái workspace hiện tại cho Lead. Không gửi lại toàn bộ log hoặc giữ baseline cũ để sửa tiếp.
- Mặc định vẫn chỉ một run toàn app. Gửi khi đang chạy tạo follow-up chờ, hiển thị rõ và có thể sửa/xóa; không âm thầm chen vào session hay hủy công việc. Follow-up chỉ chạy sau khi run trước dừng/đóng hoàn toàn, kiểm tra lại project/baseline/giới hạn. Lượt lỗi, cần bổ sung hoặc hủy thì giữ hàng chờ cho người dùng chủ động gửi tiếp.
- Stream nội dung phản hồi người dùng được phép xem, không lưu reasoning. Event/tool riêng được gom vào khối hoạt động. Đang đọc lịch sử thì không kéo người dùng xuống cuối; có nút xem tin mới. Hủy/crash giữ phần phản hồi đã nhận với trạng thái rõ, không trình bày như kết quả hoàn chỉnh.
- Quyền shell xuất hiện thành thẻ thao tác gắn đúng lượt/task đang chạy. Không lẫn câu hỏi model với yêu cầu quyền của Controller, không đổi tool policy chỉ vì giao diện giống chat.
- Giữ run WW-2/WW-3, ID, timestamps và evidence; migration liên kết mỗi run cũ với một conversation tương ứng. Backup trước migration. Retry tạo run mới và liên kết attempt, không sửa lịch sử cũ.
- Markdown không thực thi raw HTML/script; code block có copy, đường dẫn file đi qua API mở file có kiểm tra project. Không thêm upload file, cloud sync hoặc tích hợp tài khoản Codex/Claude vào phạm vi WW-4.

## Thứ tự triển khai

1. **WW-4A — Chat nền tảng**: migration conversation/message, sidebar, chat/composer, mở lại phiên và liên kết lịch sử cũ; giữ Run/Stop/model/permission đang hoạt động.
2. **WW-4B — Hội thoại có context**: streaming, follow-up/hàng chờ, tóm tắt lượt trước, trạng thái lỗi/hủy và retry liên kết attempt.
3. **WW-4C — Làm việc với code**: baseline/diff snapshot, file list/diff ở panel phải, command evidence và restore có kiểm tra xung đột.
4. **WW-4D — Preview và bàn giao**: local command/server lifecycle, preview, crash/close recovery, retention/export và hoàn thiện keyboard/resize.

Mỗi phần giữ chức năng thực thi thật của WW-3. Không chỉ đổi CSS hoặc ghép một giao diện chat lên các lượt chạy độc lập rồi gọi là hội thoại nhiều lượt.

Tránh lặp tên run/role/model ở nhiều nơi; không đưa log kỹ thuật lên trang chính nếu chưa cần. Không thêm dashboard thống kê hoặc đoạn giới thiệu dài để lấp khoảng trống.

## Quy tắc phục hồi

- Mất gateway: giữ output và workspace, hiển thị lý do, không retry vô hạn.
- Crash: mở lại được history; không tự đánh dấu completed hoặc chạy lại task.
- Người dùng sửa file trong lúc agent làm: phát hiện theo baseline/hash; không khẳng định app có thể gán chính xác mọi dòng cho agent khi có chỉnh sửa đồng thời.
- Restore: chỉ phục hồi phần đã snapshot và được chọn; file có chỉnh sửa mới phải có xử lý xung đột rõ ràng.

## Bàn giao

WW-4A hoàn thành ngày 04/11/2026: schema4, chuyển toàn bộ run cũ, draft theo phiên, sidebar/search/rename, Markdown/code, chat/composer và panel chi tiết. Có context cơ bản giữa lượt gửi, chưa streaming hoặc tự động xếp hàng. [Báo cáo, ảnh và evidence](../../docs/windows-worker/ww4a-completion.md). Các đầu việc diff/restore/preview/recovery phía dưới vẫn chưa hoàn thành.

- [x] WW-4A: hội thoại nhiều lượt, bản nháp, lịch sử cũ và shell chat/composer/panel dùng được.
- [x] WW-4B: streaming, hàng chờ, retry/attempt và context có file/command refs. [Bàn giao và evidence](../../docs/windows-worker/ww4b-completion.md).
- [x] WW-4C: baseline, diff snapshot và restore từng file. [Bàn giao và giới hạn](../../docs/windows-worker/ww4c-completion.md).
- [x] WW-4D: local preview, lifecycle/recovery và retention/export bàn giao trong [V1.1](../../docs/windows-worker/v1.1-completion.md). Preview mở bằng trình duyệt ngoài; panel resize nâng cao vẫn là việc riêng.

- [x] Diff/history/report dùng được trên project đang có thay đổi.
- [ ] Kết quả lệnh và local preview có quản lý vòng đời.
- [ ] Retry/crash không làm mất evidence hoặc tự replay thao tác nguy hiểm.
- [ ] UI gọn và đầy đủ trạng thái; không còn nút cốt lõi chỉ có hình thức.
- [ ] Có hội thoại nhiều lượt, bản nháp/lịch sử bền vững, follow-up có context và streaming không lộ reasoning.
- [ ] Sidebar/chat/composer/panel chi tiết dùng được ở cửa sổ rộng và nhỏ; không mất Run/Stop, chọn model hoặc quyền shell.
- [ ] Commit WW-4 và cập nhật giới hạn thực tế.
