# AI Software Factory

Nền tảng self-hosted điều phối sáu role PM, BA, BE, FE, TEST, DEVOPS. **Phase 1** cung cấp FastAPI, dashboard Next.js, PostgreSQL/Redis, migration và quản lý project. Chưa thực thi Agent, run workflow hoặc đăng nhập; dashboard hiển thị rõ trạng thái chưa triển khai.

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

Compose tự chạy `alembic upgrade head` trước API. Named volume giữ dữ liệu khi restart/down. `docker compose ... down -v` xóa dữ liệu dev; không dùng để restart thông thường.

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
uv run uvicorn asf_api.main:app --host 127.0.0.1 --port 18000 --no-access-log
```

Terminal khác:

```sh
cd apps/dashboard
npm ci
npm run dev -- --port 13000
```

Next.js proxy gọi API từ server bằng `API_INTERNAL_URL` (mặc định `http://127.0.0.1:18000`), không đưa URL database/token vào client. Next.js chạy thư mục riêng; muốn đổi endpoint khi chạy ngoài Compose, nạp `API_INTERNAL_URL` trong shell hoặc file `.env.local` tại `apps/dashboard` (đã ignore).

## API hiện có

| Method | URL | Công dụng |
|---|---|---|
| POST | `/api/projects` | Tạo project: `name`, `slug`, `description`, `repository_url` tùy chọn |
| GET | `/api/projects?limit=20&offset=0` | Danh sách phân trang |
| GET | `/api/projects/{uuid}` | Xem project |
| GET | `/healthz` | Tiến trình API hoạt động |
| GET | `/readyz` | DB, Redis và migration đúng revision |

Slug trùng trả 409; input sai 422; không tìm thấy 404. Error envelope có `error.code`, `error.message`, `request_id`; không echo input. Repository chỉ nhận HTTP/HTTPS không credential/query/fragment. Schema run/task/event được chuẩn bị cho Phase 2, chưa có API thực thi hoặc báo cáo giả.

## Kiểm tra Phase 1

```sh
uv run ruff check apps/api shared infrastructure/migrations tests
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
ASF_INTEGRATION_TEST=1 uv run pytest -m integration
```

Migration: `uv run alembic current`, `uv run alembic upgrade head`. `downgrade base` **xóa bốn bảng và dữ liệu**, chỉ để kiểm chứng trên DB disposable. Không dùng `Base.metadata.create_all()` thay migration.

## Lộ trình và hạ tầng

- [Lộ trình code hiện hành](plan/lo-trinh-code-v0.md)
- [Kết quả Phase 1](docs/phase-1-completion.md)
- [Kiểm kê hạ tầng](docs/infra-inventory.md), [worker .60](docs/worker-bootstrap-2026-11-04.md)
- `.14` dành cho bản staging sau Phase 4; kiểm chứng hiện tại chạy stack dev riêng trên `.60`.
- Không có API key/mật khẩu hạ tầng trong code, image hoặc frontend. Các token tích hợp chỉ được bổ sung theo scope trong phase sau.
