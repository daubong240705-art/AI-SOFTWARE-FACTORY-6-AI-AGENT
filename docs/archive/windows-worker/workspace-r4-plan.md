# R4 — Trang chính, Đội ngũ toàn app và Kết quả dự án

Ngày 05/11/2026. Baseline `67717c2`, Worker alpha.8 / SQLite14. Giữ một Controller/active run, Factory Lite + Windows Worker và Bash tự động theo role. Không thêm model call, dependency hoặc migration.

1. Một feed tổng hợp toàn app: số mục cần xử lý chính xác (đã xem độc lập actionable), năm mục cần xử lý và năm kết quả mới. Tái dùng query Inbox, report metadata và projectMonitor cho active run; không fan-out theo project hoặc suy tổng từ 50 runtime runs.
2. Trang chính có điểm vào Lead với đích project rõ ràng, dùng ChatHost/draft/send hiện có; không tạo composer writer hoặc send service thứ hai. Giữ dự án, đang thực hiện, cần xử lý và kết quả mới gọn, mở đúng hồ sơ.
3. Sidebar thêm Đội ngũ toàn app; công việc/execution đang làm trước, role sẵn sàng phía sau. Tái dùng projectMonitor, ghi rõ dự án active, role availability không khẳng định runtime online. Giữ Team project để tương thích.
4. Tab Kết quả trong project: metadata mới nhất theo item/lineage, cursor ổn định, tìm tiêu đề/tóm tắt, bộ lọc kiểm chứng. Không đưa chat tư vấn vào deliverable, không trả full report/output/diff. Mở hồ sơ Kết quả hoặc report run-only hiện có; không tạo item hàng loạt.
5. Shared feed chống request chồng, bỏ phản hồi sai scope, xử lý lỗi/stale và dừng timer khi không còn subscriber. Không đổi scope project/draft ngầm khi chỉ xem toàn app. Badge đếm actionable kể cả đã xem.
6. Kiểm SQL/schema/cursor/identity/redaction/count, UI production Electron nhiều viewport/zoom, typecheck/build/format; ảnh/DB chỉ cache local. Không gọi model/OpenCode thật hoặc chạm DB/key người dùng.

Checkpoint trước code, commit bàn giao kèm bằng chứng. R5 setup, R6 lịch, 3D và benchmark lớn tiếp tục ngoài phạm vi.
