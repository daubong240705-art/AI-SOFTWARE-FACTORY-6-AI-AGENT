# Phase 4 — Triển khai ASF v0.1

Phạm vi V0-P4-01…07 trong [lộ trình code](../plan/lo-trinh-code-v0.md), ngày 04/11/2026 (Asia/Saigon).

## Phát hành và cách triển khai

URL: <https://asf.lazy.local>. Repo private: <https://gitlab.lazy.local/ai-factory/ai-software-factory>. GitHub `origin` giữ nguyên; remote `gitlab` dành cho CI/deploy nội bộ. Main protected, không direct push, merge cần pipeline đạt; shared runners tắt. Runner project ID 4 `asf-ci-vm60` dùng Docker executor trên `.60`, concurrency 1. Job chính 3 GiB/1.8 CPU, PG/Redis CI mỗi service 512 MiB/0.4 CPU. Đã kiểm tra container thực tế không privileged, không Docker socket/config runner trong job.

Builder Kaniko fork được pin digest, không cần privileged hay daemon socket. GitLab Registry chưa bật; dùng image archive theo full commit SHA, OCI revision, derived config image ID, manifest pipeline/schema và SHA256SUMS. Archive chỉ load sau đối chiếu toàn bộ danh tính; deploy host không build. Artifact GitLab giữ 14 ngày; image release đã load giữ trên `.14`, chưa tự prune. Phương án này không thay cấu hình Registry đang dùng chung GitLab.

Compose `asf-control` tách network/volume/port khỏi ứng dụng hiện có; DB/Redis không publish. API/dashboard/dispatcher/worker chạy non-root, hạn chế capabilities, read-only root filesystem. Tổng RAM steady 2.5625 GiB; migration thêm 256 MiB. Runtime model key chỉ nằm workflow worker; API/dashboard/CI không nhận. Bí mật, deployment identity và Compose root-owned bên ngoài repo.

Caddy `.51` dùng TLS nội bộ và ACL đã có; DNS do người dùng tạo. Port `.14:18100/18101` được firewall giới hạn source `.51`, giữ nguyên rule và container của ứng dụng khác. Mọi API browser đi qua Next BFF để giữ Origin/CSRF/session; SSE không buffer.

Deployment identity SSH chỉ chấp nhận `deploy <full SHA> <pipeline ID> <job ID>`. Wrapper xác minh current protected main, các job bắt buộc thành công và deploy job đang chạy; token chỉ read_api của external Reporter riêng project. Manual deploy trên main, protected file variables scope production, audit JSONL và marker current/previous. Đã thử lệnh shell tùy ý và bị từ chối.

## Kiểm chứng runtime

Đã hoàn thành V0-P4-01…07. Release đang chạy: **`12928ef64d6fc92ef1893c3a948d3573a3483c0c`**; [pipeline main #94](https://gitlab.lazy.local/ai-factory/ai-software-factory/-/pipelines/94), deploy job #211 thành công. Release trước `f6725047f097c245afc7469a75ff278d9d879203`, pipeline #89, deploy job #205. Hai MR !1/!2 đã merge qua protected main sau pipeline đạt. Commit tài liệu/evidence tạo sau release không thay đổi image đang chạy.

- Backend **34 tests** với PostgreSQL/Redis thật; Ruff, mypy, migration/checkpoint và `alembic check` đạt. Frontend lint/typecheck/build, Kaniko build hai image, package checksum/identity đạt. Cả hai pipeline main phát hành đều thành công.
- Chromium riêng xác minh TLS, không bỏ qua chứng chỉ; Next BFF/API qua Caddy đạt. Cookie Secure/HttpOnly/SameSite=Lax, Origin sai và thiếu CSRF bị từ chối 403. Port trực tiếp `.14:18100/18101` từ `.60` bị chặn, từ Caddy `.51` trả 200; DB/Redis không publish.
- Dashboard HTTPS: login, tạo synthetic project/run, PM/BA mock, xem plan/spec; reject v1 → retry v2 → approve có xác nhận version/hash → `waiting_integration`; viewer không có nút ghi và API cancel trả 403. SSE offline/reconnect không trùng event. Desktop 1440px/mobile 390px không tràn ngang, không có lỗi runtime browser.
- Worker production gọi `coding-main` qua 9Router thật: PM 208/337 token input/output, BA 547/444, hai artifact không simulated. Run synthetic dừng ở `waiting_approval`, không tự approve nội dung model; sau kiểm chứng đã cancel để giải phóng slot.
- Full Compose `down`/`up` chỉ stack ASF, giữ named volume. Cookie cũ còn dùng được; mock run giữ 4 artifact v1/v2, 2 quyết định có session thật, 13 event và timeline replay. Sau hai lần chuyển release, kiểm tra lại phiên/dữ liệu đạt.
- Backup toàn DB bằng `pg_dump -Fc` chuyển `.14` → `.60`, checksum receiver xác nhận. Restore vào PostgreSQL 17 disposable, network none, không volume live: schema `0003_auth`, 1 project, 2 run, 6 artifact, 2 approval, 2 model call, 2 user/session; schema `asf_checkpoints` có 14 checkpoint/33 writes/3 blobs. Xác minh password scrypt admin và session cũ trên dữ liệu phục hồi đạt. Container tạm đã xóa.
- `asf-backup.timer` đã enabled sau backup/restore đạt, chạy 02:30 UTC (09:30 Việt Nam) với jitter tối đa 5 phút. `.60` phải online; kiểm tra log timer thường xuyên.
- Diễn tập administrator rollback `12928ef` → `f672504` → `12928ef`, cùng schema `0003_auth`, backup off-host bắt buộc trước mỗi lần và health SHA đạt. Không downgrade/restore đè DB. Marker cuối giữ release mới, audit lưu cả hai lần chuyển.
- Runtime ASF: tổng hard limit **2.5625 GiB RAM / 2.6 CPU**; bốn tiến trình ứng dụng non-root/read-only, không Docker socket/privileged. Model key chỉ có ở workflow worker. `.14` còn khoảng 41–42 GB sau load hai release.
- 10 container Safe School/Portainer cũ giữ nguyên thời điểm khởi động, đang chạy. Hai container ITCare dừng lúc 02:20 ngày 04/11 trước deploy ASF; người dùng xác nhận chủ động dừng và yêu cầu giữ nguyên. Không restart/recreate/xóa các container cũ.

Bằng chứng đã lọc secret ở [phase-4-evidence.json](phase-4-evidence.json); ảnh sau restart (`phase-4-screenshots/after-restart.png`, ảnh local), mobile (`phase-4-screenshots/mobile.png`, ảnh local). Không commit credential/cookie/dump/browser storage state. Admin bootstrap lưu ngoài repo tại máy người vận hành, `C:\Users\ADMIN\.asf\production-admin.json`, thư mục ACL giới hạn ADMIN/SYSTEM/Administrators.

Trong lần deploy đầu đã phát hiện và sửa: CRLF ở script chuyển từ Windows (thêm `.gitattributes` LF), Docker containerd trả manifest digest tại `.Id` (so sánh config bytes sau `docker image save`), YAML tmpfs có dấu phẩy chưa quote. Wrapper chặn các lần lỗi trước khi báo release healthy; bản sửa đã vào MR !2 và release cuối. Dịch vụ dữ liệu ASF được giữ nguyên, không ảnh hưởng stack khác.

## Vận hành và giới hạn

[Runbook](operations-v0.1.md) mô tả phát hành, kiểm tra, restart, tạo admin khôi phục, backup/restore và rollback ứng dụng. Backup đầy đủ DB chuyển sang `.60`, độc lập deploy host; worker phải online. Backup secret/config cần lưu riêng bằng kho mã hóa. Chưa benchmark RTO; mục tiêu RPO 24 giờ phụ thuộc timer thành công. Token read_api hết hạn 03/11/2027 cần rotate.

Kiểm chứng HTTPS từ LAN không đồng nghĩa đã thử client NetBird ngoài LAN; phần đó cần thiết bị remote thật. Bốn role BE/FE/TEST/DEVOPS vẫn hiển thị chưa triển khai, run sau gate dừng `waiting_integration`. Tích hợp GitLab/OpenProject và coding worker thuộc Phase 5; template/Mini Helpdesk/full e2e thuộc Phase 6.
