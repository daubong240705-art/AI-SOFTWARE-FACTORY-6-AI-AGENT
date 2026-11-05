# Đề xuất bỏ duyệt Bash thủ công

Ngày 05/11/2026. Source đã đối chiếu: `electron/runtime/permissions.ts`, `opencode.ts`, `controller/runs.ts`, `team/role-policy.ts`, `shared/defaults.ts` trong Windows Worker. Đây là phương án, chưa thay chính sách hoặc cấu hình người dùng.

## Kết luận

Phù hợp để bỏ thao tác chấp nhận từng lệnh trong mô hình Worker cá nhân chạy repo tin cậy. Đề xuất **Bash tự động cho role thực thi**, giữ bộ kiểm soát runtime và quyền công cụ riêng. Không cần gỡ toàn bộ hệ thống permission hoặc tạo orchestrator mới.

Hiện app đã có Full access: OpenCode nhận `bash: allow`, Controller tự duyệt Bash nếu runtime vẫn phát ticket; không chỉ ẩn popup. `Ask` là mặc định nên mỗi lệnh mới vẫn xin quyền. Run và hàng chờ giữ snapshot, đổi cấu hình không đổi quyền của chúng.

## Các lựa chọn

| Lựa chọn | Thay đổi | Đánh giá |
|---|---|---|
| Dùng Full access hiện có | Chọn một lần cho các lượt mới; lượt đang chạy có nút riêng | Nhanh nhất, không cần sửa cơ chế |
| Bash tự động theo role (đề xuất) | Bỏ Ask cho Bash ở BE/FE/TEST/DEVOPS; bỏ selector/nút duyệt Bash khỏi chat; giữ quyền công cụ khác | Hợp hướng sản phẩm tự thực hiện; ít nhánh UI hơn |
| Xóa mọi permission/cho phép mọi tool | Bỏ role gate, external-directory/secret/edit/delegation policy | Không cần thiết để đạt mục tiêu; không đề xuất |

## Phạm vi của phương án đề xuất

- BE/FE/TEST/DEVOPS: Bash tự động. Lead/PM/BA vẫn không Bash; Lead trao đổi và giao việc qua Controller.
- Runtime khai báo `bash: allow` cho role phù hợp. Nếu OpenCode vẫn gửi ticket Bash, Controller tự duyệt một lần, audit và dừng khi không trả quyền được; không treo chờ nút Accept. Bash từ role không được phép bị từ chối, không chuyển thành popup xin nới quyền.
- Không gộp `doom_loop` với Bash: đây là tín hiệu lặp công cụ. Khuyến nghị chuyển nó thành lỗi chặn có lý do và cho người dùng sửa yêu cầu/thử lại, thay vì bấm duyệt vô hạn. Request/deadline vẫn có nhưng không thay thế hoàn toàn tín hiệu này.
- Chat chỉ trao đổi công việc với Lead. Hoạt động giữ trạng thái/lệnh/kết quả, không chèn câu hỏi xin quyền Bash. Câu hỏi nghiệp vụ và nghiệm thu giữ riêng.
- Giữ một active run, hạn mức request/thời gian/fix round, nút Dừng cây tiến trình, snapshot/diff/evidence và log lệnh. Không tự tăng quyền admin, đổi credentials hoặc thêm khả năng commit/push/deploy trong đợt này.

## Giới hạn thực tế

Bash chạy bằng tài khoản Windows hiện tại. Quy tắc deny secret/edit/external-directory của OpenCode áp dụng cho từng tool tương ứng, **không tạo sandbox cho tiến trình shell**. Lệnh shell vẫn có thể đọc/sửa ngoài phạm vi, truy cập mạng hoặc gọi công cụ khác nếu quyền OS cho phép. Source scope/evidence có thể phát hiện một số thay đổi sau thực thi; không bảo đảm ngăn mọi tác động trước khi xảy ra. Prompt cấm commit/push/deploy cũng không phải cơ chế cưỡng chế ở OS.

Vì vậy mô hình này phù hợp khi người dùng chấp nhận quyền tự thực thi của Worker trên repo tin cậy. Nếu cần giới hạn mạnh hơn: dùng tài khoản Windows riêng không admin hoặc máy/VM riêng, chỉ gắn source cần xử lý và không cấp credential production. Đây là lựa chọn cách ly, không bắt buộc tạo VM chỉ để bỏ popup.

Không đề xuất regex danh sách “lệnh an toàn”: shell có script, pipe, command substitution và dependency script; bộ lọc chữ không đủ chứng minh tác động.

## Các bước triển khai nếu chọn thay đổi sản phẩm

1. Checkpoint; tách `allowShell` theo role khỏi lựa chọn UI Ask/Full access. Giữ đọc được lịch sử `permissionMode` và audit cũ.
2. Cập nhật runtime config, system prompt và fallback Controller cùng một policy; bỏ Bash popup/composer selector, xử lý doom-loop riêng.
3. Xử lý snapshot run/hàng chờ cũ rõ ràng. Không tự replay lệnh, sửa report cũ hoặc gán quyền của run này cho run khác. App đang mở phải restart để nạp policy mới.
4. Kiểm role matrix, native ticket trùng, lỗi trả quyền, Stop/deadline, hàng chờ/restart và công cụ ngoài Bash. Kiểm UI không còn thao tác Accept Bash.
5. Cập nhật hướng dẫn đúng quyền OS; kiểm một lượt OpenCode thật nếu cần xác nhận runtime, tách khỏi fixture UI.

R3B hiện tại chỉ cải thiện projection trạng thái; chưa triển khai các thay đổi chính sách ở trên.
