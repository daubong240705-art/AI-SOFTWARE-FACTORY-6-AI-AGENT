# UX-01 — Giảm mật độ thông tin và điều hướng

Ngày: **05/11/2026**. Triển khai tiếp từ `a375a4d` theo ảnh phản hồi của người dùng. Checkpoint: `checkpoint/ux01-ui-refinement-20261105`. Giữ Worker `1.3.0-alpha.8`, SQLite 7; chưa làm migration UX-02.

## Bố cục hiện hành

| Khu vực | Quy tắc |
|---|---|
| Thanh bên | Bốn trang chính: Tổng quan, Trò chuyện, Công việc, Đội ngũ. Cài đặt ở dưới; Lịch sử/Văn phòng trong Khác |
| Dự án | Một menu ở header để chọn/thêm/bỏ dự án, xem đường dẫn và branch. Bỏ danh sách dự án lặp ở sidebar |
| Hội thoại | Chỉ hiện danh sách/tìm kiếm/tạo hội thoại trong Chat. Khi sidebar thu gọn hoặc cửa sổ hẹp, dùng nút Danh sách hội thoại trên header |
| Thao tác chính | Hỏi Lead ở Tổng quan/Đội ngũ/Văn phòng; tạo việc ở Board. Không lặp hai nút này trên mọi trang |
| Tổng quan | Lượt đang chạy ở trên; khi rảnh chỉ một dòng trạng thái. Cần xử lý và Kết quả công việc cạnh nhau khi đủ rộng |
| Mục cần xử lý | Ba dòng mặc định, bấm cả dòng để mở đúng ngữ cảnh. Xem thêm/Thu gọn ngay tại chỗ, giữ tổng số và toàn bộ mục trong phạm vi gần đây |
| Kết quả | Ba kết quả mặc định, tối đa năm khi mở rộng; tiêu đề, xác minh, thời gian, số file nếu có. Không in đoạn summary dài |
| Hoạt động | Mặc định đóng, ẩn khi không có dữ liệu; mở để xem tối đa sáu mốc và đường tới chi tiết |
| Chat | Không lặp project/branch dưới tên hội thoại. Copy/Chi tiết ở tin nhắn; retry/lượt gốc/hoạt động/thay đổi trong menu phụ |
| Panel Chat | Ba tab theo thứ tự Kết quả → Thay đổi → Hoạt động. Chạy local/Workspace ở menu Công cụ dự án |
| Board | Tìm kiếm và role luôn hiện. Ưu tiên/loại việc/đã dừng/lưu trữ trong Bộ lọc, có số lượng bộ lọc đang áp dụng. Bỏ dãy role lặp phía trên |
| Trạng thái kỹ thuật | Footer chỉ xuất hiện khi ứng dụng bận hoặc đang chạy; phiên bản trong Khác |

Các mục chưa giải quyết không bị tự đóng hoặc xóa. Nội dung lý do trên Tổng quan rút thành một dòng, tooltip và chi tiết vẫn có nội dung đầy đủ trong giới hạn DTO. Scope vẫn 12 lượt logic gần nhất, 50 yêu cầu chờ, không phải inbox toàn lịch sử.

## Phân biệt chat và công việc

DTO thêm `hasWork` từ dữ liệu đã lưu: có task work/fix, lệnh hoặc file thay đổi. Chỉ lượt completed có dấu hiệu công việc này vào Kết quả công việc. Lượt chỉ trả lời chat nằm trong hội thoại/lịch sử, không dựa vào từ khóa “hi” hoặc nội dung model để phân loại. Task phân tích chỉ đọc vẫn là công việc. Lượt lỗi/needs_input vẫn hiện trong Cần xử lý ngay cả khi chưa có task. `hasWork` không thay thế evidence gate và không chứng minh đã xác minh.

## Component và kiểm tra

Thêm `src/ui/Popover.tsx` và CSS dùng chung: menu app tự vẽ trong top layer, có tên truy cập, Tab, Escape, bấm ngoài để đóng, trả focus khi đóng bằng Escape; không dùng native select/menu hoặc thêm dependency. Tái sử dụng ở menu dự án, Khác, hội thoại hẹp và thao tác tin nhắn/công cụ. Board giữ chiều cao cột theo viewport.

- `typecheck`, `format:check`, build main/preload/renderer: đạt. Build còn warning annotation Zod sẵn có.
- Tests overview/interaction/board: **16/16 đạt**. Có bài marker công việc, không suy diễn completed là verified, phân tích chỉ đọc và giữ lỗi cần xử lý.
- Electron Tổng quan: đạt năm cấu hình cửa sổ/zoom 100–150%, không lỗi renderer. Kiểm tra ba dòng/mở rộng bảy mục, loại phản hồi chat khỏi kết quả, menu dự án bằng Space/Tab/Enter/Escape, chọn project hẹp, danh sách hội thoại hẹp, Khác → Lịch sử, draft tiếng Việt, Board create, bộ lọc nâng cao và stale/recovery. Không gọi provider.
- Electron UI foundation: đạt năm cấu hình trên Chat/Board/Team/Settings/History và inspector; dropdown, tab, cột Board và các trường không tràn. Bộ lọc được mở khi đo checkbox rồi đóng lại.
- Electron Inspector: đạt luồng Chat/menu phụ → inspector, task/attempt/model đúng, lazy diff/output, log kỹ thuật, giữ draft và cửa sổ nhỏ. Cập nhật kỳ vọng timeline không còn dòng TOOL_STARTED lặp theo hành vi UX-01 đã chốt.

Ảnh và dữ liệu cô lập chỉ ở `.cache`, không commit. [Acceptance Tổng quan](ux01-ui-refinement.json). Các thay đổi chính nằm trong `src/App.tsx`, `ProjectOverview`, `ChatWorkspace`, `KanbanBoard`, `src/overview.css`, primitive Popover, projection overview và harness UI tương ứng.

**Tiếp theo UX-02:** hồ sơ công việc bền vững, revision, discussion, lịch sử submission/attempt. Đợt này hoàn thiện nền điều hướng và mật độ hiển thị theo phản hồi trước khi thay entity/dữ liệu.
