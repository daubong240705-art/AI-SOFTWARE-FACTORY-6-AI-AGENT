# Worker .60 — sẵn sàng bắt đầu code nền tảng

Hoàn tất kiểm tra ngày **04/11/2026**, Asia/Saigon. Người dùng cấp VM và quyền SSH để xử lý dung lượng, chuẩn bị worker; chưa yêu cầu bắt đầu viết ứng dụng trong lượt này.

> Cập nhật sau bootstrap: Phase 1–4 đã được triển khai theo [lộ trình mới](../plan/lo-trinh-code-v0.md). Runner `.60` đã đăng ký project ASF và chạy pipeline thật, builder không privileged/socket; [kết quả Phase 4](phase-4-completion.md) ghi trạng thái mới. Các mục “còn thiếu” phía dưới giữ bối cảnh trước khi code, không phải checklist hiện tại.

## 1. Dung lượng đã sửa

Đĩa `/dev/sda` đã là **60 GiB**; `/dev/sda3` chiếm gần 58 GiB. Không thiếu disk ở hypervisor và không cần mở partition. Volume group `ubuntu-vg` còn 29 GiB chưa cấp; root LV mới là 29 GiB.

Đã lưu metadata bằng `vgcfgbackup` vào `/root/ubuntu-vg-before-asf-expand.vg`, rồi chạy:

```sh
lvextend --resizefs --extents +100%FREE /dev/ubuntu-vg/ubuntu-lv
```

Root LV đã tăng **29 → 58 GiB**, ext4 resize online, không reboot/cài lại. `df` hiển thị filesystem khoảng 57 GiB; phần còn lại dành cho `/boot` và metadata. Sau cài Docker, tải image và smoke test còn khoảng **45 GiB khả dụng** (giá trị byte chính xác trong evidence).

Backup LVM chỉ chứa metadata, không phải backup dữ liệu. Không thu nhỏ filesystem để hoàn tác thao tác mở rộng.

## 2. Phần đã chuẩn bị

- OS đang cài: **Ubuntu 26.04 LTS x86_64**; không đổi sang 24.04 vì không cần thiết cho bước bootstrap đã kiểm chứng.
- CPU 2 vCPU; Linux báo 5408 MiB RAM (~5.28 GiB), swap 4 GiB. Ngân sách một job một lần; chưa xác minh nguyên nhân chênh với cấu hình RAM danh nghĩa 6 GB ở hypervisor.
- CA Caddy đã cài system store; DNS AdGuard `.50` đang phân giải đúng GitLab/9Router. HTTPS host và container đều trả 200, không bỏ kiểm tra TLS.
- Docker 29.1.3, Compose 2.40.3, Buildx 0.30.1; Docker service enable/active. Log rotation 10 MB × 3 và builder GC target 8 GB, DNS container `.50`.
- Image `asf-worker:opencode-1.19.5`: Python 3.12.16, Node 22.23.4, OpenCode 1.19.5; user không phải root. Không phụ thuộc Python 3.14.4 của host.
- GitLab Runner **19.3.1**, cùng minor với GitLab 19.3.1, tải binary chính thức và so SHA-256 manifest; service enable/active, global concurrency 1. **Chưa có registration/token/repo**, nên chưa có runner online mới trên GitLab.
- User runner có quyền Docker daemon để quản lý job trên VM chuyên dụng, không thuộc nhóm sudo. Quyền này không được chuyển vào job qua Docker socket.

File/trạng thái đặt tại `/opt/asf-worker`, `/etc/docker/daemon.json`, `/etc/gitlab-runner/config.toml`, `/etc/gitlab-runner/certs/gitlab.lazy.local.crt`. Không lưu gateway key trong các file này.

## 3. Bài kiểm tra thực tế

Đã chạy [script smoke Linux](../spikes/worker_linux_smoke.py) trên `.60`:

1. File `app.py` ban đầu tính phép trừ thay vì phép cộng; test fail được xác nhận trước sửa.
2. OpenCode qua 9Router đọc/sửa file thật thành `return a + b` trong workspace riêng.
3. Ba test số dương/số âm/hỗn hợp chạy độc lập đều pass; CLI exit 0; tổng vòng sửa/kiểm tra khoảng 16.73 giây.
4. Container coding non-root UID 10001, root filesystem read-only, không Docker socket, không thấy runner config; chỉ mount workspace và test read-only, không mount home host.
5. Container test tắt network và không nhận API key. Container coding được giới hạn 1.5 CPU, 3 GiB RAM, 256 pids; không privileged, drop ALL capabilities, no-new-privileges. Credential chỉ qua runtime stdin/environment; container tự xóa sau chạy.

[Evidence JSON](evidence/worker-bootstrap-2026-11-04.json) lưu image manifest, phiên bản, dung lượng và kết quả probe; không chứa token.

## 4. Khi nào bắt đầu code

**Có thể bắt đầu code Phase 1 ngay bây giờ**: scaffold repo, FastAPI, DB/Redis dev, schemas, LangGraph checkpoint và các role stub. Phát triển local hoặc trên worker `.60`, một job mỗi lần.

Phần chưa đạt để mở coding/CI/deploy tự động đầu-cuối:

- Tạo repo/project ASF và bot hạn chế quyền; đăng ký runner `.60` đúng project/group với Docker executor, không socket/privileged.
- Pipeline thật chạy lint/test/JUnit trên SHA của MR và xác nhận job nằm trên `.60`.
- Registry/image builder phù hợp, private egress allowlist, permission/path policy cho coding thật và recovery khi worker mất kết nối.
- OpenProject bot write spike, webhook, staging/deploy gate, smoke/rollback theo Phase 0 còn lại.

Không tuyên bố M0/S4 đã hoàn tất từ việc cài runner service. S7 **bài sửa code + test cơ bản trong Linux đã pass**; các acceptance về egress/recovery và thực thi toàn workflow còn chờ. Chưa thử reboot VM để xác minh toàn bộ service sau reboot.

Yêu cầu BE/FE chạy đồng thời trong demo vẫn cần đo tải hai job hoặc thêm worker máy cá nhân. VM 2 vCPU/6 GB hiện đủ bắt đầu, không chặn scaffold/control plane.
