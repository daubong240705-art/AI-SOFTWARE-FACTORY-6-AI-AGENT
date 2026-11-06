# Lưu trữ tài liệu kế hoạch cũ

Các tài liệu trong thư mục này **không còn là kế hoạch hiện hành**. Chúng được giữ để tra cứu lịch sử quyết định, bằng chứng và bối cảnh. Link bên trong đã được sửa theo vị trí mới (07/11/2026).

| Thư mục | Nội dung | Đã được thay bởi |
|---|---|---|
| `legacy-architecture/` | Kiến trúc 6 agent và Factory Lite + Windows Worker MVP ban đầu | [docs/architecture](../architecture/) |
| `plan/` (README, lo-trinh-code-v0, phase-0..5) | Kế hoạch nền tảng self-hosted Python (đã phát hành v0.1, vẫn chạy trên `.14`) | Nền tảng giữ đóng băng; vận hành xem [docs/operations-v0.2.md](../operations-v0.2.md) |
| `plan/windows-worker/`, `plan/v1.1/`, `plan/v1.2/`, `plan/v1.3/`, `plan/agent-upgrade/`, `plan/experience-loops/` | Kế hoạch Windows Worker V1 (đã triển khai tới 1.3.0-alpha.8) | Bàn giao V1 ở [docs/windows-worker](../windows-worker/) |
| `plan/worker-v2/` | Thiết kế Worker V2 trước khi hợp nhất | [plan/factory-v2](../../plan/factory-v2/README.md), rồi [docs/architecture](../architecture/) |

Tài liệu hiện hành:
- Kiến trúc và quyết định: [docs/architecture/00-decision-register.md](../architecture/00-decision-register.md)
- Kiến trúc mục tiêu: [docs/architecture/05-target-architecture.md](../architecture/05-target-architecture.md)
- Roadmap: [docs/architecture/06-implementation-roadmap.md](../architecture/06-implementation-roadmap.md)
- Kế hoạch Factory V2 (nền đã triển khai F0–F1-01): [plan/factory-v2](../../plan/factory-v2/README.md)

## Bổ sung 07/11/2026 (đợt dọn thứ hai)

| Thư mục | Nội dung | Ghi chú |
|---|---|---|
| `windows-worker/` | Bàn giao và kế hoạch Windows Worker V1.x (WW-2..4, UX-01..08, R0..R6, V1.1..V1.3, bằng chứng JSON) | Chỉ còn `docs/windows-worker/navigation-labels.md` và `source-cleanup-audit.md` ở vị trí cũ vì README V1 còn dùng |
| `legacy-platform/` | Tài liệu và bằng chứng nền tảng self-hosted Python (phase 1–5, vận hành v0.1, agent runtime, kế hoạch triển khai) | Runbook còn dùng ở vị trí cũ: `docs/infra-inventory.md`, `docs/operations-v0.2.md`, `docs/phase-5-completion.md`, `docs/worker-bootstrap-2026-11-04.md`, `docs/adr/` |
| `research/agent-upgrade/` | Nghiên cứu nâng cấp agent V1 | |
