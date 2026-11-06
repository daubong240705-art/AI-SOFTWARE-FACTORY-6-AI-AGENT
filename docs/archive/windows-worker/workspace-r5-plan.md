# R5 — Thiết lập gọn và rõ trạng thái

Ngày 05/11/2026. Baseline `10ae348`, Worker alpha.8 / SQLite14. Giữ Factory Lite + Windows Worker, một Controller và Bash tự động theo role.

1. Tách presentation Cài đặt khỏi App, chia ba nhóm Model & quyền / Runtime & công cụ / Dữ liệu. Một nút Lưu cấu hình, advanced mở khi cần; không thêm wizard bắt buộc hoặc migration.
2. Gateway/key/CA và danh sách model tiếp tục dùng API hiện có. Catalog đã lưu không được gọi là kết nối thành công ở phiên này. Kiểm tra kết nối chỉ GET /models theo nút bấm, có pending/error/success/rỗng; sửa URL/CA/key làm kết quả kiểm tra cũ hết hiệu lực. Không tự gọi provider khi mở trang.
3. Chọn một model cho agent đang bật; giữ phân model theo role và preset hiện có trong advanced. Cho nhập model ID ngoài catalog có giới hạn, không tự chọn model/provider. Áp dụng model chỉ sửa nháp, không tự lưu hoặc bật role đã tắt.
4. Runtime: kiểm phiên bản theo yêu cầu bằng cấu hình đã lưu; không ngầm lưu toàn bộ cấu hình khi chỉ đọc phiên bản. Nhãn OpenCode đúng phiên bản được hỗ trợ, không suy chạy được model. Đường dẫn/runtime/execution/giới hạn nâng cao giữ hành vi hiện có.
5. Dữ liệu tái dùng preview/prune có bảo vệ; chỉ thao tác khi người dùng chủ động, không tự dọn DB. Readiness gọn khi đạt, hiện vấn đề bắt buộc và đưa tới đúng nhóm thiết lập nếu lỗi có thể sửa ở đó. Đổi cấu hình làm kết quả readiness cũ không còn được khẳng định.
6. Composer vẫn Lead mặc định, direct và chọn model trong tùy chọn hiện có; không đổi giao tiếp/runtime/quyền để làm UI. Chạy regression Lead/Bash tự động và chat.
7. Kiểm bằng helper tests, typecheck/build, Electron production fixture dữ liệu riêng và gateway HTTP loopback giả, nhiều viewport/zoom; lỗi/rỗng/key giữ-xóa/thay/cấu hình chưa lưu/preset/khôi phục nháp. Không gọi model/OpenCode thật, không chạm DB/key người dùng, ảnh/cache không đưa Git.

Tạo checkpoint này trước code; bàn giao kết quả cùng giới hạn và commit. R6 lịch, 3D, benchmark và bộ cài chưa thuộc đợt này.
