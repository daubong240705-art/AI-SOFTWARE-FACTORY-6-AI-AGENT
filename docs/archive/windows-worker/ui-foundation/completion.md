# Bàn giao bộ nền UI — 05/11/2026

Phiên bản `1.3.0-alpha.4`, nhánh `feature/worker-ui-foundation`. Checkpoint trước thay đổi: `checkpoint/ui-foundation-start-20261105` tại `b6bcf3f`.

## Kết quả

Đã bổ sung token, primitive và hợp đồng layout dùng chung, áp dụng cho chat, markdown, agent monitor, Kanban, settings, history, recovery và task inspector. Chi tiết thiết kế và cách phát triển tiếp nằm trong [quy chuẩn](README.md).

Các nguyên nhân chính gồm `white-space:nowrap` trên nút chứa văn bản dài, flex stretch làm các cột Kanban cao bằng nhau, checkbox kế thừa kích thước input thường, khoảng cách form/command không thống nhất và selector điều hướng quá rộng. Các trường hợp này đã được xử lý theo phạm vi. Thứ tự CSS tập trung tại renderer entry, không còn import CSS trong ba component monitor/board/inspector. Nhãn phiên bản cũ V1.3B trên topbar đã bỏ; version thực vẫn hiển thị ở sidebar.

## Kiểm chứng thực tế

| Kiểm tra | Kết quả |
| --- | --- |
| `npm run typecheck` | Đạt |
| `npm test` | 152/152, không bỏ qua |
| `npm run format:check` | Đạt |
| `npm run test:native` | Đạt: SQLite, safeStorage, cancel/reopen |
| `npm run build` | Đạt: main, preload và renderer |
| Production Electron layout audit | 5/5 cấu hình, không lỗi renderer, không gọi provider |
| Xem ảnh | Kanban desktop/nhỏ, chat panel, inspector, agents, settings desktop/nhỏ |

Build vẫn có cảnh báo annotation PURE từ dependency Zod; build hoàn tất. Không thêm dependency mới.

[JSON phép đo](layout-checks.json) ghi rõ từng kích thước, zoom và kết quả. Audit xác nhận bảng chat có giới hạn chiều cao, không làm tràn trang; inspector không tràn ngang và facts căn đều; checkbox thẳng hàng; tiêu đề task wrap; cột rỗng/ít việc ngắn hơn backlog; có thể cuộn tới thẻ cuối/cột cuối; các ô số settings cùng baseline. Script chờ frame render trước chụp để tránh ảnh màn hình trước đó.

## Phạm vi và phần còn lại

Đợt này là chuẩn hóa UI Windows Worker với fixture và regression suite hiện có. Không thay Controller/runtime, schema, model hay quyền. Không gọi model thật vì không thay đường thực thi agent. Không tuyên bố bao phủ mọi màn hình/trạng thái hoặc audit accessibility toàn diện; preview/diff/permission và các lỗi hiếm cần ảnh trạng thái tương ứng khi thay đổi chúng.

CSS cũ còn được giữ và có base thống nhất phía trên. Có thể chuyển dần từng màn hình sang token/primitive khi phát triển tiếp; không cần viết lại toàn bộ. Giai đoạn 3D V1.3 tiếp theo chưa được thực hiện trong đợt này.
