# R3 — Lead, liên kết công việc và quyền Bash

**Đã hoàn thành R3**: [R3A](workspace-r3a-completion.md), [R3B](workspace-r3b-completion.md), [R3C](workspace-r3c-completion.md). Phần Ask/Full access trong kế hoạch gốc dưới đây đã được thay bằng [Bash tự động theo vai trò](bash-autonomy-completion.md) theo yêu cầu tiếp theo của người dùng.

Baseline `dc0227b`, Worker `1.3.0-alpha.8`, SQLite 14. Giữ Factory Lite/Windows Worker, một Controller, một active run và giới hạn lane/budget hiện có.

## Phạm vi

1. Chat mặc định trao đổi với Lead. Chuyển role/model sang menu nâng cao, giữ quyền ở vị trí dễ thấy. Tin nhắn mới dùng admission khi Lead có plan; trao đổi/reply không tạo submission hoặc đổi trạng thái việc đang có. Direct API/luồng Board/câu trả lời/yêu cầu sửa cũ giữ tương thích.
2. Controller chờ lưu/link item, revision, submission, run và chat receipt trong transaction trước dispatch task. Tái dùng schema14; retry/restart không tạo item mới, không materialize toàn bộ lịch sử. Lỗi lưu ngăn coding; kiểm chứng rollback/idempotency.
3. Projection trạng thái/hành động dùng dữ liệu thật, phân biệt đang làm/câu hỏi/quyền/chưa xác minh/kết quả cũ. Dùng trước trong hồ sơ/tiến độ; không tạo bảng trạng thái song song hay gọi model viết progress.
4. Bash: giữ Ask và Full access. Thêm action **Full access cho lượt này** cho lượt đang chạy để không phải chấp nhận từng lệnh; chỉ tự duyệt bash/doom_loop theo role policy, không mở edit/secret/external-directory. Action có run ID, kiểm tra stale, audit và retry; không thay cấu hình chung hoặc quyền các yêu cầu đã queue. Cấu hình Full access đã có dùng cho các lượt mới.
5. Kiểm chứng unit/integration và production Electron fixture, không dùng model để kiểm UI. Nếu cần kết luận hành vi model thật, báo riêng giới hạn thay vì giả kết quả. Ảnh và DB fixture chỉ local cache.

## Phương án quyền

- **Hỏi trước khi chạy:** mỗi lệnh cần duyệt như hiện tại.
- **Full access cho lượt này:** người dùng chọn rõ trong app khi lượt đang đợi; Controller lưu quyền trên run hiện tại, duyệt những ticket phù hợp và tự duyệt Bash tiếp theo. Có thể vẫn thấy Ask trong cấu hình chung vì action này không sửa mặc định.
- **Full access trong cấu hình:** áp dụng khi gửi lượt mới, giữ cho các lượt tiếp theo. Không tự đổi mặc định người dùng trong đợt nâng cấp.
- Không dùng regex “lệnh an toàn” hoặc luôn chấp nhận mọi loại permission. Bash chạy bằng quyền Windows hiện tại, không phải sandbox OS; vai trò/phạm vi và evidence gate vẫn được Controller kiểm tra.

## Bàn giao

Commit checkpoint trước source, commit kết quả sau kiểm chứng. Ghi file thay đổi, bằng chứng test và các phần R3 còn lại nếu phải chia lát cắt. R4 summary/index, R6 lịch và 3D ngoài phạm vi.
