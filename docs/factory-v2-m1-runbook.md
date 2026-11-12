# Factory V2 · M1 runbook (Host + Lead chat + UI)

Trạng thái: kỹ thuật M1 xong, **chờ người dùng dùng thử 2–3 ngày** (điều kiện chuyển M2, roadmap §M1). V1 không bị đụng.

## Chạy

```bash
# 1. Windows (mỗi lần đổi mã): build và test Host, contracts, UI

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

**Thêm ở M2** (chi tiết trong `apps/factory-host/README.md`):

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `FACTORY_NODE_SLOTS` | `2` | Số attempt chạy song song (1–16) |
| `FACTORY_PROJECTS_ROOT`, `FACTORY_WORKTREES_ROOT` | `/srv/factory/workspaces` nếu tồn tại, không thì `~/factory-v2/workspaces`; `~/factory-v2/worktrees` | Nơi đặt bản clone Project và worktree mỗi attempt. Phải nằm trên ext4, không lồng nhau, không dưới `/mnt` |
| `FACTORY_AGENT_MODELS` | (không, **không có mặc định**) | Danh sách model agent được dùng, ngăn cách bằng dấu phẩy; cùng `NINE_ROUTER_API_KEY` và `FACTORY_GATEWAY_URL` thì bật model proxy cho agent |
| `FACTORY_PROXY_PORT` | `FACTORY_PORT + 1` | Cổng loopback của model proxy (chế độ TCP) |
| `FACTORY_PROXY_SOCKET` | (không) | Đường dẫn tuyệt đối của unix socket cho proxy (thư mục cha 0700, không dưới `/mnt`); bắt buộc khi chạy agent trong sandbox |
| `FACTORY_RUNTIME` | `fake` | `opencode` để chạy OpenCode thật trong sandbox bubblewrap. Cần thêm: `FACTORY_OPENCODE_DIR` (thư mục có `bin/opencode`), `FACTORY_PROXY_SOCKET`, `FACTORY_AGENT_MODELS`, khóa + URL gateway, hai thư mục gốc workspace và bubblewrap chạy được; thiếu gì Host từ chối khởi động và nêu rõ thiếu gì (không in giá trị) |

Lưu ý vận hành: không bao giờ push nhánh agent tới remote không phải của bạn (ví dụ `origin` của BTL-LTM). Effect `git.push-branch` (S6d, đã xong) chỉ push tới các remote do chính bạn khai báo.

## Đã kiểm chứng

- Host: 422 test (Linux ext4 đủ; Windows bỏ qua 4 test symlink), cộng kiểm tra đột biến cho các chốt an toàn (Origin, CSRF, khóa token, idempotency, ngân sách, path traversal…).
- Gọi thật 9Router (5 lần, khoảng 1,7–2,0 nghìn token mỗi lần): Lead trả lời, tính ngân sách, và từ yêu cầu giao việc tạo `TSK-001 [proposed]`.

## Chưa có và giới hạn đã biết

- Task chỉ tới `proposed/accepted/declined/cancelled`; chưa chạy được (M2: dispatch, runtime, worktree, Inbox).
- Phiên đăng nhập nằm trong bộ nhớ (mất khi khởi động lại). Chi phí tiền luôn là "unknown" vì chưa có bảng giá.
- Tự chuyển model sang DeepSeek/Antigravity khi tốn kém (PD-5) chưa làm.
- Retry của hộp thoại tạo Project phát lại đúng lệnh đã bị từ chối; muốn sửa phải đóng và mở lại.
- Thử với `E:\GIT\BTL-LTM`: xem mục "Chạy thật với OpenCode và thử với BTL-LTM" bên dưới (JDK 21 đã có trong WSL; chưa chạy với model thật).

## Sao lưu và khôi phục (M2 S1)

Host sao lưu mỗi giờ và khi tắt (`VACUUM INTO`, kiểm `integrity_check`, khóa ngoại, sổ migration và số Project trước khi công bố; lỗi thì không để lại file dở và không đụng bản cũ). Giữ mọi bản trong 48 giờ, rồi mỗi ngày một bản trong 14 ngày, luôn giữ 3 bản mới nhất. Trạng thái: `GET /system/backups` (cần phiên).

```bash
node ~/factory-v2/app/apps/factory-host/dist/backup/cli.js list /mnt/d/factory-backup
# TẮT Host trước. Khôi phục không bao giờ xóa DB cũ: nó được chuyển vào <state>/pre-restore-<thời gian>/
node ~/factory-v2/app/apps/factory-host/dist/backup/cli.js restore /mnt/d/factory-backup/<file>.db ~/factory-v2/state \
  --migrations ~/factory-v2/app/apps/factory-host/migrations
```

Đã diễn tập thật trong WSL: sao lưu lên `/mnt/d`, phá DB, khôi phục, Host chạy lại đủ dữ liệu; khôi phục bị từ chối khi Host đang chạy.

## Chạy thật với OpenCode và thử với BTL-LTM (M2)


**Thử với BTL-LTM** (repo của người khác: chỉ ĐỌC, không bao giờ push tới `origin` của nó). Các bước (trong WSL):

1. Clone bản làm việc vào ext4 (nguồn không bị đổi; chỉ lấy nội dung đã commit):
   `node ~/factory-v2/app/apps/factory-host/dist/workspace/cli.js clone --projects-root ~/factory-v2/workspaces --name "BTL LTM" --source /mnt/e/GIT/BTL-LTM`
   — in ra `root` của bản clone.
2. Chạy Host với OpenCode thật (model do BẠN quyết định, không có mặc định): đặt `NINE_ROUTER_API_KEY`, `FACTORY_GATEWAY_URL`, `FACTORY_AGENT_MODELS=<model bạn chọn>`, `FACTORY_PROXY_SOCKET=$HOME/factory-v2/proxy/model.sock` (thư mục cha chế độ 0700), `FACTORY_RUNTIME=opencode`, `FACTORY_OPENCODE_DIR=$HOME/factory-v2/opencode`, `FACTORY_PROJECTS_ROOT`/`FACTORY_WORKTREES_ROOT` như trên; ngân sách mặc định 200k token/Task và 1M/ngày (đổi bằng `budgets.set`), nên đặt thấp cho lần thử đầu.
3. Trên UI: Tạo dự án → "Git project (existing clone)" → dán `root` ở bước 1. Tạo một Task nhỏ (ví dụ "thêm mục How to run the tests vào README"), Chấp nhận, Bắt đầu.
4. Xem tiến độ, diff, duyệt trong Inbox. Muốn đưa kết quả về máy: "Download .patch" rồi `git apply` trên bản Windows của repo (M2 chưa có nút áp dụng trực tiếp vào repo gốc). Chỉ cấu hình `FACTORY_PUSH_REMOTES` cho repo CỦA BẠN (ví dụ một fork), không bao giờ cho `origin` của BTL-LTM.
5. JDK 21 trong WSL đã có; agent chạy test Gradle của BTL-LTM trong sandbox (không có mạng, nên bản phụ thuộc phải có sẵn trong cache của worktree — nếu Gradle cần tải phụ thuộc, bước này sẽ thất bại và là một giới hạn cần quyết định riêng).
