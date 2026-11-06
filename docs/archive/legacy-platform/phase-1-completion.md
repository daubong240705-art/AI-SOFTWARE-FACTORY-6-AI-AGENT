# Phase 1 — Khung ứng dụng đã hoàn thành

Ngày kiểm chứng: **04/11/2026**, Asia/Saigon. Phạm vi theo [lộ trình code v0](../plan/lo-trinh-code-v0.md), V0-P1-01 đến V0-P1-06.

## Chức năng đã có

- Monorepo FastAPI/Python 3.12 và Next.js/TypeScript/Node 22, dependency lockfile, Dockerfile runtime non-root.
- Compose dev PostgreSQL 17, Redis 7, migration một lần trước API, healthcheck API/dashboard và named volume giữ dữ liệu. Tất cả published port bind `127.0.0.1`.
- Schema `projects`, `runs`, `tasks`, `events`; foreign key, unique slug/event key, timestamp, cờ simulated mặc định false. Run/task/event mới là nền dữ liệu cho Phase 2.
- API tạo project, danh sách phân trang và chi tiết; validation, lỗi chuẩn có request ID, log JSON có che credential, liveness/readiness kiểm tra DB/Redis/revision.
- Dashboard danh sách/tạo project, trạng thái dịch vụ, loading/empty/error và sáu role ghi rõ chưa triển khai. Next.js proxy gọi API từ server, không đưa cấu hình DB vào client.
- Các thư mục orchestrator/agents/integrations/workers có mô tả ranh giới phase; không có workflow giả được báo là đã chạy.

## Kết quả kiểm chứng

| Kiểm tra | Kết quả |
|---|---|
| Ruff và mypy strict backend | Pass |
| Pytest với PostgreSQL/Redis thật qua SSH tunnel | **6 passed**, gồm 2 integration test |
| Dashboard ESLint, TypeScript, production build trên Windows | Pass |
| Build image API và dashboard trên Linux `.60` | Pass |
| Compose `up -d --wait` | PostgreSQL, Redis, API, dashboard healthy; migrate exit 0 |
| Alembic schema parity | `No new upgrade operations detected` |
| Upgrade → downgrade → upgrade | Pass trên DB disposable `asf_migration_check`, đã xóa DB kiểm chứng riêng |
| Tạo/list qua dashboard HTTP proxy | 201/200; slug trùng 409, pagination sai 422, Origin khác 403 |
| Compose down → up, giữ volume | Project còn nguyên qua API và dashboard proxy |
| Tắt/bật Redis | Readiness API và proxy trả 503 khi mất Redis, phục hồi 200 |
| Dependency audit dashboard | Runtime: 0; toàn bộ dev dependency: 16 moderate, 0 high/critical |
| Secret scan | Không có mật khẩu hạ tầng, token hiện dùng hoặc private key trong file đưa vào commit |

[Evidence JSON](../../evidence/phase1-project-check.json) ghi ID bản ghi kiểm chứng và kết quả. Pytest hiện có một cảnh báo deprecation của Starlette TestClient/httpx; không ảnh hưởng kết quả. Các cảnh báo audit moderate thuộc chuỗi công cụ ESLint; chưa dùng `npm audit fix --force` vì đề xuất thay phiên bản không tương thích. Cần rà lại khi nâng dependency.

**Chưa xác nhận giao diện bằng mắt hoặc thao tác form trong trình duyệt:** công cụ Computer Use bị dừng vì không xác minh được URL Chrome hiện tại. Đã kiểm tra production build, HTML 200 và các route proxy bằng HTTP thật; không coi đây là nghiệm thu visual, mobile hay e2e.

## Stack dev trên worker

- Máy: `lazy@192.168.1.60`; thư mục `/home/lazy/asf-phase1-dev`.
- Compose project: `asf-phase1-check`; stack dev riêng, không deploy lên `.14`.
- Dashboard `.60:13000`, API `.60:18000`, DB `.60:54329`, Redis `.60:56379` chỉ nghe loopback. Một project kiểm chứng được giữ để xem lại persistence.
- Muốn xem dashboard từ máy cá nhân, mở tunnel trong terminal riêng:

```sh
ssh -N -L 13000:127.0.0.1:13000 lazy@192.168.1.60
```

Sau đó mở <http://localhost:13000>. Không lưu mật khẩu trong lệnh hoặc repo. Dừng/chạy stack trên `.60` bằng:

```sh
cd /home/lazy/asf-phase1-dev
sudo docker compose -p asf-phase1-check --env-file .env -f infrastructure/docker/compose.dev.yml down
sudo docker compose -p asf-phase1-check --env-file .env -f infrastructure/docker/compose.dev.yml up -d --wait
```

Không thêm `-v` nếu cần giữ dữ liệu. Hướng dẫn dựng lại từ repo và chạy các check có trong [README](../../../README.md).

## Ranh giới tiếp theo

Chưa đăng nhập/phân quyền, chưa gọi model, chưa xử lý run/approval/queue, chưa tích hợp ghi GitLab/OpenProject. Runner `.60` chưa đăng ký; chưa có pipeline phát hành. Chưa mở URL LAN/NetBird hoặc deploy staging trên `.14`.

Bắt đầu **Phase 2: run, state machine, job queue/checkpoint, PM/BA và approval**. Auth/UI vận hành ở Phase 3; deploy ASF v0.1 ở Phase 4. Template và thực nghiệm dự án mẫu giữ ở Phase 6 theo yêu cầu.
