# Worker linh hoạt: máy cá nhân hoặc VM server

Cập nhật 03/11/2026 theo yêu cầu người dùng. **Không bắt buộc có một VM server cố định hoặc bật 24/7**. Cần một môi trường Linux cô lập vượt S4/S7; vị trí đặt môi trường đó có thể thay đổi.

## 1. Lựa chọn phù hợp

| Phương án | Phù hợp | Điều kiện |
|---|---|---|
| Máy cá nhân + VM Linux riêng | Khuyến nghị khi muốn tận dụng PC và tách dữ liệu cá nhân | Hyper-V/VMware/VirtualBox; có đường LAN/NetBird tới dịch vụ; máy phải bật khi chạy job |
| Máy cá nhân + WSL2 distro riêng + container Linux | Tiết kiệm tài nguyên, thuận tiện phát triển trên Windows | Tắt automount ổ Windows và interop trong distro sandbox; không dùng chung home/credential dev cá nhân; nghiệm thu Docker executor/network |
| VM Linux trên server | Job chạy ổn định cả khi PC tắt | Provision VM, disk/backup/monitoring và network như một node worker |

Docker Desktop/WSL2 một mình không có nghĩa job được cách ly khỏi toàn bộ dữ liệu máy cá nhân. Không mount ổ Windows, home, SSH agent, credential hệ điều hành, hoặc socket Docker của host vào coding/job container. Chỉ mount workspace cần thiết và secret ngắn hạn theo role. Docker daemon do runner quản lý ở ngoài job; không cấp daemon đó cho code sinh ra.

Không chạy worker trên `.12/.13/.14/.51`. Nếu cần mức cách ly mạnh hoặc phải xử lý mã ngoài kiểm soát, ưu tiên VM Linux riêng có thể reset snapshot hơn WSL distro tích hợp sâu với desktop.

## 2. Cấu hình cấp cho môi trường worker

| Mức | CPU | RAM | SSD trống/đĩa ảo | Khả năng dự kiến |
|---|---:|---:|---:|---|
| Tối thiểu | 2 vCPU | 4 GiB | 40–60 GiB | 1 job nhẹ; bootstrap/coding cơ bản, chưa đáp ứng demo BE/FE đồng thời |
| Khuyến nghị MVP | 4 vCPU | 8 GiB | 80 GiB | Tối đa 2 job nhẹ chia sẻ budget; điều tiết CI/build khi cần RAM |
| Build/e2e nhiều | 6–8 vCPU | 12–16 GiB | 100–150 GiB | BE/FE cùng build hoặc Playwright; đo tải trước khi nâng concurrency |

Các con số là tài nguyên **cấp cho guest/WSL**, không phải tổng máy cá nhân. PC có tổng RAM 16 GiB có thể cấp khoảng 6–8 GiB nếu các ứng dụng khác còn đủ RAM; PC 24–32 GiB thuận tiện hơn cho hai job và IDE/browser. Chưa đo cấu hình PC hiện tại nên chưa kết luận chạy hai job nặng ổn định.

Không cần GPU vì model chạy qua 9Router. Dùng Ubuntu Server 24.04 LTS amd64, Docker Engine/Compose, Git, CA certificates, GitLab Runner; Node 22/Python 3.12/OpenCode nằm trong image worker đã pin. VM không cần GUI. Giữ trống tối thiểu 15–20 GiB trong guest; giới hạn BuildKit cache 8–12 GB và thực hiện bảo trì có kiểm soát.

## 3. Kết nối và điều phối

Thiết kế đề xuất, **chưa được implement trong repo**:

1. Orchestrator, DB và queue quản trị nằm cố định trên `.14`. Coding worker trên PC đăng ký `worker_id`, capability và số slot qua API HTTPS, sau đó tự lấy job. Không cho PC truy cập thẳng Redis/PostgreSQL.
2. GitLab Runner tự poll GitLab bằng project-scoped token. Worker cần truy cập GitLab HTTPS, Git SSH (hoặc Git HTTPS), Orchestrator và 9Router qua LAN/NetBird. Không mở cổng từ Internet vào PC.
3. Mỗi job có lease/heartbeat, timeout, branch/worktree riêng, task/run ID và artifact gắn SHA. Worker reconnect giữ danh tính nhưng không tự nhận lại job chưa đối chiếu checkpoint.
4. Khi PC sleep/tắt/mất mạng: đánh dấu worker offline, giữ job mới chờ. Job đang chạy hết lease thành interrupted; reconcile commit/artifact trước retry để không tạo MR trùng. Deployment/merge không được replay tự động.
5. Khi chuyển sang VM server, đăng ký worker mới và drain worker PC. Không phải chuyển control plane hay đổi repo, workflow và pipeline contract.

Nên dùng API HTTPS có scope project cho worker, token khác token deploy; kết quả worker không tự quyết định merge/deploy. Giữ một nơi duyệt trên control plane.

## 4. Nghiệm thu trước khi dùng thật

- Từ host và container: DNS nội bộ đúng, TLS tin Caddy CA, NetBird subnet tới được dịch vụ; không dùng `-k` hoặc tắt SSL verification.
- OpenCode sửa file đúng, file diff hợp lệ; CI lint/test/build có artifact trên SHA đã khai báo.
- Container không privileged, không socket/secret deploy, không đọc thư mục cá nhân; CPU/RAM/pids/timeouts có tác dụng.
- Thử mất kết nối và khởi động lại: không mất state, không replay tác vụ có side effect.
- Demo BE/FE song song cần tổng hai slot thật, có thể trên một worker hoặc hai máy khác nhau. Một PC một slot vẫn dùng được để bootstrap nhưng chưa đạt yêu cầu demo song song.

**Lựa chọn hiện tại:** hỗ trợ worker máy cá nhân trước, giữ cùng image và giao thức để chuyển sang VM server khi cần chạy liên tục. Chưa tự cài VM/WSL/runner trên máy người dùng trong bước bảo trì này.
