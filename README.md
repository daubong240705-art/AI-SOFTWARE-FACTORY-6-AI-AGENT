# Factory V2

Nền tảng điều phối đội agent AI (Multi-Team AI Platform): người dùng giao việc cho Lead, các đội agent làm trong worktree Git riêng, người dùng duyệt kết quả. Chạy trên một máy Linux (hoặc WSL), giao diện web.

## Thành phần

| Thư mục | Nội dung |
|---|---|
| `apps/factory-host` | Host (Node 22, TypeScript, Fastify, SQLite): lệnh, sự kiện, điều phối attempt, workflow, tài liệu, runtime OpenCode và Codex/Claude CLI cục bộ |
| `apps/factory-ui` | Giao diện web (React, Vite, Tailwind, shadcn/ui) |
| `packages/factory-contracts` | Hợp đồng dùng chung (zod): lệnh, sự kiện, mô hình dữ liệu |
| `packs/` | Gói đội: `software-team`, `research-team`, `architecture-team`, `design-team` (hồ sơ, kỹ năng, workflow) |
| `scripts/factory-v2` | Cài công cụ ghim, triển khai, khởi động Host thật, bộ trích xuất tài liệu |
| `docs/architecture` | Kiến trúc, quyết định, kế hoạch các mốc (00 đến 15) |
| `docs/ui`, `design/`, `plan/`, `schema/`, `research/` | Thiết kế giao diện, kế hoạch và tham chiếu của V2 |

## Chạy

- Chạy dự án thực tế: [docs/factory-v2-real-run.md](docs/factory-v2-real-run.md)
- Chuyển sang Arch Linux: [docs/factory-v2-arch.md](docs/factory-v2-arch.md)
- Tham số và API của Host: [apps/factory-host/README.md](apps/factory-host/README.md)
- Kiến trúc tổng thể: [docs/architecture/05-target-architecture.md](docs/architecture/05-target-architecture.md)

## Lịch sử

Các phiên bản trước (Windows Worker V1 và nền tảng web Python với Docker, PostgreSQL, dashboard Next.js) đã được gỡ khỏi nhánh chính. Toàn bộ mã nguồn cũ còn trong lịch sử Git: tag `v1-final`, xem bằng `git checkout v1-final`.
