# V1.3 mở rộng — Agent Monitor, Kanban và AI Office 3D

Ngày lập: 04/11/2026; cập nhật 05/11/2026. **A–C, UI foundation và D-01–03 đã triển khai; hiện tại `1.3.0-alpha.7`. D-04/D-05 và E còn lại.** Người dùng đã chọn tên V1.3 mở rộng thay cho V1.13. [Bàn giao A](../../docs/windows-worker/v1.3a-completion.md), [B](../../docs/windows-worker/v1.3b-completion.md), [C](../../docs/windows-worker/v1.3c-completion.md), [D-01/D-02](../../docs/windows-worker/office-3d/README.md), [D-03](../../docs/windows-worker/office-3d/d03/README.md).

## 1. Kết quả cần đạt

Mở một project, người dùng biết ngay **ai đang làm, ai đang rảnh, đang làm việc gì, vướng ở đâu và đã hoàn thành đến đâu**. Có thể chuyển giữa Chat, Kanban và văn phòng 3D mà vẫn xem cùng một trạng thái thực tế.

| Câu hỏi | Thông tin trên giao diện |
|---|---|
| Ai đang làm? | Role, task/attempt hiện tại, model thực tế, thời điểm bắt đầu, hoạt động mới nhất |
| Ai đang rảnh? | Role đã bật và có model, không có execution hoạt động; tách khỏi đang tắt/chưa cấu hình |
| Làm như thế nào? | Đọc file, sửa file, chạy lệnh, test, review; xem lệnh/diff/bằng chứng khi mở chi tiết |
| Vì sao chưa chạy? | Chờ dependency, slot thực thi, tích hợp source, quyền truy cập hoặc người dùng bổ sung |
| Tiến độ đến đâu? | Số task được xác minh/tổng task hiện hành, tiêu chí đạt/chưa đạt/chưa xác minh, trạng thái tích hợp |
| Điều gì vừa thay đổi? | Dòng thời gian ngắn theo agent/task; mở log kỹ thuật khi cần |
| Cần làm tiếp việc gì? | Kanban của project, card backlog và task thực thi liên kết với run/hội thoại |

## 2. Baseline đã khảo sát

Source hiện tại: `feature/windows-worker-review-quality`, commit `2b5326f`, Windows Worker `1.2.0-alpha.4`. Đây là baseline trên nhánh tính năng; không khẳng định đã nằm trên `main` hoặc V1.2 stable.

- Electron + React + TypeScript; SQLite schema 6; Controller quản lý OpenCode, 9Router và tiến trình Windows.
- Có Lead và sáu role PM, BA, BE, FE, TEST, DEVOPS. Đây là profile được gọi theo công việc, không phải bảy tiến trình AI chạy thường trực.
- Một run hoạt động toàn ứng dụng. Mặc định tuần tự; chế độ `isolated-pair` cho tối đa hai work task tương thích chạy đồng thời. V1.3 giữ nguyên giới hạn này.
- Có task/attempt, dependency, model snapshot, command, changed file, worktree, integration workspace, recovery và review có bằng chứng.
- `RunEvent` hiện có sequence/type/text/at; task ID đang được ghép vào text của Controller. Chưa đủ làm nguồn trạng thái có cấu trúc cho hai lane chạy đồng thời.
- Chat hiện poll chi tiết mỗi 400 ms, có thể gọi `runDetail` hai lần cho cùng run trong một vòng. Không nhân mô hình này thành ba màn hình poll độc lập.
- `TeamTask.state === completed` chưa đồng nghĩa mọi acceptance đã được Lead xác minh. Kanban phải thể hiện đúng khác biệt này.
- Bằng chứng kiểm tra baseline nằm trong [bàn giao alpha.4](../../docs/windows-worker/review-quality-completion.md). Công việc hiện tại chỉ lập kế hoạch và tìm ảnh tham khảo; không chạy lại build/test sản phẩm.

## 3. Phạm vi chốt cho kế hoạch

**P0 — bắt buộc:** trạng thái thật theo agent/execution; bảng agent 2D; Kanban dùng được; inspector; lịch sử chuyển trạng thái; phục hồi dữ liệu; liên kết Chat; UI không quá tải.

**P1 — nằm trong V1.3 đầy đủ:** một phòng 3D góc nhìn isometric, bảy vị trí role, click chọn agent, hoạt ảnh nhẹ theo event, chế độ giảm tải và fallback 2D. Có thể bàn giao bản alpha 2D trước để sử dụng trong khi hoàn thiện 3D.

**Ngoài phạm vi:** scheduler mới, tăng concurrency, nhiều worker/máy, Connected Mode, Jira/OpenProject/GitLab Server, tự deploy, marketplace, chỉnh sửa phòng tự do, thế giới nhiều project, mô phỏng đời sống agent, installer WW-5, tạm dừng/tiếp tục native process tại đúng vị trí lệnh.

Factory Lite + Windows Worker và một Controller tiếp tục là kiến trúc chính. Full access dùng policy hiện có; Kanban/3D không tạo lớp xác nhận mới cho thao tác đã được policy cho phép.

## 4. Tài liệu triển khai

| Tài liệu | Nội dung |
|---|---|
| [Yêu cầu và trạng thái](requirements.md) | Agent rảnh/bận, tiến độ, Kanban, các thao tác được phép |
| [Kiến trúc và dữ liệu](architecture.md) | Projection, sự kiện, SQLite, IPC, đồng bộ và đường dẫn source |
| [Các phase và nghiệm thu](implementation.md) | Backlog có mã việc, phụ thuộc, checklist kiểm tra, phát hành |
| [Thiết kế và ảnh tham khảo](design.md) | Bố cục UI, văn phòng 3D, màu/chữ, nguồn ảnh và asset |

## 5. Thứ tự thực hiện

| Đợt | Bàn giao | Phụ thuộc | Ước lượng công sức* |
|---|---|---|---|
| V1.3A — đã triển khai | Hợp đồng trạng thái và snapshot chung, agent monitor 2D | Baseline hiện tại | 2–3 ngày (ước lượng ban đầu) |
| V1.3B — đã triển khai | Kanban, backlog local, liên kết task/run, thao tác hợp lệ | A | 3–4 ngày (ước lượng ban đầu) |
| V1.3C — đã triển khai | Inspector, timeline gọn, Chat dùng dữ liệu chung | A, B | 2–3 ngày (ước lượng ban đầu) |
| V1.3D — D-01/D-02 đã triển khai | Đã có phòng/camera; còn chọn agent và ánh xạ trạng thái execution | A, C | 3–5 ngày (ước lượng ban đầu) |
| V1.3E | Tối ưu, fallback, nghiệm thu và bàn giao | B, C, D | 2–3 ngày |

\* Tổng khoảng **12–18 ngày công**, là ước lượng lập kế hoạch cho một luồng triển khai chính, không phải lịch cam kết hoặc thời gian chạy model. A–C tạo bản alpha có giá trị sử dụng trước; D–E hoàn thiện V1.3. Mỗi đợt chỉ đánh dấu hoàn thành sau khi có bằng chứng tương ứng.

## 6. Quyết định kỹ thuật chính

1. Bảng agent, Kanban và 3D cùng đọc một snapshot có version từ Controller. Renderer không tự quyết định agent nhận việc.
2. Tách **khả dụng của role**, **hoạt động execution**, **workflow của card**. Không gom thành một enum gây hiểu nhầm.
3. Card tự chuyển cột theo lifecycle thật. Không kéo một task đang chạy sang “Xong” để bỏ qua test/review.
4. Tiến độ dựa trên task/acceptance đã xác minh; không suy ra phần trăm từ thời gian, số token hoặc hoạt ảnh.
5. Trạng thái chưa đồng bộ hiển thị “Chưa đồng bộ”; không đổi hàng loạt agent thành “Rảnh” khi mất feed.
6. 3D được tải khi mở; tắt 3D chỉ dừng render. Task/command vẫn do main process quản lý.
7. Nút dừng dùng `stopRun` hiện có, nêu rõ ảnh hưởng toàn run; chưa hứa có dừng riêng từng agent.
8. Thêm Three.js + React Three Fiber ở đợt D sau khi kiểm tra tương thích React/Electron và pin lockfile. Không thêm backend/service hoặc framework Kanban nếu component nhỏ đã đủ.

## 7. Điểm bắt đầu khi code

Đã hoàn thiện **V1.3A–C**, UI foundation và **D-01–03**: phòng bảy vị trí, camera, trạng thái execution từ monitor chung, nhiều tác vụ cùng role và tiến độ xác minh. Tiếp theo **D-04 — chọn agent/task và mở inspector**, sau đó D-05/E đo hiệu năng, fallback và nghiệm thu model thật. Không cần chuẩn bị VM.

V1.3A thêm snapshot/trạng thái và migration schema 7; B–C/D dùng schema này. D-01 thêm Three/R3F pin phiên bản, không đổi credentials/cấu hình hệ thống. File roadmap người dùng cung cấp được giữ nguyên. Bước code tiếp theo là D-04.
