# Vận hành Phase 5

URL: <https://asf.lazy.local>. Hướng dẫn nền về Caddy, DNS, tài khoản và backup tại [vận hành v0.1](operations-v0.1.md). Trạng thái phát hành và kết quả kiểm chứng hiện hành tại [nghiệm thu Phase 5](phase-5-completion.md).

## Sử dụng

1. Admin tạo dự án và chọn kết nối đã được cấu hình. Profile `validation` chỉ dành cho repo tổng hợp GitLab 10 và OpenProject 7.
2. Chọn model cho PM/BA/BE/FE từ catalog. Run mới lưu cố định cấu hình model, kỹ năng và giới hạn; thay đổi dự án không sửa run cũ.
3. Tạo run live, đọc plan/spec và duyệt đúng phiên bản/hash. Run mô phỏng không gọi model.
4. Worker thực hiện BE/FE, chạy bộ test tin cậy. TEST lỗi tạo Bug và cho một vòng sửa có giới hạn. Xem execution, log kiểm tra và liên kết bên ngoài ngay trong run.
5. Đọc diff, kết quả test và CI trước khi duyệt release. Quyết định gắn chính xác SHA/pipeline/job; DEVOPS chỉ hoàn tất khi artifact và health đã triển khai khớp.

Chưa cấu hình integration thì run dừng tại `waiting_integration`; không coi là đã code/deploy. TEST/DEVOPS thực thi theo quy tắc. Alias `coding-main` được gateway định tuyến; không khẳng định upstream model nếu gateway không cung cấp thông tin.

## Worker VM60

Service `asf-coding-worker.service`, mã tại `/opt/asf-worker/agent`, Python tại `.venv/bin/python`, cấu hình `/etc/asf-worker/agent.env` root0600. Worker dùng HTTPS outbound đến ASF; không cần DB/Redis/GitLab/deploy token. Provider key chỉ có ở parent. Image sandbox `asf-worker:opencode-1.19.5-rg1` phải tồn tại trước khi chạy.

```sh
sudo systemctl status asf-coding-worker.service
sudo systemctl restart asf-coding-worker.service
sudo journalctl -u asf-coding-worker.service --since '15 minutes ago'
```

Admin quản lý đăng ký/đổi token/thu hồi ở **Agent & worker → Worker**. Token hiển thị một lần; thay token trong file riêng rồi restart service. Không đăng token vào issue/chat/log. Poll gần nhất dưới 120 giây được hiển thị online; online không chứng minh model đã vượt probe.

VM60 có 2CPU/6GB và runner concurrency1. Tránh chạy coding nặng cùng job build image. Với máy cá nhân, dùng Linux/WSL2 + Docker, CA và cùng giao thức outbound; phải truy cập được DNS/HTTPS qua LAN hoặc NetBird. Chưa nghiệm thu reboot VM hoặc thiết bị cá nhân thực tế. Mỗi thiết bị đăng ký token riêng; không chia sẻ token VM60.

Production đặt ngân sách run 200.000 và grant coding90.000, vẫn tối đa 12 request/lượt, output 1.000/request và 6 lượt cấp cho run. Mặc định mã nguồn là 100.000/60.000 và 8 request/lượt. Grant phải đủ cho usage đã dùng cộng dự phòng theo byte của request kế tiếp; không đồng nghĩa sẽ tiêu hết grant. Cấu hình `ASF_RUN_TOKEN_BUDGET` trong release-base env và `ASF_CODING_MODEL_ALLOWANCE` trong integration env chỉ áp dụng run mới. Run đã tạo giữ nguyên snapshot và charge của lần lỗi; retry không xóa lịch sử hoặc cộng thêm ngân sách.

## Cấu hình dự án mới

Operator tạo repo, pipeline/test baseline và đích staging của sản phẩm. Cấp bot theo đúng repo/project, tạo profile root-owned trong `/etc/asf-control/integrations.json` rồi restart API và workflow-worker. Profile xác định repo/branch, OpenProject, đường dẫn được sửa, test profile, job CI/package/deploy và health URL. Không dùng bot/admin token của dự án tổng hợp để mở rộng quyền tùy ý.

Bản hiện tại hỗ trợ Python unittest hoặc Node test không cài dependency tùy ý. Các lệnh build/lint/browser theo sản phẩm cần bổ sung profile và kiểm chứng riêng. Agent không được sửa CI/deploy hay test baseline đã pin. Template sản phẩm/Mini Helpdesk và benchmark thuộc mốc tiếp theo đã tách khỏi Phase 5.

## Phát hành và rollback

Push/MR chỉ chạy backend/frontend checks. Sau merge protected `main`, tạo pipeline với `BUILD_RELEASE=1`; chờ check/image/package đạt rồi play `deploy_control`. Wrapper host xác minh SHA hiện tại, pipeline/job, checksum và image revision. Luôn backup off-host trước migration.

Host policy `/etc/asf-control/deploy.json` cho schema `0004_agents`. Compose và wrapper root-owned được cài riêng, không nhận đường dẫn/lệnh tùy ý từ CI. API/workflow-worker tải bot/profile từ integration env; provider key không cấp cho API.

`sudo /usr/local/sbin/asf-rollback` kiểm tra **schema DB thực tế** và `supported_schemas` của previous. Khi quay về bridge `a2d7d16` trên DB0004: API/dashboard hoạt động ở chế độ đọc, thao tác ghi trả503, auth vẫn dùng được; dispatcher/workflow-worker dừng. Không downgrade/restore DB. Chạy wrapper lần nữa để trở lại Phase 5, kiểm tra health và các service. Dừng/đợi hết run active và dừng coding worker trước thao tác rollback; bật lại sau khi Phase 5 healthy.

Không thể quay thẳng về image v0.1 cũ chỉ nhận0003 khi DB đã0004. Nếu previous không tương thích, wrapper từ chối. Giữ image current/previous và manifest; không chạy global prune trên máy dùng chung.

## Backup và giới hạn

Backup timer/off-host receiver giữ quy trình v0.1. Phục hồi thử vào DB riêng cùng PostgreSQL17, đối chiếu revision và dữ liệu; không thử restore đè live. Secret/profile/config cần bản sao mã hóa riêng của operator.

Worker là thiết bị quản trị tin cậy: thiết bị bị chiếm quyền có thể báo cáo sai local test. Sandbox giảm quyền của mã/model, không biến host worker thành thiết bị không cần tin cậy. Ngân sách proxy giới hạn request/output và charge bảo thủ khi thiếu usage; không thay quota thanh toán ở gateway.
