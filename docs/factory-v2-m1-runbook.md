# Factory V2 · M1 runbook (Host + Lead chat + UI)

Trạng thái: kỹ thuật M1 xong, **chờ người dùng dùng thử 2–3 ngày** (điều kiện chuyển M2, roadmap §M1). V1 không bị đụng.

## Chạy

```bash
# 1. Windows (mỗi lần đổi mã): build và test Host, contracts, UI
cd apps/factory-host && npm test
cd ../factory-ui     && npm test && npm run build

# 2. WSL: copy bản build sang ext4 (KHÔNG chạy từ /mnt/<ổ>: chậm hơn 20 giây và WAL không an toàn)
bash /mnt/e/GIT/AI-SOFTWARE-FACTORY-6-AI-AGENT/scripts/factory-v2/deploy-host-wsl.sh

# 3. WSL: chạy Host (key chỉ nằm trong môi trường của tiến trình này)
export NODE_EXTRA_CA_CERTS=$HOME/factory-v2/ca/caddy-root.crt
export NINE_ROUTER_API_KEY=...      # không có key: Host vẫn chạy, Lead báo "chưa cấu hình model"
FACTORY_STATE_DIR=$HOME/factory-v2/state FACTORY_PORT=8787 \
  node $HOME/factory-v2/app/apps/factory-host/dist/main.js
```

Host in ra một **token khởi tạo dùng một lần**. Mở `http://127.0.0.1:8787/`, dán token, tạo Project (đường dẫn dạng `/srv/factory/workspaces/<tên>`), mở tab Chat. Khởi động lại Host cấp token mới; dữ liệu giữ nguyên, phiên đăng nhập thì không.

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `FACTORY_STATE_DIR` | `~/factory-v2/state` | DB và sao lưu trước migration. Từ chối đường dẫn `/mnt/...` |
| `FACTORY_PORT` | `8787` | Chỉ bind 127.0.0.1 |
| `FACTORY_BACKUP_DIR` | `/mnt/d/factory-backup` (nếu có ổ D), không thì `<state>/backups/periodic` | **Sao lưu định kỳ** (mỗi giờ và khi tắt). Không bao giờ trùng thư mục state |
| `FACTORY_BACKUP_INTERVAL_MINUTES` | `60` | 1–1440 |
| `FACTORY_MIGRATION_BACKUP_DIR` | `<state>/backups` | Sao lưu ngay trước mỗi migration |
| `NINE_ROUTER_API_KEY` | (không) | Key 9Router; chỉ đọc từ môi trường |
| `FACTORY_GATEWAY_URL` | `https://ai.lazy.local/v1` | Gateway OpenAI-compatible |
| `FACTORY_LEAD_MODEL`, `FACTORY_LEAD_EFFORT` | `gpt-6.1-sol`, `medium` | Model và effort của Lead |
| `FACTORY_BUDGET_TASK_TOKENS`, `FACTORY_BUDGET_DAY_TOKENS` | 200000, 1000000 | Ngân sách mặc định; đổi bằng lệnh `budgets.set` |
| `FACTORY_UI_DIR` | `<app>/apps/factory-ui/dist` | Thư mục UI đã build |

## Đã kiểm chứng

- Host: 422 test (Linux ext4 đủ; Windows bỏ qua 4 test symlink), cộng kiểm tra đột biến cho các chốt an toàn (Origin, CSRF, khóa token, idempotency, ngân sách, path traversal…).
- UI: 368 test vitest và 14 test Playwright trên Chromium với Host thật và model giả (đăng nhập, tạo Project, Chat, Task, tải lại trang, đăng xuất, theme tối, tiếng Việt, mobile). Ảnh chụp được xem bằng mắt.
- Gọi thật 9Router (5 lần, khoảng 1,7–2,0 nghìn token mỗi lần): Lead trả lời, tính ngân sách, và từ yêu cầu giao việc tạo `TSK-001 [proposed]`.

## Chưa có và giới hạn đã biết

- Task chỉ tới `proposed/accepted/declined/cancelled`; chưa chạy được (M2: dispatch, runtime, worktree, Inbox).
- Phiên đăng nhập nằm trong bộ nhớ (mất khi khởi động lại). Chi phí tiền luôn là "unknown" vì chưa có bảng giá.
- Sao lưu định kỳ sang `D:\factory-backup` (AP-R5) và tự chuyển model sang DeepSeek/Antigravity khi tốn kém (PD-5) chưa làm.
- Retry của hộp thoại tạo Project phát lại đúng lệnh đã bị từ chối; muốn sửa phải đóng và mở lại.
- Chưa thử với `E:\GIT\BTL-LTM` (cần JDK 21 trong WSL; thuộc M2).

## Sao lưu và khôi phục (M2 S1)

Host sao lưu mỗi giờ và khi tắt (`VACUUM INTO`, kiểm `integrity_check`, khóa ngoại, sổ migration và số Project trước khi công bố; lỗi thì không để lại file dở và không đụng bản cũ). Giữ mọi bản trong 48 giờ, rồi mỗi ngày một bản trong 14 ngày, luôn giữ 3 bản mới nhất. Trạng thái: `GET /system/backups` (cần phiên).

```bash
node ~/factory-v2/app/apps/factory-host/dist/backup/cli.js list /mnt/d/factory-backup
# TẮT Host trước. Khôi phục không bao giờ xóa DB cũ: nó được chuyển vào <state>/pre-restore-<thời gian>/
node ~/factory-v2/app/apps/factory-host/dist/backup/cli.js restore /mnt/d/factory-backup/<file>.db ~/factory-v2/state   --migrations ~/factory-v2/app/apps/factory-host/migrations
```

Đã diễn tập thật trong WSL: sao lưu lên `/mnt/d`, phá DB, khôi phục, Host chạy lại đủ dữ liệu; khôi phục bị từ chối khi Host đang chạy.
