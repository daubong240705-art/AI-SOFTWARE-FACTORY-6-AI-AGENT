# Agent runtime và quản lý worker

Runtime Phase 5 đã phát hành lên production ngày 04/11/2026. Kết quả hiện hành ở [nghiệm thu Phase 5](phase-5-completion.md); các số liệu probe dưới đây là mốc phát triển riêng, không phải nghiệm thu dự án mẫu Phase 6.

## Sử dụng trong dashboard

Admin mở **Agent & worker** (`/admin/agents`) để đăng ký thiết bị, chọn capability BE/FE/TEST/DEVOPS, xem heartbeat/lease đang chạy, đổi token hoặc thu hồi quyền. Danh sách phân trang và tự cập nhật 15 giây. Online nghĩa là poll/heartbeat trong 120 giây gần nhất; không đồng nghĩa thiết bị đã vượt kiểm tra model.

Token đăng ký/rotate chỉ trả một lần; lưu trong file root-owned 0600 ngoài repo. UI không lưu token vào localStorage; tải lại hoặc ẩn token sẽ không thể đọc lại. Rotate vô hiệu hóa token cũ; revoke vô hiệu hóa mọi request tiếp theo. Worker đang chạy mất heartbeat sẽ dừng container. Công việc có thể được recovery bằng worker khác, tùy deadline, ngân sách và số lần phục hồi còn lại.

Trang này hiển thị catalog model do quản trị cấu hình và hướng dẫn/công cụ theo role. Model theo từng role được chọn ở cấu hình dự án. Run lưu snapshot model, kỹ năng/version/hash và giới hạn tại thời điểm tạo; thay đổi cấu hình sau đó không sửa snapshot run cũ. TEST/DEVOPS hiện là bộ thực thi theo quy tắc, chưa gọi model đã cấu hình cho hai role này.

## Giới hạn model

- `ASF_CODING_MODEL_REQUESTS=8`: mặc định mã nguồn; production đặt 12. Giới hạn request thực sự từ proxy ra gateway trên một lease coding.
- `ASF_CODING_MODEL_ALLOWANCE=60000`: mặc định mã nguồn; production đặt 90000. Đây là ngân sách cho một grant; cấp ít hơn nếu run không còn đủ ngân sách. Không cấp lease mới nếu còn dưới 5.000.
- `ASF_CODING_MODEL_OUTPUT_TOKENS=1000`: clamp output mỗi request. Không cho nhiều completion (`n > 1`).
- Mỗi execution có token proxy random, origin HTTPS và model cố định. Child container không nhận API key thật; parent giữ key. Token hết hiệu lực khi proxy kết thúc.
- Trước khi gửi, dự phòng số byte JSON + 1.024 + output. Khi có usage đáng tin cậy từ gateway, thay charge dự phòng bằng input + output được báo. Response thiếu usage hoặc giao nhận lỗi giữ reservation bảo thủ. Model usage trong report ghi rõ unknown bằng null.
- Request vượt quota trả 403 để CLI không retry một quota cố định; request bận trả 429. Không có HTTP retry tự động ở proxy. Sandbox vẫn có timeout/resource/output limits.
- Lease mất kết nối giữ charge cũ; recovery nhận reservation mới trong ngân sách còn lại. Giới hạn call của run đếm reservation của orchestrator, không phải số request bên trong OpenCode; execution report có `physical_requests` riêng.

Đây không phải cam kết token hóa đơn của provider. Gateway có thể thêm context, retry hoặc route alias sang model khác; cần quota ở gateway nếu muốn giới hạn thanh toán tuyệt đối. Byte estimate có thể chặn sớm hơn tokenizer thực tế. Usage do worker quản trị báo về, không phải chứng thực chống worker bị chiếm quyền. Model/call budget không thay việc quản trị thiết bị.

## Probe model từ parent

Dùng Linux/WSL2 có Docker và image `asf-worker:opencode-1.19.5-rg1`, từ checkout/venv của worker. Đặt `NINE_ROUTER_API_KEY`, `ASF_ROUTER_URL`, `ASF_ROUTER_CA_FILE`, `ASF_WORKER_WORKSPACES` trong environment của parent từ file riêng; không đặt key vào command line hay repo. Với systemd, có thể dùng cùng cấu hình đã có của service; chạy probe riêng khi worker không có task.

```sh
.venv/bin/python -m workers.probe --model coding-main
```

Probe tạo workspace tổng hợp, gọi OpenCode thật qua proxy, yêu cầu tìm/đọc/sửa file, kiểm tra container không chứa provider key/socket và chạy unittest tin cậy trong container network none. JSON report chỉ đạt khi code, tool search/read/edit, kiểm tra sandbox và test đều đạt. Exit code 0 là đạt, 1 là thất bại; lỗi không xác định không được báo thành công. Dùng `--requests 1` để kiểm tra chặn quota; kết quả này dự kiến thất bại, số request ra gateway không vượt 1.

Probe không tạo run, không ghi GitLab/OpenProject, không tự thêm model vào allowlist. Đây là bài kiểm tra năng lực nhỏ; không chứng minh model hoàn thành mọi dự án. Dashboard hiện hiển thị catalog, chưa có nút chạy probe từ xa.

## Kiểm chứng của mốc này

54 backend tests trên PostgreSQL/Redis riêng; Ruff/mypy; frontend lint/typecheck và production build đạt. Chromium qua BFF thật đã chạy đăng ký → rotate → revoke, ẩn token/tải lại, desktop 1440px/mobile 390px không tràn trang và không có page error. Ảnh desktop (`phase-5-screenshots/agent-workers.png`, ảnh local), mobile (`phase-5-screenshots/agent-workers-mobile.png`, ảnh local).

BE/FE smoke bằng OpenCode thật sửa đúng file với 4/7 request, charge 11.335/22.722 token theo usage gateway. Đây là hai task tổng hợp độc lập, không phải lần chạy lại toàn chuỗi PM → deploy trên image cuối. Thử mặc định cũ 20.000 đã bị chặn sau 2 request vì context/tool schema; giữ kết quả thất bại làm evidence và tăng grant mặc định lên 60.000. Runtime vẫn bị chặn tiếp theo ngân sách run.

Probe hiện hành đạt với **5 request**, read/edit/glob đều có event completed, **10 lần kiểm tra sandbox**, unittest exit0. Thử ép trần1 request dừng đúng sau1 request với `execution_model_quota_exceeded`. Image worker mới có ripgrep13, sửa lỗi `ripgrep execution failed` của glob/grep ở image cũ. [Evidence JSON](agent-runtime-evidence.json) ghi kết quả và hash source; image probe được build bằng một layer ripgrep trên image bootstrap đã có, chưa phải CI release của ứng dụng.

## Phạm vi tiếp theo

Chưa triển khai loader skill từ repo/task, shell tùy ý hoặc quyền SSH cho agent. Profile lệnh lint/build được pin, browser/API acceptance theo sản phẩm và quản trị integration profile bằng UI là phần mở rộng tiếp theo. Kết quả migration/rollback schema 0004 và chuỗi trên image production được ghi riêng trong [nghiệm thu Phase 5](phase-5-completion.md).
