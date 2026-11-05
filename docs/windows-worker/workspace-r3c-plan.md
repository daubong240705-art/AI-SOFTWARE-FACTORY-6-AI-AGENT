# R3C — Trạng thái kết quả và khả năng thao tác

Ngày 05/11/2026. Baseline `1e834b5`, Worker alpha.8 / SQLite14. Hoàn thiện phần projection còn lại của R3; giữ Bash tự động theo vai trò. R4/R6/3D ngoài phạm vi.

1. Dùng facts báo cáo gọn từ SQLite cho Board, Overview, Team, chat và tiến độ: verification đã lưu, revision/attempt hiện hành, policy và quyết định. Không tải output/snapshot mọi report hoặc hash source theo poll.
2. Phân biệt source chưa đối chiếu (`unknown`) với báo cáo cũ do revision/attempt/archive (`stale`). Summary không tuyên bố source hiện tại khớp. Hoàn thành trên Board giữ nghĩa bằng chứng đã lưu, kèm nhãn chưa đối chiếu source; policy bắt buộc chưa nghiệm thu nằm Chờ review. Report cũ không được tính Xong cho yêu cầu hiện tại.
3. Dùng một bộ capability nghiệm thu/yêu cầu sửa/thay policy; dữ liệu lỗi, bằng chứng thiếu, báo cáo lịch sử, integration và quyết định cũ phải khóa đúng action. Controller revalidate trước mutation; nghiệm thu cần source current và runtime/hàng chờ đã kết thúc. UI giữ report bất biến và không dùng báo cáo run khác sau điều hướng.
4. Unit/SQLite regression cho matrix identity/revision/attempt/policy/decision/source/busy/artifact, typecheck/build/format và production Electron fixture liên quan. Không model thật, DB/key người dùng hoặc dependency/migration mới. Bằng chứng UI chỉ cache local.

Checkpoint tài liệu trước code; commit kết quả kèm giới hạn và file đã đổi.
