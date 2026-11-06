# V1.3 — Yêu cầu chức năng và quy tắc trạng thái

Trạng thái tài liệu: đề xuất triển khai; đọc cùng [kế hoạch tổng](README.md).

## 1. Theo dõi agent

Mỗi role có một ô: **tên · nhãn trạng thái · task hiện tại · hoạt động gần nhất · thời lượng**. Model, scope và chi tiết không trải đầy bảng; hiện khi chọn ô hoặc mở inspector. Bộ đếm “Đang làm / Rảnh / Cần xử lý / Chưa sẵn sàng” có thể click để lọc.

“Rảnh” chỉ nghĩa role không có execution hoạt động và đã được cấu hình hợp lệ. Không có lời hứa bắt đầu ngay: Controller còn kiểm tra slot, dependency, workspace và policy. Bảy role hiển thị không có nghĩa bảy agent chạy đồng thời.

### 1.1 Ba chiều trạng thái

| Chiều | Giá trị đề xuất | Ý nghĩa |
|---|---|---|
| Availability | `available`, `occupied`, `disabled`, `unconfigured`, `unknown` | Role có sẵn để được giao việc hay không |
| Activity | `idle`, `preparing`, `waiting_model`, `reading`, `editing`, `command`, `testing`, `reviewing`, `waiting_input`, `waiting_dependency`, `waiting_slot`, `integrating`, `stopping`, `finished`, `error`, `unknown` | Hoạt động quan sát được của một execution/task |
| Workflow | `backlog`, `ready`, `in_progress`, `review`, `blocked`, `done`, `archived` | Vị trí công việc trên Kanban |

`finished` là kết quả của execution vừa kết thúc, không phải trạng thái bận vĩnh viễn. Role hết execution trở về khả dụng; giữ “Vừa xong: …” ở dòng phụ trong thời gian ngắn. Badge tắt/chưa cấu hình không bị thay bằng badge rảnh.

### 1.2 Ánh xạ sự kiện thật

| Dữ kiện | Hoạt động/nhãn UI | Giới hạn diễn giải |
|---|---|---|
| Controller tạo runtime/worktree | Đang chuẩn bị | Chưa nói agent đang sửa code |
| Model request đang chờ phản hồi | Đang chờ model | Không hiển thị chain of thought; tránh nhãn “suy nghĩ” như một dữ kiện nội tâm |
| Tool đọc/tìm kiếm file đang chạy | Đang đọc `file` / Đang tìm source | Lấy tên tool và đường dẫn đã lọc, không parse nội dung reasoning |
| Tool write/edit/apply patch chạy | Đang sửa `file` | File thực sự thay đổi được xác nhận bằng diff; tool start chưa chứng minh đã sửa xong |
| Shell/command start | Đang chạy lệnh | Chỉ ghi “Đang kiểm thử” khi command catalog/workType/metadata xác định là test |
| Lead review task chạy | Đang review | TEST và Lead review là hai bước khác nhau |
| Pending permission/needs_input | Chờ bạn xử lý | Hiện hành động đúng policy hiện có; Full access không bị đổi thành cơ chế Accept mới |
| Task queued, dependency chưa đạt | Chờ `tN` / Chờ tích hợp | Agent có thể vẫn rảnh; không gắn occupied chỉ vì có task tương lai |
| Task queued, hết slot | Chờ lượt | Cùng role có thể đang làm task khác |
| Integration applying/conflict | Đang tích hợp / Xung đột source | Xung đột là trạng thái công việc, không giả thành lỗi model |
| Tool/request kết thúc | Trở lại hoạt động đang mở khác hoặc Đang chạy | Không giữ mãi trạng thái “coding/testing” của tool cũ |
| Error/cancel/interrupted | Lỗi / Đã dừng / Gián đoạn | Hiện nguyên nhân và thao tác phục hồi phù hợp, không đưa vào Done |
| Snapshot stale/không tải được | Chưa đồng bộ | Giữ lần cập nhật cuối, không suy đoán idle hoặc error runtime |

Một role có nhiều execution/attempt được hiển thị `BE · 2 tác vụ` cùng danh sách khi chọn. Dữ liệu luôn keyed theo project/run/task/attempt/execution; không ghi đè lane thứ hai bằng lane thứ nhất. Run direct được dựng thành execution/card đơn, không bị mất vì không có TeamTask.

Khi project đang xem khác project có run hoạt động, hiện dòng gọn “Đang chạy ở Project X”; không biến agent của run khác thành đang làm project hiện tại. Bộ đếm theo project được ghi rõ phạm vi; không cộng trùng role và execution.

## 2. Kanban dùng hằng ngày

### 2.1 Các cột

| Cột | Dữ liệu vào cột | Chuyển tiếp |
|---|---|---|
| Chưa làm | Card backlog người dùng tạo, chưa gửi thực thi | Sửa, sắp xếp, đưa sang Sẵn sàng |
| Sẵn sàng | Backlog đã chuẩn bị; runtime task queued không bị chặn | Gửi Lead qua luồng hiện có, hoặc chờ scheduler |
| Đang làm | Task/execution đang chuẩn bị, chạy, tích hợp hoặc dừng | Chuyển theo Controller |
| Chờ review | Work task đã trả kết quả, đang chờ TEST/Lead xác minh | Xong hoặc Cần xử lý/vòng sửa tiếp theo |
| Cần xử lý | Thiếu input/quyền, dependency bị lỗi, runtime fail, gián đoạn hoặc conflict | Hiện lý do và hành động; loại nguyên nhân bằng filter/badge |
| Xong | Kết quả hiện hành đã vượt qua gate evidence/review áp dụng | Xem kết quả hoặc tạo công việc tiếp theo |

Task queued chỉ chờ dependency bình thường vẫn ở Sẵn sàng với badge “Chờ tN”; đưa vào Cần xử lý khi dependency lỗi hoặc cần can thiệp. Card hủy/bỏ qua lưu trong lịch sử và có bộ lọc “Đã dừng/Bỏ qua”, không trộn vào Done. Archive là thuộc tính ẩn card, không phải xóa bằng chứng.

### 2.2 Hai loại card

**Card kế hoạch:** UUID ổn định, project, tiêu đề, mô tả yêu cầu, role gợi ý, mức ưu tiên, thứ tự, thời gian cập nhật. Có thể tạo/sửa/kéo trong Chưa làm ↔ Sẵn sàng. Có menu di chuyển để dùng bằng bàn phím. Không chứa secrets hoặc cấu hình provider.

**Card thực thi:** liên kết run, logical task và các attempt; trạng thái, role, model, dependency, diff/evidence lấy từ Controller. Không sửa task/scope/model đang chạy bằng drag. Thao tác tạo yêu cầu mới hoặc phục hồi dùng luồng hiện có và tạo attempt phù hợp.

Khi gửi card kế hoạch cho Lead, lưu liên kết tới run hoặc follow-up ngay trong transaction phù hợp; khóa thao tác gửi trùng. Nếu Lead chia thành nhiều task, giữ card cha và các task con trong inspector, tránh đếm cả cha lẫn con trong cùng mẫu số tiến độ. Lead chỉ trả lời chat thì card hiện “Có phản hồi, chưa có task”; không tự báo đã hoàn thành phần code.

### 2.3 Thao tác

- Click card: mở inspector; chọn role: lọc card và chọn bàn tương ứng trong 3D.
- Lọc theo project, hội thoại/run, role, trạng thái, loại work, ưu tiên; tìm tiêu đề/task ID.
- Hiển thị mặc định công việc hiện hành và số lượng giới hạn kết quả gần đây; lịch sử phân trang, không load toàn bộ log.
- Card runtime chỉ có các nút mà Controller hỗ trợ: mở chat/kết quả/diff/workspace, trả lời yêu cầu quyền, dừng run, tạo lại/phục hồi attempt.
- Nếu chưa hỗ trợ dừng riêng task, nút ghi **Dừng lượt chạy** và cho biết tất cả task thuộc run sẽ chịu ảnh hưởng; không đặt nút “Dừng agent” gây hiểu sai.
- Kéo card runtime sang Đang làm/Xong không được phép. Có thể chọn “Gửi yêu cầu sửa cho Lead” thay vì giả chuyển trạng thái.
- Backlog có thể tạo trong khi run đang hoạt động; gửi thực thi đi qua follow-up queue, vẫn chỉ một active run toàn ứng dụng.
- Đổi model áp dụng cho lần thực thi mới theo settings hiện có; inspector luôn hiển thị model snapshot thực sự của lần đang xem.

## 3. Tiến độ trung thực

Hiển thị hai số độc lập: **task được xác minh / tổng task hiện hành** và **acceptance đạt / tổng acceptance áp dụng**. Ví dụ `3/8 task · 5/12 tiêu chí`, kèm `1 cần xử lý`. Phần trăm nếu có phải ghi rõ là tỷ lệ task hoặc tiêu chí; không gọi là phần trăm tổng thời gian hoàn thành dự án.

- Chỉ tính work/fix theo logical task hiện hành, không cộng plan/review hay lặp lại mỗi attempt.
- Fix/replan có thể làm tiến độ giảm hoặc mẫu số tăng; hiện “Kế hoạch vừa cập nhật”, không ép biểu đồ tăng một chiều.
- Chỉ đưa task vào số đã xác minh khi evidence hiện hành và review gate hợp lệ. Nếu review mới ở cấp run, giữ task ở Chờ review đến khi xác minh được; không tự suy ra pass từng task.
- Run direct không có review gate chỉ có thể Done theo điều kiện hoàn thành đã định nghĩa cho direct; ghi rõ “Đã thực thi, chưa có xác minh acceptance” nếu thiếu cơ chế xác minh. Không tính vào tỷ lệ verified.
- Completed/failed cũ bị supersede vẫn xem được trong lịch sử, không làm tăng số task hiện hành.
- Thời lượng dựa startedAt/endedAt; tách thời gian chờ nếu có dữ kiện. Không đặt ETA khi chưa có cơ sở đo.
- Tokens/requests là số quan sát được; thiếu usage hiển thị chưa có dữ liệu, chi phí tiền không suy từ token khi chưa có bảng giá.

## 4. Inspector và timeline

Inspector có ba tab nhỏ: **Công việc / Thay đổi / Hoạt động**. Hiện role, model, task/attempt, mục tiêu, acceptance, dependency, scope, workspace/source version, integration và các nút đã hỗ trợ. Diff/output dùng component hiện có, tải khi mở.

Timeline mặc định chỉ hiện: nhận việc, bắt đầu, đổi loại hoạt động, chờ/cần input, kết quả lệnh quan trọng, source thay đổi đã xác nhận, bàn giao, review/fix, hoàn thành/lỗi/dừng. Gộp tool lặp lại thành “Đọc 6 file”; vẫn mở chi tiết từng event. Không đẩy MODEL_STEP/token heartbeat vào feed mặc định. Bàn giao/dependency là sự kiện workflow, không dựng thành cuộc hội thoại nội bộ không có thật.

## 5. Văn phòng 3D

Một phòng isometric cố định, Lead ở vị trí điều phối và sáu bàn role. Bảy vị trí có nhãn ngắn và chấm trạng thái. Bàn không chạy giữ yên; đèn/màn hình/nhịp animation thể hiện hoạt động thật. Role tắt/chưa cấu hình giảm tương phản nhưng vẫn đọc được.

Click avatar/bàn mở cùng inspector với Kanban. Nếu role có hai execution, hiện badge số lượng và cho chọn task; không tạo agent độc lập giả. Hover chỉ hiện một dòng `BE · Sửa auth.ts`; chi tiết không nổi đồng loạt trên mọi avatar.

Điều khiển: pan/zoom giới hạn, về góc mặc định, bật/tắt nhãn, chất lượng Thấp/Tự động, tắt animation. Không có di chuyển avatar bằng tay hoặc chỉnh nội thất trong V1.3.

## 6. Điều kiện hoàn thành

1. Mọi agent/task đang chạy thể hiện đúng sau snapshot cập nhật, kể cả hai lane cùng role.
2. Chat, Kanban, roster và 3D dùng cùng version trạng thái; chọn task ở một view mở đúng chi tiết ở view khác.
3. Full access và review gate không bị thay đổi; không thao tác UI nào tự đánh dấu runtime thành công.
4. Restart giữ backlog/liên kết/history; interrupted/stale không biến thành idle/done.
5. Đóng hoặc lỗi WebGL không dừng run; có fallback 2D đọc và thao tác được bằng bàn phím.
6. Có bằng chứng state mapping, migration, thao tác board, execution thật, stop/recovery và hiệu năng theo [phase nghiệm thu](implementation.md).
