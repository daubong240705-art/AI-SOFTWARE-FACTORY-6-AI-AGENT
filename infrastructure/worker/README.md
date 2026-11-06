# Worker Linux .60

VM đã bootstrap ngày 04/11/2026 (Asia/Saigon), IP `192.168.1.60`. Xem [kết quả và mức sẵn sàng](../../docs/worker-bootstrap-2026-11-04.md).

Image chứa Python 3.12, Node 22 và OpenCode 1.19.5, user UID/GID 10001. Dockerfile là nguồn của image đã thử trên Linux. Copy đúng ba file `Dockerfile`, `.dockerignore`, `caddy-root.crt` vào một build context riêng trước build; không dùng toàn repo làm context.

```sh
docker build -t asf-worker:opencode-1.19.5-rg1 /opt/asf-worker/build-context
```

Host Docker administrator/runner manager quản lý container. Không mount socket vào job. Chạy coding job với `--user 10001:10001`, root filesystem read-only, drop capabilities, no-new-privileges, CPU/RAM/pids limits, workspace riêng và home/tmp dạng tmpfs. Runtime coding hiện giữ API key thật ở parent; container chỉ nhận token proxy tạm cho một execution. Test container không có model credential và dùng network none. Bài spike bên dưới là evidence bootstrap lịch sử; dùng [probe hiện hành](../../docs/archive/legacy-platform/agent-runtime.md) để kiểm tra runtime proxy.

Hai base image hiện dùng tag major/minor cho bootstrap; image manifest thực tế đã lưu trong evidence. Trước pipeline release cần pin base image digest và quản lý cập nhật có kiểm soát. Không dùng tag mutable làm bằng chứng cùng build giữa hai thời điểm khác nhau.

Smoke test trên host:

```sh
sudo python3 /home/lazy/asf-worker-bootstrap/worker_linux_smoke.py
```

Script hỏi key qua stdin nếu chưa có môi trường, không lưu key. Bản nguồn trong repo: [worker_linux_smoke.py](../../spikes/worker_linux_smoke.py). Kiểm tra trước fail, CLI sửa file, sau đó ba test pass trong container không mạng, không model key. Không coi bài probe này là nghiệm thu đầy đủ GitLab CI, egress allowlist hoặc recovery.

GitLab Runner 19.3.1 đã đăng ký project ASF và repo validation, `concurrent=1`. Khi đăng ký thêm project dùng scoped runner authentication token; dùng Docker executor, `privileged=false`, không khai báo Docker socket/host filesystem trong job volumes. Không đăng ký vào instance shared runner pool hoặc dùng shell executor. Token phải được nạp qua môi trường bảo mật, không thêm vào file version control.
