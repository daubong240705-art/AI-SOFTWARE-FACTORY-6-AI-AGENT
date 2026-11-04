# Công cụ agent và pipeline phát triển ASF

## Năng lực agent hiện có

Nhánh Phase 5 có hướng dẫn tích hợp cho sáu role, version và SHA256; snapshot vào run cùng model và giới hạn coding. PM/BA nhận hướng dẫn này khi tạo JSON có schema. BE/FE nhận hướng dẫn trong prompt và được dùng read/edit/glob/grep trong OpenCode. TEST chạy baseline tin cậy; DEVOPS xác minh CI/artifact/approval/health theo quy tắc. Đây là registry nội bộ được review trong source; thêm SKILL.md vào repo dự án không tự cấp thêm kỹ năng hoặc quyền. Skill của Codex trên máy người vận hành không tự chuyển sang ASF.

Worker dùng proxy model riêng từng execution. API key thật ở parent; container chỉ nhận token tạm. Proxy cố định origin HTTPS/model, giới hạn request vật lý ra gateway, output và ngân sách dự phòng. Mặc định 8 request, 60.000 đơn vị token, tối đa 1.000 output token/request; grant luôn bị chặn tiếp theo ngân sách còn lại của run. Run lưu nguyên cấu hình lúc tạo; đổi cấu hình không đổi run cũ. Lease mất kết nối giữ reservation cũ, recovery nhận grant mới trong phần ngân sách còn lại. Usage có từ gateway được ghi nhận; usage thiếu hoặc lỗi giao nhận giữ charge bảo thủ. Xem [chi tiết vận hành và evidence](agent-runtime.md).

Đây là trần số request rời worker và tham số output; không cam kết số token hóa đơn của nhà cung cấp nếu gateway tự thêm context, retry hoặc gọi model khác. Dự phòng prompt dùng số byte JSON + 1.024 + output, thay bằng usage được gateway báo khi có. Vì vậy có thể từ chối sớm hơn số token thực. Giới hạn call của run đếm lượt reservation/call của orchestrator; `physical_requests` trong execution đếm request OpenCode rời worker. Alias `coding-main` không chứng minh upstream model cố định.

Trang **Admin → Agent & worker** cho đăng ký, xem heartbeat/lease/capability, đổi và thu hồi token, cùng catalog model/kỹ năng/giới hạn hiện hành. Token chỉ trả một lần, không lưu ở localStorage. Chọn model từng role ở cấu hình dự án. Công cụ probe model chạy từ parent tin cậy, không tự thêm alias vào allowlist.

Phần tiếp theo: profile lint/build có lệnh cố định và dependency được pin; browser/API acceptance theo dự án; probe từ dashboard và quản lý profile qua UI. Những quyền này chưa được cấp cho coding agent. Không cấp SSH root, GitLab PAT hay Docker socket vào sandbox.

## Pipeline ASF đơn giản hơn

Pipeline gốc trước đây chạy backend checks → frontend checks (có next build) → image API → image dashboard (next build lần nữa) → đóng gói, trên runner concurrency1. Vì vậy mỗi push, kể cả cập nhật tài liệu, đều phải chờ hai image và đóng gói archive.

Pipeline mới có hai cách chạy, dùng chung một YAML và giữ nguyên các job mà host deploy đang xác minh:

| Khi nào | Job tự chạy | Build image / artifact |
|---|---|---|
| Push branch, MR hoặc push main thông thường | backend_checks + frontend_checks | Không |
| Chủ động Run pipeline với BUILD_RELEASE=1 | Hai checks + image_api + image_dashboard + package_images | Có, gắn đúng SHA/pipeline |
| Release trên current protected main | Như trên, sau đó deploy_control thủ công | Deploy qua wrapper hiện có |

Backend vẫn chạy Ruff/mypy, toàn bộ bộ test hiện hành trên PostgreSQL/Redis riêng, migration và schema check. Frontend thường ngày chỉ lint/typecheck; next build chạy trong Docker build khi đóng gói release. Lỗi chỉ xuất hiện ở production build sẽ được phát hiện tại release pipeline, không phải mọi push. Thay đổi UI lớn có thể chủ động chạy release pipeline ở branch để kiểm tra build trước merge; không có job production deploy trên branch.

Cache tải dependency UV và npm theo lockfile, không cache node_modules hoặc dùng cache thay lockfile. Cold cache vẫn phải tải; warm cache giúp lần sau. Không hứa thời gian cụ thể trước khi đo trên runner. Không tăng concurrency vì VM60 chỉ2CPU/6GiB. Chưa đổi cơ chế image archive/Registry, không bật privileged/Docker socket và không sửa policy/schema production.

Cách phát hành: merge vào main → **Build > Pipelines > New pipeline**, chọn main, đặt **BUILD_RELEASE=1** → đợi check/build/package đạt → bấm deploy_control sau khi review chính sách schema. Mặc định BUILD_RELEASE=0; push/merge thông thường không tạo release. Host vẫn yêu cầu đủ năm job check/image/package thành công cùng pipeline, nên pipeline check nhanh không thể deploy trực tiếp.
