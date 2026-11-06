# R3B — Đồng nhất trạng thái cần xử lý

Baseline `7ef1179`, Worker alpha.8 / SQLite14. Không thay chính sách Bash; [phương án Bash](bash-autonomy-proposal.md) là đánh giá riêng theo yêu cầu người dùng.

1. Tách projection `WorkStateView` theo facts tối thiểu để Board/Overview/Team và chat/tiến độ dùng cùng nhãn cho quyền, câu hỏi, blocked, integration và kết quả. Không gọi model hoặc thêm bảng trạng thái.
2. Board lấy số permission và trạng thái question bằng query tổng hợp hiện có, không load full run cho từng card. Giữ column/evidence gate cũ; lý do chờ phải cụ thể. Question answered/superseded không hiện thành yêu cầu trả lời mới.
3. Overview và Team dùng cùng projection cho run; vẫn giữ activity từng execution, không biến role rảnh thành online. Overview/Inbox dùng chung nhãn cần xử lý; đã xem độc lập với đã giải quyết.
4. Cải thiện blocked không có quyền, integration conflict và case đồng thời có question/permission. Freshness dữ liệu feed không đồng nghĩa source cũ. Các action là navigation; Controller tiếp tục revalidate mutation.
5. Kiểm regression unit/SQLite và UI liên quan, typecheck/build/format. Không đọc toàn source mỗi poll để suy ra freshness; đối chiếu source vẫn do report detail theo yêu cầu. Chưa tuyên bố mọi kết quả đã current ở Board/Team.

Checkpoint trước code; commit kết quả kèm bằng chứng và giới hạn. Không migration/dependency hoặc thay DB/settings người dùng. R4/R6/3D tiếp tục ngoài phạm vi.
