# Lỗi model và khả năng theo dõi task — 05/11/2026

## Bằng chứng từ SQLite

Đọc `worker.sqlite` của ứng dụng bằng kết nối `mode=ro` và `query_only=ON`, bao gồm dữ liệu WAL. Không sửa settings, credentials, lịch sử hay dữ liệu dự án.

Hai lượt chạy riêng biệt đều dừng ở FE, sau khi Lead và BA hoàn thành:

| Lượt | Model request bắt đầu (UTC) | Kết thúc (UTC) | Thời gian |
| --- | --- | --- | --- |
| `ce0ce410-b95a-4b3e-a8ba-ab6a8c0beecf` | 06:27:49.460 | 06:29:19.466 | 90,006 giây |
| `6c8e3fea-a73b-4108-98a3-9a9e2048df15` | 06:31:06.900 | 06:32:36.901 | 90,001 giây |

Lỗi lưu trong DB: `Luồng phản hồi gateway bị gián đoạn; không tự phát lại task.` Không thấy FE tự chạy lại hai lần trong cùng lượt; đây là hai lượt gặp cùng giới hạn. Source có timeout 90.000 ms tại cả proxy upstream và cấu hình provider OpenCode. Bằng chứng xác định giới hạn phía Worker; chưa chứng minh gateway/provider hoàn toàn không có lỗi khác.

Settings của hai lượt chọn `teamExecution=sequential`, thời gian toàn lượt 10 phút. Plan phụ thuộc BA → FE → DEVOPS → TEST; chỉ đổi chế độ chạy vẫn không khiến chuỗi này song song. Mini Notes dùng LocalStorage, không có backend nên không tạo task BE là hợp lý.

BA có báo cáo khoảng 4.700–4.800 ký tự trong `runs.value.tasks[].summary`, không bị mất. Tuy nhiên Board chỉ hiển thị công việc tổng và handoff thông thường cắt summary còn 1.800 ký tự.

## Thay đổi

- Proxy và provider OpenCode dùng thời gian từ settings của lượt thay cho giới hạn 90 giây. Controller tiếp tục áp dụng deadline tuyệt đối cho toàn lượt, gồm tất cả task/công cụ. Không tự replay task sau lỗi.
- Phân biệt timeout không nhận dữ liệu với lỗi luồng/network; ghi thời gian và model trong lỗi.
- Board/Danh sách hiện các task con theo role, trạng thái, tiêu chí và phụ thuộc. Bấm task mở đúng task/attempt. Không nhân bản công việc trong DB.
- Tab Yêu cầu có toàn bộ phân công, acceptance và phạm vi của từng agent.
- Tab Tài liệu BA đọc báo cáo đã lưu theo lần thực hiện, bao gồm lượt thất bại và các attempt cũ. Hiển thị Markdown/bảng, cho tải `.md`; Xuất hồ sơ JSON kèm nội dung BA và tham chiếu run/task. Không cần migration hoặc cấp quyền ghi source cho BA.
- BA giữ tối đa 6.000 ký tự summary ở mức handoff đầu tiên; tổng packet vẫn giới hạn 32.000 ký tự và báo truncation khi phải thu gọn. Task triển khai tiếp tục dùng bản tóm tắt ngắn. BA contract được chuyển theo cả phụ thuộc gián tiếp.
- Cập nhật Lead/BA profile: yêu cầu đầu ra, bước làm, acceptance rõ ràng; mô hình field/type/constraint, storage/API contract, giả định. Chỉ tạo dependency thật; FE/BE có thể cùng phụ thuộc BA nếu scope độc lập. Không tạo role không cần thiết.

## Sử dụng

1. Khởi động lại Worker với bản build mới. Công việc → Board/Danh sách để xem từng task.
2. Mở công việc → Yêu cầu để đọc phân công; Tài liệu BA để xem và tải thiết kế, chọn lần thực hiện khi cần.
3. Để chạy song song: Cài đặt → Thực thi nhóm → Hai task độc lập · workspace riêng, lưu trước lượt mới. Chế độ này cần Git repo có commit và source sạch. Task có dependency vẫn chờ đầu ra được tích hợp; tối đa hai task có scope độc lập cùng chạy.
4. Các lượt cũ giữ plan/settings/output gốc. Profile mới áp dụng cho lượt mới, không tự viết lại plan cũ hoặc chạy lại yêu cầu người dùng.

## Kiểm chứng

- Typecheck, kiểm tra định dạng và build production: pass.
- Bộ test Node: 267/267 pass, gồm timeout stream/request, chặn replay, projection Board, giữ BA contract và xuất hồ sơ từ SQLite.
- Electron acceptance `agent-tasks-ui`: Board/Danh sách → đúng task inspector → yêu cầu chi tiết → tài liệu BA ở lượt lỗi → tải Markdown; kiểm tra layout tại 1366×768, 850×700 và zoom 150%.
- Electron acceptance `work-detail-ui` và `board-ui` bảo vệ luồng hồ sơ, focus, form và layout hiện có.
- Không gọi model/provider thật hoặc tự chạy lại Mini Notes; không coi mô phỏng gateway là bằng chứng provider đã ổn định.
