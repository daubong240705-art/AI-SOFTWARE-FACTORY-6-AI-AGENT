# R2 — Hồ sơ công việc

Baseline/checkpoint source: `03e266e` (R1). Giữ Factory Lite, Windows Worker, Controller, SQLite 14 và policy hiện hành. Không migration hay gọi model để kiểm UI.

1. Dùng một detail host chung, một ChatHost giữ parent/DOM ổn định; hồ sơ và inspector kỹ thuật là hai lớp thay thế nhau, có Back.
2. Hồ sơ bốn tab Yêu cầu / Trao đổi / Tiến độ / Kết quả. Giữ revision, comment, submission, retry, câu hỏi, report/evidence/acceptance hiện có.
3. Trao đổi là chat Lead đúng work context; ghi chú riêng có nhãn, không giả là tin nhắn cho agent. Nháp chat/ảnh không đổi writer khi đổi tab.
4. Câu hỏi thuộc item xuất hiện trong Yêu cầu; Chat chỉ dẫn về đó. Flush câu trả lời trước đổi tab/đóng/drill-down; lỗi giữ view. Câu hỏi của hội thoại chưa có item vẫn dùng UI cũ.
5. Tiến độ đọc run/task thật, lịch sử attempt và hàng chờ; Kết quả tự chọn lượt kết thúc mới nhất, vẫn chọn xem kết quả cũ và giữ policy revision.
6. Board, Chat, Tổng quan, Cần xử lý và Team mở hồ sơ khi run có link; dữ liệu run-only vẫn xem được bằng inspector, không tự materialize lịch sử.
7. Kiểm chứng typecheck/build/test phù hợp, production Electron với SQLite riêng: một composer/form, question draft/error/continuation, đúng revision/report, Back/focus/scroll, cửa sổ hẹp và zoom. Ảnh chỉ lưu cache, stage file tường minh.

R3 auto-link plan/state projection và R4 index/summary tiếp tục sau R2. Rollback R2 bằng revert source commit, không phục hồi DB.
