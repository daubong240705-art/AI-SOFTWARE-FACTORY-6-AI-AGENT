# Web Games + Portal

Tiện ích này dùng Team template, Workflow và Integration của Factory. Tiện ích không cài Portal; cần một Portal đang chạy và một token có quyền xuất bản.

1. Đặt `FACTORY_EXTENSIONS=portal` trong `factory.env`, khởi động lại Host rồi chạy `factory doctor`. Mục `D-EXT` kiểm tra manifest và pack.
2. Trong **Secret**, tạo secret chứa token Portal. Trong **Integration**, tạo HTTP API Integration cho Portal dựa trên `integration.example.json`: đổi `baseUrl`, thay `config.auth.bearer` bằng ID secret, và chọn phạm vi mà dự án truy cập được. Không dán token vào Workflow.
3. Đặt `FACTORY_PROJECTS_ROOT` trong shell giống cấu hình của Host. Chạy `bash extensions/portal/scripts/new-game.sh ten-game` (có thể đặt `FACTORY_GAME_STARTER` thành đường dẫn hoặc URL repo starter khác). Tạo dự án trỏ vào thư mục vừa in và chọn Team template **Web Games**.
4. Trong **Workflow**, nhập các Workflow template từ pack **Web Games**. Điền ID Integration ở đầu vào hoặc node tương ứng, kiểm tra cấu hình rồi lưu và xuất bản Workflow. Chạy Workflow; khi có **Approval** trong **Cần xử lý**, kiểm tra thay đổi và chọn **Duyệt** để gửi gói. Portal yêu cầu `dist/game.json` chứa `id`.
5. Nếu lần xuất bản dừng ở `bundle-outcome-unknown`, không chạy lại. Kiểm tra `versions` trên Portal theo game ID và commit trong kết quả node. Dùng màn hình đối soát HTTP effect nếu có, hoặc gửi `POST /projects/{projectId}/http-effects/{effectId}/reconcile` qua API Host với `{"resolution":"done"}` nếu đã xác nhận thành công, hoặc `{"resolution":"failed"}` nếu đã xác nhận thất bại. Lấy effect ID từ `GET /projects/{projectId}/http-effects`.
6. Để quay lại phiên bản cũ, dùng `versions` để xác nhận số phiên bản rồi chạy thao tác `rollback` của Integration với `gameId` và `version` (qua node `http.request`, sau một Approval). Kiểm tra lại phiên bản đang phục vụ trên Portal.

## Team và workflow

TODO: P2 bổ sung nội dung team và workflow.
