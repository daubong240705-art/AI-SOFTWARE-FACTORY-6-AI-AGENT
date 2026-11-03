# AI Software Factory

Nền tảng self-hosted điều phối sáu role PM, BA, BE, FE, TEST, DEVOPS. **Phase 2** bổ sung API run, RQ worker, LangGraph checkpoint PostgreSQL, plan/spec PM/BA và phê duyệt theo phiên bản. BE/FE/TEST/DEVOPS chưa thực thi. Dashboard hiện quản lý project; giao diện run/phê duyệt và đăng nhập ở Phase 3.

## Chạy dev bằng Docker

Yêu cầu Docker Engine/Desktop Linux và Compose v2. Chạy từ repo root:

```sh
cp .env.example .env
docker compose --env-file .env -f infrastructure/docker/compose.dev.yml up --build -d
```

PowerShell dùng `Copy-Item .env.example .env` cho lệnh đầu. Giá trị mẫu chỉ dành cho dev; mật khẩu custom trong URL cần percent-encode ký tự đặc biệt và cập nhật đồng bộ DB/API. Không dùng credential dev cho staging/production.

- Dashboard: <http://localhost:13000>
- OpenAPI: <http://localhost:18000/docs>
- Liveness: `/healthz`; readiness DB/Redis/migration: `/readyz`.
- PostgreSQL `localhost:54329`, Redis `localhost:56379`; mọi published port **chỉ bind loopback**. Chưa mở dashboard/API ra LAN/Internet vì đăng nhập được triển khai ở Phase 3.

Compose tự chạy Alembic và migration checkpoint trước API. Dispatcher đọc outbox trong PostgreSQL rồi đưa job vào Redis/RQ; workflow worker chạy một job mỗi lần. Named volume giữ dữ liệu khi restart/down. `docker compose ... down -v` xóa dữ liệu dev; không dùng để restart thông thường. RQ worker yêu cầu Linux; trên Windows dùng Compose/VM/WSL2.

```sh
docker compose --env-file .env -f infrastructure/docker/compose.dev.yml logs -f api dashboard
docker compose --env-file .env -f infrastructure/docker/compose.dev.yml down
```

## Phát triển API và dashboard ngoài container

Cài Python 3.12, `uv` và Node 22. Tạo `.env` như trên rồi:

```sh
docker compose --env-file .env -f infrastructure/docker/compose.dev.yml up -d postgres redis
uv sync --frozen
uv run alembic upgrade head
uv run python -m orchestrator.checkpoints
uv run uvicorn asf_api.main:app --host 127.0.0.1 --port 18000 --no-access-log
```

Terminal khác:

```sh
cd apps/dashboard
npm ci
npm run dev -- --port 13000
```

Next.js proxy gọi API từ server bằng `API_INTERNAL_URL` (mặc định `http://127.0.0.1:18000`), không đưa URL database/token vào client. Next.js chạy thư mục riêng; muốn đổi endpoint khi chạy ngoài Compose, nạp `API_INTERNAL_URL` trong shell hoặc file `.env.local` tại `apps/dashboard` (đã ignore).

Hai terminal Linux khác chạy `uv run python -m workers.dispatcher` và `uv run python -m workers.main`. Chỉ chọn một cách chạy worker: Compose hoặc ngoài container, dùng cùng DB/Redis/queue.

## API hiện có

| Method | URL | Công dụng |
|---|---|---|
| POST | `/api/projects` | Tạo project: `name`, `slug`, `description`, `repository_url` tùy chọn |
| GET | `/api/projects?limit=20&offset=0` | Danh sách phân trang |
| GET | `/api/projects/{uuid}` | Xem project |
| GET | `/healthz` | Tiến trình API hoạt động |
| GET | `/readyz` | DB, Redis và migration đúng revision |

Slug trùng trả 409; input sai 422; không tìm thấy 404. Error envelope có `error.code`, `error.message`, `request_id`; không echo input. Repository chỉ nhận HTTP/HTTPS không credential/query/fragment.

## Workflow Phase 2

| Method | URL | Công dụng |
|---|---|---|
| POST | `/api/projects/{id}/runs` | `requirement`, `mode`: `mock` mặc định hoặc `live` |
| GET | `/api/projects/{id}/runs` | Danh sách phân trang |
| GET | `/api/runs/{id}` | Run, task, artifact/version/hash, approval và usage |
| GET | `/api/runs/{id}/events?after=0&limit=50` | Lịch sử DB, cursor theo event ID |
| POST | `/api/runs/{id}/approval` | Quyết định gắn `spec_version`, `spec_hash`, `decision`, `actor`, `comment`, `idempotency_key` UUID |
| POST | `/api/runs/{id}/retry` | Retry failed/rejected, yêu cầu `comment` |
| POST | `/api/runs/{id}/cancel` | Hủy và chặn kết quả worker cũ, yêu cầu `comment` |
| GET | `/api/roles` | Ma trận quyền và vai trò đã/chưa triển khai |

Luồng: `created → planning → waiting_approval → running → waiting_integration`. Chỉ một run active toàn nền tảng; trạng thái chờ duyệt vẫn giữ slot. Reject giữ lịch sử, retry tạo spec version mới. Retry lỗi kỹ thuật tiếp tục checkpoint/version cũ. Không tự duyệt; chỉ quyết định đã lưu đúng version/hash mới mở gate. **`waiting_integration` là ranh giới chưa có development, không phải completed/deployed.**

Các thao tác workflow chỉ bật ở `ASF_ENVIRONMENT=development/test`, loopback. `actor` là danh tính tự khai báo cho audit dev, chưa phải người dùng đã xác thực. Không dùng API này như approval có phân quyền production.

Mặc định chạy mock, không tốn token và artifact/event có `simulated=true`. Muốn gọi 9Router thật: trong `.env` đặt `ASF_LIVE_MODE_ENABLED=true`, nạp `ASF_ROUTER_API_KEY` và chọn `mode=live`. Compose chỉ đưa key vào worker; API/frontend không nhận key. `caddy-root.crt` được mount read-only và xác minh TLS; chạy worker ngoài Compose đặt `ASF_ROUTER_CA_FILE` về cert này. Có thể đổi gateway/model qua `ASF_ROUTER_URL`/`ASF_ROUTER_MODEL`; không đưa credential vào URL. Sau đổi config chạy lại Compose để recreate service.

Giới hạn mặc định: 2 HTTP attempt/node, timeout 60 giây, output 2.000 token/call; 6 call và 100.000 token allowance/run, 2 retry người dùng. Mỗi HTTP attempt giữ budget trước khi gửi; usage chưa biết vẫn giữ allowance để tránh gọi lại không giới hạn. Token thực dùng do gateway trả được lưu; không tự tính tiền khi thiếu giá. Allowance là guard cục bộ, không thay quota cứng ở provider. Các giá trị cấu hình nằm trong `.env.example`.

Worker mất kết nối: lease 45 giây, tối đa 2 redelivery tự động sau lần đầu; quá giới hạn run failed. Outbox vẫn còn khi Redis lỗi. Artifact đã lưu được tái sử dụng nếu checkpoint chưa kịp ghi; crash sau gửi HTTP trước khi lưu có thể gọi model lại, nhưng mỗi attempt đều bị tính vào budget. Cancel không thu hồi request HTTP đang gửi; kết quả muộn không được ghi thành artifact.

## Kiểm tra

```sh
uv run ruff check apps/api shared agents integrations orchestrator workers infrastructure/migrations tests
uv run mypy
uv run pytest -m "not integration"
cd apps/dashboard
npm run lint
npm run typecheck
npm run build
```

Chỉ chạy integration trên DB dev dùng riêng, đã migrate, không DB đang có dữ liệu sản xuất:

```sh
# Linux/macOS; PowerShell: $env:ASF_INTEGRATION_TEST='1'
ASF_INTEGRATION_TEST=1 ASF_QUEUE_NAME=asf-test uv run pytest -m integration
```

Migration: `uv run alembic current`, `uv run alembic upgrade head`, rồi `uv run python -m orchestrator.checkpoints`. Alembic quản lý public schema; LangGraph quản lý schema `asf_checkpoints`. Dừng dispatcher/worker trước downgrade. `downgrade base` **xóa dữ liệu**, chỉ kiểm chứng trên DB disposable. Không dùng `Base.metadata.create_all()` thay migration.

## Lộ trình và hạ tầng

- [Lộ trình code hiện hành](plan/lo-trinh-code-v0.md)
- [Kết quả Phase 1](docs/phase-1-completion.md)
- [Kết quả Phase 2](docs/phase-2-completion.md)
- [Kiểm kê hạ tầng](docs/infra-inventory.md), [worker .60](docs/worker-bootstrap-2026-11-04.md)
- `.14` dành cho bản staging sau Phase 4; kiểm chứng hiện tại chạy stack dev riêng trên `.60`.
- Không có API key/mật khẩu hạ tầng trong code, image hoặc frontend. Gateway key chỉ nạp lúc chạy worker; GitLab/OpenProject dùng identity giới hạn quyền ở phase tích hợp sau.
