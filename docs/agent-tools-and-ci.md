# Công cụ agent và pipeline phát triển ASF

## Năng lực agent cần bổ sung

Bản đang phát triển ở nhánh Phase5 đã chạy smoke tổng hợp qua sáu role; production vẫn v0.1. PM/BA gọi model để tạo JSON có schema; control plane đồng bộ OpenProject. BE/FE dùng OpenCode với read/edit trong sandbox; không có shell hoặc công cụ tìm kiếm chuyên dụng. TEST chạy bộ test tin cậy cố định; DEVOPS do control plane kiểm tra GitLab/artifact/health theo quy tắc. Chưa có registry/loader skill theo role: thêm SKILL.md vào repo sẽ không tự làm runtime có kỹ năng mới. Các skill của Codex trên máy người vận hành cũng không tự chuyển sang agent ASF.

Bộ bổ sung tối thiểu nên triển khai sau mốc staging:

| Role | Hướng dẫn cần có | Công cụ cần bổ sung |
|---|---|---|
| PM | Chia phạm vi, phụ thuộc, definition of done, ghi rõ giả định/câu hỏi | Đọc tài liệu và work package liên quan trong đúng project; tạo/cập nhật qua adapter hạn quyền hiện có |
| BA | User story/AC, tình huống lỗi, hợp đồng API/dữ liệu, truy vết yêu cầu | Đọc OpenAPI/schema và tài liệu kiến trúc phiên bản cố định; ghi spec có schema/version/hash |
| BE | Quy ước stack, migration/API, xử lý lỗi và dữ liệu nhạy cảm | Tìm kiếm mã; chạy các lệnh lint/test/build được quản trị cấu hình sẵn trong sandbox |
| FE | Quy ước UI, loading/error/empty, responsive/accessibility, tích hợp API | Tìm kiếm mã; lint/typecheck/build trong sandbox; Playwright/screenshot trên staging được phép |
| TEST | Chuyển AC thành test, hồi quy, report có evidence, tái hiện Bug | pytest/unittest và bộ test Node theo profile; HTTP/API checks; Playwright UI trong môi trường riêng |
| DEVOPS | CI/release, health/rollback, log/metrics, xử lý thất bại | Đọc job/log/artifact và health; gọi deploy/rollback qua wrapper giới hạn, vẫn theo release gate |

Ưu tiên trước: (1) quota vật lý và thống kê mỗi request model; (2) hướng dẫn có version theo role + context dự án; (3) code search và lệnh kiểm tra sandbox; (4) kiểm thử browser/API và quản lý worker/model. Search và lệnh kiểm tra giải quyết thiếu hụt thực tế lớn hơn việc nạp hàng chục skill chung chung.

Skill nên là nội dung hướng dẫn có version, đầu vào/đầu ra và tiêu chí hoàn tất rõ ràng; tool là hành động được cấp quyền và kiểm tra riêng. Registry do quản trị viên duyệt, snapshot vào run cùng model; repository/task được coi là dữ liệu chưa tin cậy. Không tự chạy chỉ dẫn trong repo. Không cấp SSH root, GitLab PAT hoặc Docker socket cho coding agent. Lệnh kiểm tra chạy theo profile cụ thể, có timeout/resource/output limit và không nhận shell fragment tùy ý từ model. Test/CI tin cậy độc lập tiếp tục xác minh kết quả, không chỉ tin báo cáo do model tự viết.

Đây là đề xuất cho mốc phát triển tiếp theo, chưa triển khai quyền hoặc runtime skill mới trong thay đổi pipeline này.

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
