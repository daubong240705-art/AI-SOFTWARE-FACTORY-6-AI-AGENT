# Vận hành ASF v0.1

## Truy cập và thành phần

URL `https://asf.lazy.local`: DNS → Caddy `.51` → dashboard/BFF `.14:18100` → API. Health `/healthz`, `/readyz` đi API `.14:18101`. Máy khách phải tin CA nội bộ `caddy-root.crt`. NetBird sử dụng subnet route hiện có và DNS nội bộ; cần kiểm tra từ client ngoài LAN riêng.

Project GitLab: <https://gitlab.lazy.local/ai-factory/ai-software-factory>. Runner project `asf-ci-vm60` trên `.60`, Docker executor, concurrency 1, không privileged/socket. Job chính giới hạn 3 GiB/1.8 CPU; mỗi service 512 MiB/0.4 CPU. Tránh chạy coding worker nặng cùng CI khi `.60` thiếu RAM.

`.14` chạy Compose project `asf-control`, cấu hình root-owned `/opt/asf-control/compose.yml`; env/key trong `/etc/asf-control` quyền root. DB/Redis không publish port. Firewall chỉ cho Caddy `.51` vào port ứng dụng từ LAN, không flush rules của stack khác. Giới hạn RAM steady 2.5625 GiB (migration tạm thêm 256 MiB), CPU steady 2.6 (migration thêm 0.3).

## Phát hành

1. Push branch, tạo MR vào protected `main`; backend/frontend/build/package phải đạt. Không push trực tiếp main.
2. Maintainer merge MR; đợi pipeline **main** hoàn tất check/build/package.
3. Chạy manual job `deploy_control` trên đúng main SHA hiện tại. CI chuyển duy nhất SHA/pipeline/job ID qua SSH forced-command; `.14` xác minh GitLab, checksum, image config ID và OCI revision trước load image. Không build trên deploy host.
4. Mở `/healthz` xác nhận `release_sha`, `/readyz`, rồi đăng nhập. Audit tại `/opt/asf-control/deploy-audit.jsonl`; marker `current`, `previous` và `releases/<SHA>/manifest.json`.

Registry chưa bật: image archive + checksum/manifest là artifact GitLab, hạn 14 ngày. Image đã load trên `.14` vẫn còn sau hạn artifact; GitLab artifact không phải backup lâu dài. Hiện giữ tất cả release/image ASF trên host để bảo toàn rollback. Theo dõi dung lượng trước mỗi release; chỉ xóa image ASF cũ sau khi xác nhận không thuộc current/previous và giữ tối thiểu ba release thành công. Không dùng `docker system prune` trên máy dùng chung.

Cấu hình Compose/wrapper là quyền quản trị host, không lấy tùy ý từ artifact. Khi thay đổi file vận hành, quản trị viên review và cài bản mới root-owned trước release. GitLab variables `ASF_DEPLOY_KEY`, `ASF_DEPLOY_KNOWN_HOSTS` là protected file, scope production. Read-only GitLab token trên host hết hạn 03/11/2027, cần rotate trước hạn; token không cấp cho API/dashboard/worker.

## Kiểm tra và restart

SSH vào `.14`, sudo root, nạp SHA hiện tại:

```sh
export RELEASE_SHA="$(cat /opt/asf-control/current)"
docker compose --project-name asf-control --env-file /etc/asf-control/release-base.env -f /opt/asf-control/compose.yml ps
docker compose --project-name asf-control --env-file /etc/asf-control/release-base.env -f /opt/asf-control/compose.yml logs --tail 80 api dispatcher workflow-worker dashboard
```

Restart từng service bằng cùng prefix Compose + `restart <service>`. Với toàn stack, dùng maintenance window rồi `down`/`up -d` **không `-v`**; named volumes giữ DB/Redis. Không đưa nội dung env, token, dump hoặc browser storage state vào issue/commit. `/healthz` xác minh SHA, `/readyz` kiểm tra DB/Redis/migration. Session hết hạn mặc định 8 giờ.

Tạo admin khôi phục bằng Compose `exec api python -m asf_api.manage --username <ten-moi> --role admin`, nhập password qua prompt; sau đó khóa tài khoản mất quyền qua UI. Không có mật khẩu mặc định. Secret model chỉ cấp cho workflow worker, không vào frontend/API hay CI. Live mode chỉ gọi PM/BA ở v0.1.

## Backup và phục hồi

`sudo /usr/local/sbin/asf-backup` trên `.14` tạo `pg_dump -Fc` toàn DB (gồm user/session/approval/checkpoint), checksum SHA-256 rồi chuyển SSH forced-command tới `.60:/srv/asf-backups`. Local giữ 7 bản; receiver giữ 7 bản mới nhất và tối đa 4 tuần. Timer `asf-backup.timer` chạy 02:30 theo timezone máy chủ, trễ ngẫu nhiên tối đa 5 phút; kiểm tra `timedatectl`, `systemctl list-timers asf-backup.timer`, `journalctl -u asf-backup.service`.

`.60` phải bật và có mạng; backup thất bại cần xử lý ngay. RPO mục tiêu 24 giờ chỉ đúng khi timer thành công; RTO chưa benchmark. Backup DB chưa bao gồm secret/config, cần sao lưu riêng bằng kho mã hóa của quản trị viên. Không commit dump/env/private key.

Phục hồi trước tiên vào PostgreSQL disposable cùng major 17, không publish port, không mount volume live. Đối chiếu checksum metadata ở `.14`, dùng `pg_restore --exit-on-error --no-owner` vào DB rỗng; kiểm tra migration revision, project/run/artifact/approval/user/session/checkpoint và auth. Chỉ cắt sang DB phục hồi trong maintenance window sau khi đối chiếu dữ liệu; không restore đè live để thử. Xóa đúng container/volume disposable sau kiểm chứng.

## Rollback

`sudo /usr/local/sbin/asf-rollback` trên `.14`: khóa deploy, xác nhận schema hai release bằng nhau, bắt buộc backup off-host, kích hoạt image previous và health check rồi đổi marker current/previous. Không downgrade schema/restore DB tự động. Hai schema khác nhau cần review compatibility và phương án migration riêng. Dữ liệu mới vẫn giữ nguyên. Có thể chạy wrapper lần nữa để quay lại release vừa rời, sau kiểm chứng. Khi release health thất bại, deploy wrapper tự kích hoạt previous nếu đã có previous; xem audit và logs trước thử lại.

## Quyền và giới hạn

Viewer chỉ đọc; approver tạo project/run và quyết định gate; admin thêm quản lý tài khoản. Quyền toàn workspace, chưa có phân quyền từng project/SSO/MFA. Approval gắn version/hash và session thật. Smoke ghi rõ synthetic/mock; không tự phê duyệt yêu cầu nghiệp vụ thật. BE/FE/TEST/DEVOPS, GitLab/OpenProject adapters và coding worker protocol tiếp tục Phase 5. Mini Helpdesk/template/full e2e ở Phase 6.
